import { measureTiming } from '/shared/async.js'
import { noop, times } from '/shared/functions.js'
import { Gameloop } from '/shared/gameloop.js'
import { Metric } from '/shared/metrics.js'
import { LapTimer } from '/shared/timers.js'

let canvas
let ctx
let device
let textureFormat
let paramsStructCode
let paramsBuffer
let mapTexture
let prevMapTexture
let simulationSteps = []
let renderSteps = []
let width
let height
let gameloop
let metrics
let fpsTimer

const spawnRadius = 0.2
const agentCount = 1e4
const diffuseRate = 0.2
const decayRate = 0.01
const moveSpeed = 1
const turnSpeed = 0.3
const turnJitter = 0.5
const sensorAngle = radians(30)
const sensorDistance = 4

const random = (function() {

  return function random() {
    function mulberry32(a) {
      return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      }
  }
  }
})()

function spawnAgent() {
  const cx = width / 2
  const cy = height / 2
  const r = spawnRadius * Math.min(cx, cy) * Math.sqrt(Math.random())
  const θ = radians(360 * Math.random())
  const x = cx + r * Math.cos(θ)
  const y = cy + r * Math.sin(θ)
  const φ = radians(360 * Math.random())
  return { x, y, φ }
}

Math.random = (function () {
  let value = 0xdeadbeef // seeed

  function hash(value) {
    value ^= 123
    value *= 456
    value ^= value >> 16
    value *= 789
    value ^= value >> 16
    value *= 420
    return value
  }

  function realhash(value) {
    value ^= 2747636419
    value *= 2654435769
    value ^= value >> 16
    value *= 2654435769
    value ^= value >> 16
    value *= 2654435769
    return value
  }

  return function Math_random() {
    return (value = hash(value)) % 1
  }
})()

window.addEventListener('load', async () => {
  await initWebGPU()
  adjustToCanvasSize()
  initPipelines()
  init()
  gameloop = new Gameloop({ render, simulate })
  fpsTimer.start()
  gameloop.start()
  gameloop.listenToDocumentVisibility()

  window.togglePause = () => void (gameloop.isRunning ? gameloop.stop() : gameloop.start())
  document.addEventListener('keydown', (event) => void (event.key === 'p' && window.togglePause()))
})

function init() {
  window.printMetrics = printMetrics
  metrics = {
    simulate: { m: new Metric(), fmt: (x) => `${x.toFixed(1)}ms` },
    render: { m: new Metric(), fmt: (x) => `${x.toFixed(1)}ms` },
    fps: { m: new Metric(), fmt: (x) => `${(1e3 / x).toFixed(0)}` },
    clock: { m: new Metric(), fmt: () => formatClock(gameloop.clock) },
  }
  fpsTimer = new LapTimer()
}

function formatClock(ms) {
  const min = Math.floor(ms / 60_000)
  const sec = Math.floor((ms / 1_000) % 60)
  return `${min}:${sec < 10 ? '0' : ''}${sec}`
}

function adjustToCanvasSize() {
  function adjust() {
    const rect = canvas.getBoundingClientRect()
    width = rect.width
    height = rect.height
    canvas.setAttribute('width', width)
    canvas.setAttribute('height', height)
  }

  adjust()

  const resizeObserver = new ResizeObserver(() => {
    adjust()
    requestAnimationFrame(() => render())
  })
  resizeObserver.observe(canvas)
}

async function initWebGPU() {
  canvas = document.querySelector('canvas')
  ctx = canvas.getContext('webgpu')

  const adapter = await navigator.gpu.requestAdapter()
  device = await adapter.requestDevice()

  textureFormat = navigator.gpu.getPreferredCanvasFormat()
  ctx.configure({
    device,
    alphaMode: 'opaque',
    format: textureFormat,
  })
}

function initPipelines() {
  initSharedPipelineResources()
  initDiffusionPipeline()
  initSimulatePipeline()
  initRenderPipeline()
}

function initSharedPipelineResources() {
  initParamsBuffer()
  initMapTextures()
}

