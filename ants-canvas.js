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
const antCount = 3e3
const fadeAlpha = 0.02
const speed = 2.5
const jitter = 5e-1

window.addEventListener('load', () => {
  init()
  spawnAnts(antCount)
  render()
  gameloop.listenToDocumentVisibility()
  gameloop.start()
})

function init() {
  canvas = document.querySelector('canvas')
  ctx = canvas.getContext('2d')
  adjustToCanvasSize()

  metrics = {
    render: { m: new Metric(), fmt: (x) => `${x.toFixed(1)}ms` },
    simulate: { m: new Metric(), fmt: (x) => `${x.toFixed(1)}ms` },
  }
  window.printMetrics = printMetrics

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
    fadeTrails()
    drawAnts()
  })
  metrics.render.m.emit(timing)
}

function fadeTrails() {
  ctx.fillStyle = `rgba(18, 32, 24, ${fadeAlpha})`
  ctx.fillRect(0, 0, width, height)
}

function drawAnts() {
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

function printMetrics() {
  const out = []
  for (const [key, metric] of Object.entries(metrics)) {
    out.push(`${key} ${metric.fmt(metric.m.read())}`)
  }
  return out.join('  ')
}
