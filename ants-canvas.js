import { measureTiming } from './utils/async.js'
import { Gameloop } from './utils/gameloop.js'
import { Metric } from './utils/metrics.js'

let canvas
let ctx
let width
let height
let gameloop
let metrics

const ants = []
const antCount = 1e4
const speed = 3
const jitter = 5e-1

window.addEventListener('load', () => {
  init()
  spawnAnts(antCount)
  render()
  //gameloop.start()

  window.printMetrics = () => {
    const out = []
    for (const [key, metric] of Object.entries(metrics)) {
      out.push(`${key} ${metric.fmt(metric.m.read())}`)
    }
    return out.join('  ')
  }

  window.run = (ms = 1e2) => {
    gameloop.start()
    setTimeout(() => {
      gameloop.stop()
      console.log('done')
    }, ms)
  }
  window.run()
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    //gameloop.start()
  } else {
    //gameloop.stop()
  }
})

function init() {
  canvas = document.querySelector('canvas')
  ctx = canvas.getContext('2d')
  adjustToCanvasSize()

  metrics = {
    render: { m: new Metric(), fmt: (x) => `${x.toFixed(1)}ms` },
    simulate: { m: new Metric(), fmt: (x) => `${x.toFixed(1)}ms` },
  }

  gameloop = new Gameloop({ render, simulate })
}

function spawnAnts(antCount) {
  for (let i = 0; i < antCount; i++) {
    spawnAnt()
  }
}

function spawnAnt() {
  const r = 0.25 * Math.min(width, height) * Math.random()
  const φ = 2 * Math.PI * Math.random()
  const x = width / 2 + r * Math.cos(φ)
  const y = height / 2 + r * Math.sin(φ)
  const θ = 2 * Math.PI * Math.random()
  ants.push({ x, y, θ })
}

function simulate(timePerFrame) {
  const [timing] = measureTiming(() => {
    for (const ant of ants) {
      ant.x += speed * Math.cos(ant.θ)
      ant.y += speed * Math.sin(ant.θ)
      ant.θ += jitter * (Math.random() - 0.5)
      while (ant.x < 0) ant.x += width
      while (ant.x > width) ant.x -= width
      while (ant.y < 0) ant.y += height
      while (ant.y > height) ant.y -= height
    }
  })
  metrics.simulate.m.emit(timing)
}

function render() {
  const [timing] = measureTiming(() => {
    clearScreen()
    renderAnts()
  })
  metrics.render.m.emit(timing)
}

function clearScreen() {
  ctx.fillStyle = 'rgb(18, 32, 24)'
  ctx.fillRect(0, 0, width, height)
}

function renderAnts() {
  ctx.fillStyle = 'white'
  for (const ant of ants) {
    ctx.fillRect(ant.x, ant.y, 1, 1)
  }
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