function initParamsBuffer() {
  paramsStructCode = `
    struct Params {
      agentCount: u32,
      width: u32,
      height: u32,
      clock: u32,
      moveSpeed: f32,
      turnSpeed: f32,
      turnJitter: f32,
      sensorAngle: f32,
      sensorDistance: f32,
      diffuseRate: f32,
      decayRate: f32,
    }
  `

  paramsBuffer = device.createBuffer({
    size: 44,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
  })

  simulationSteps.push(function updateParamsBuffer() {
    const data = new ArrayBuffer(paramsBuffer.size)
    new Uint32Array(data, 0, 4).set([agentCount, width, height, gameloop.clock])
    new Float32Array(data, 16, 7).set([
      moveSpeed,
      turnSpeed,
      turnJitter,
      sensorAngle,
      sensorDistance,
      diffuseRate,
      decayRate,
    ])
    device.queue.writeBuffer(paramsBuffer, 0, data)
  })
}

function initMapTextures() {
  mapTexture = device.createTexture({
    format: 'r32float',
    size: { width, height },
    usage:
      GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

  prevMapTexture = device.createTexture({
    format: 'r32float',
    size: { width, height },
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  })

  simulationSteps.push(function copyMapTexture({ commandEncoder }) {
    commandEncoder.copyTextureToTexture(
      { texture: mapTexture },
      { texture: prevMapTexture },
      { width, height }
    )
  })
}

function initDiffusionPipeline() {
  const workgroupSize = 8

  const computeShaderModule = device.createShaderModule({
    code: `
      ${paramsStructCode}

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var prevMapTexture: texture_2d<f32>;
      @group(0) @binding(2) var nextMapTexture: texture_storage_2d<r32float, write>;

      @compute @workgroup_size(${workgroupSize}, ${workgroupSize})
      fn main(@builtin(global_invocation_id) id: vec3u) {
        if (id.x < 0 || id.y < 0 || id.x >= params.width || id.y >= params.height) {
          return;
        }
        var color = textureLoad(prevMapTexture, id.xy, 0);
        color = diffuse(color, id.xy);
        color = decay(color);
        textureStore(nextMapTexture, id.xy, color);
      }

      fn diffuse(color: vec4f, coords: vec2u) -> vec4f {
        let blurred = boxblur(coords);
        return mix(color, blurred, params.diffuseRate);
      }

      fn boxblur(coords: vec2u) -> vec4f {
        var sum = vec4f(0.0, 0.0, 0.0, 0.0);
        for (var dx = -2; dx < 3; dx++) {
          let x = u32((i32(coords.x) + dx) % i32(params.width));
          for (var dy = -2; dy < 3; dy++) {
            let y = u32((i32(coords.y) + dy) % i32(params.height));
            sum += textureLoad(prevMapTexture, vec2u(x, y), 0);
          }
        }
        return sum / 25.0;
      }

      fn decay(color: vec4f) -> vec4f {
        return (1.0 - params.decayRate) * color;
      }
    `,
  })

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: computeShaderModule,
      entryPoint: 'main',
    },
  })

  const computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: paramsBuffer },
      },
      {
        binding: 1,
        resource: prevMapTexture.createView(),
      },
      {
        binding: 2,
        resource: mapTexture.createView(),
      },
    ],
  })

  simulationSteps.push(function encodeDiffusionPipeline({ commandEncoder }) {
    const computePass = commandEncoder.beginComputePass()
    computePass.setPipeline(computePipeline)
    computePass.setBindGroup(0, computeBindGroup)
    computePass.dispatchWorkgroups(
      Math.ceil(width / workgroupSize),
      Math.ceil(height / workgroupSize)
    )
    computePass.end()
  })
}

