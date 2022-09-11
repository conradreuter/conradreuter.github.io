import { measureTiming } from '/shared/async.js'
import { noop } from '/shared/functions.js'
import { Gameloop } from '/shared/gameloop.js'
import { Metric } from '/shared/metrics.js'
import { LapTimer } from '/shared/timers.js'

let canvas
let ctx
let device
let pipeline
let width
let height
let gameloop
let metrics
let fpsTimer

const clearValue = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }
const antCount = 3e3
const fadeAlpha = 0.02
const speed = 2.5
const jitter = 5e-1

window.addEventListener('load', async () => {
  await initWebGPU()
  init()
  adjustToCanvasSize()
  gameloop = new Gameloop({ render, simulate: noop })
  fpsTimer.start()
  gameloop.start()
})

function init() {
  window.printMetrics = printMetrics
  metrics = {
    render: { m: new Metric(), fmt: (x) => `${x.toFixed(1)}ms` },
    fps: { m: new Metric(), fmt: (x) => `${(1e3 / x).toFixed(0)}` },
  }
  fpsTimer = new LapTimer()
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

  const format = navigator.gpu.getPreferredCanvasFormat()
  ctx.configure({ alphaMode: 'opaque', device, format })

  const [vertexShaderCode, fragmentShaderCode] = await Promise.all(
    ['vertex', 'fragment'].map((file) => fetch(`./${file}.wgsl`).then((res) => res.text()))
  )

  pipeline = device.createRenderPipeline({
    layout: 'auto',
    primitive: {
      topology: 'triangle-list',
    },
    vertex: {
      module: device.createShaderModule({ code: vertexShaderCode }),
      entryPoint: 'main',
    },
    fragment: {
      module: device.createShaderModule({ code: fragmentShaderCode }),
      entryPoint: 'main',
      targets: [{ format }],
    },
  })
}

function render() {
  const [timing] = measureTiming(justRender)
  metrics.render.m.emit(timing)
  metrics.fps.m.emit(fpsTimer.lap())
}

function justRender() {
  const commandEncoder = device.createCommandEncoder()
  const view = ctx.getCurrentTexture().createView()
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue }],
  })
  passEncoder.setPipeline(pipeline)
  passEncoder.draw(3, 1, 0, 0)
  passEncoder.end()
  device.queue.submit([commandEncoder.finish()])
}

function printMetrics() {
  const out = []
  for (const [key, metric] of Object.entries(metrics)) {
    out.push(`${key} ${metric.fmt(metric.m.read())}`)
  }
  return out.join('  ')
}