function initSimulatePipeline() {
  const workgroupSize = 64

  const computeShaderModule = device.createShaderModule({
    code: `
      ${paramsStructCode}

      struct Agent {
        x: f32,
        y: f32,
        φ: f32,
      }
    
      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
      @group(0) @binding(2) var prevMapTexture: texture_2d<f32>;
      @group(0) @binding(3) var mapTexture: texture_storage_2d<r32float, write>;

      @compute @workgroup_size(${workgroupSize})
      fn main(@builtin(global_invocation_id) id: vec3u) {
        let agentIdx = id.x;
        if (agentIdx < 0 || agentIdx >= params.agentCount) {
          return;
        }
        turnAgent(agentIdx);
        moveAgent(agentIdx);
        clampAgent(agentIdx);
        storeAgent(agentIdx);
      }

      fn turnAgent(agentIdx: u32) {
        var randomizer = randomSeed(agentIdx);
        
        let strength = randomFloat01(&randomizer);
        let sensedForward = sense(agentIdx, 0);
        let sensedLeft = sense(agentIdx, params.sensorAngle);
        let sensedRight = sense(agentIdx, -params.sensorAngle);
        
        if (sensedForward > sensedLeft && sensedForward > sensedRight) {
          // continue forward
        }
        else if (sensedForward < sensedLeft && sensedForward < sensedRight) {
          // turn left or right with half strength
          agents[agentIdx].φ += (strength - 0.5) * 2.0 * params.turnSpeed;
        }
        else if (sensedRight > sensedLeft) {
          // turn right
          agents[agentIdx].φ -= strength * params.turnSpeed;
        }
        else if (sensedLeft > sensedRight) {
          // turn left
          agents[agentIdx].φ += strength * params.turnSpeed;
        }
        
        agents[agentIdx].φ += params.turnJitter * (randomFloat01(&randomizer) - 0.5);
      }

      fn sense(agentIdx: u32, sensorAngle: f32) -> f32 {
        let φ = agents[agentIdx].φ + sensorAngle;
        let x0 = i32(agents[agentIdx].x + params.sensorDistance * cos(φ));
        let y0 = i32(agents[agentIdx].y + params.sensorDistance * sin(φ));
        var sum = 0.0;
        for (var dx = -1; dx < 2; dx++) {
          let x = u32((x0 + dx) % i32(params.width));
          for (var dy = -1; dy < 2; dy++) {
            let y = u32((y0 + dy) % i32(params.height));
            sum += textureLoad(prevMapTexture, vec2u(x, y), 0).r;
          }
        }
        return sum;
      }

      fn moveAgent(agentIdx: u32) {
        agents[agentIdx].x += params.moveSpeed * cos(agents[agentIdx].φ);
        agents[agentIdx].y += params.moveSpeed * sin(agents[agentIdx].φ);
      }

      fn clampAgent(agentIdx: u32) {
        if (agents[agentIdx].x < 0.0 || agents[agentIdx].x >= f32(params.width)) {
          agents[agentIdx].x = fract(agents[agentIdx].x / f32(params.width)) * f32(params.width);
        }
        if (agents[agentIdx].y < 0.0 || agents[agentIdx].y >= f32(params.height)) {
          agents[agentIdx].y = fract(agents[agentIdx].y / f32(params.height)) * f32(params.height);
        }
      }

      fn storeAgent(agentIdx: u32) {
        let position = vec2f(agents[agentIdx].x, agents[agentIdx].y);
        let data = vec4f(1.0, 0.0, 0.0, 0.0);
        textureStore(mapTexture, vec2u(round(position)), data); 
      }

      fn randomSeed(agentIdx: u32) -> u32 {
        var seed = agentIdx + params.clock * 10000u;
        seed = randomUnsigned(&seed);
        seed += u32(round(agents[agentIdx].x));
        seed += u32(round(agents[agentIdx].y)) * params.width;
        return randomUnsigned(&seed);
      }

      fn randomUnsigned(randomizer: ptr<function, u32>) -> u32 {
        var value = *randomizer;
        value ^= 2747636419u;
        value *= 2654435769u;
        value ^= value >> 16;
        value *= 2654435769u;
        value ^= value >> 16;
        value *= 2654435769u;
        *randomizer = value;
        return value;
      }

      fn randomFloat01(randomizer: ptr<function, u32>) -> f32 {
        return f32(randomUnsigned(randomizer)) / 4294967295.0;
      }
    `,
  })

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: computeShaderModule,
      entryPoint: 'main',
    },
  })

  const agentsBuffer = device.createBuffer({
    size: agentCount * 12,
    usage: GPUBufferUsage.STORAGE,
    mappedAtCreation: true,
  })
  const agentsBufferData = times(agentCount, (agentIdx) => {
    const { x, y, φ } = spawnAgent(agentIdx)
    return [x, y, φ]
  }).flat(1)
  new Float32Array(agentsBuffer.getMappedRange()).set(agentsBufferData)
  agentsBuffer.unmap()

  const computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: paramsBuffer },
      },
      {
        binding: 1,
        resource: { buffer: agentsBuffer },
      },
      {
        binding: 2,
        resource: prevMapTexture.createView(),
      },
      {
        binding: 3,
        resource: mapTexture.createView(),
      },
    ],
  })

  simulationSteps.push(function encodeSimulationPipeline({ commandEncoder }) {
    const computePass = commandEncoder.beginComputePass()
    computePass.setPipeline(computePipeline)
    computePass.setBindGroup(0, computeBindGroup)
    computePass.dispatchWorkgroups(Math.ceil(agentCount / workgroupSize))
    computePass.end()
  })
}

function initRenderPipeline() {
  const renderShaderModule = device.createShaderModule({
    code: `
      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(1) textureCoordinates: vec2f,
      }

      @group(0) @binding(0) var texture: texture_2d<f32>;

      const rectangle = array<vec4f, 6>(
        // first triangle
        vec4f(-1, -1, 0, 1), // bottom left
        vec4f(-1,  1, 0, 1), // top left
        vec4f( 1,  1, 0, 1), // top right
        // second triangle
        vec4f( 1,  1, 0, 1), // top right
        vec4f( 1, -1, 0, 1), // bottom right
        vec4f(-1, -1, 0, 1), // bottom left
      );
      
      @vertex
      fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        let position = rectangle[vertexIndex];
        let normalizedTextureCoordinates = (position.xy + vec2f(1, 1)) / 2;
        let textureCoordinates = vec2f(textureDimensions(texture)) * normalizedTextureCoordinates;
        return VertexOutput(position, textureCoordinates);
      }        

      @fragment
      fn fragmentMain(vertex: VertexOutput) -> @location(0) vec4f {
        let value = textureLoad(texture, vec2u(vertex.textureCoordinates), 0);
        let trail = value.r;
        return vec4f(trail, trail, trail, 1);
      }
    `,
  })

  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    primitive: {
      topology: 'triangle-list',
    },
    vertex: {
      module: renderShaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: renderShaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: textureFormat }],
    },
  })

  const renderPipelineBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: mapTexture.createView(),
      },
    ],
  })

  renderSteps.push(function encodeRenderPipeline({ canvasTexture, commandEncoder }) {
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 1, a: 1 },
        },
      ],
    })
    renderPass.setPipeline(renderPipeline)
    renderPass.setBindGroup(0, renderPipelineBindGroup)
    renderPass.draw(6, 1, 0, 0)
    renderPass.end()
  })
}

async function simulate() {
  const [timing] = await measureTiming(justSimulate)
  metrics.simulate.m.emit(timing)
}

async function justSimulate() {
  const canvasTexture = ctx.getCurrentTexture()
  const commandEncoder = device.createCommandEncoder()
  simulationSteps.forEach((pass) => pass({ canvasTexture, commandEncoder }))
  device.queue.submit([commandEncoder.finish()])
  await device.queue.onSubmittedWorkDone()
}

async function render() {
  const [timing] = await measureTiming(justRender)
  metrics.render.m.emit(timing)
  metrics.fps.m.emit(fpsTimer.lap())
}

async function justRender() {
  const canvasTexture = ctx.getCurrentTexture()
  const commandEncoder = device.createCommandEncoder()
  renderSteps.forEach((pass) => pass({ canvasTexture, commandEncoder }))
  device.queue.submit([commandEncoder.finish()])
  await device.queue.onSubmittedWorkDone()
}

function printMetrics() {
  const out = []
  for (const [key, metric] of Object.entries(metrics)) {
    out.push(`${key}:${metric.fmt(metric.m.read())}`)
  }
  return out.join('   ')
}

function radians(degrees) {
  return (degrees * Math.PI) / 180
}
