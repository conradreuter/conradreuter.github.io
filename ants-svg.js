let rootElement
let xmlns
let timer

const ants = []
const antCount = 100
const timeStep = 12
const maxTimeSteps = 1000
let timeStepsDone = 0
const speed = 1e-3
const jitter = 5e-1

window.addEventListener('load', function init() {
  rootElement = document.querySelector('svg')
  xmlns = rootElement.getAttribute('xmlns')
  spawnAnts(antCount)
  timer = setInterval(simulate, timeStep)
})

function spawnAnts(antCount) {
  for (let i = 0; i < antCount; i++) {
    spawnAnt()
  }
}

function spawnAnt() {
  const x = 0.25 + Math.random() * 0.5
  const y = 0.25 + Math.random() * 0.5
  const α = Math.random() * 2 * Math.PI

  const element = document.createElementNS(xmlns, 'polyline')
  element.classList.add('ant')
  element.setAttribute('points', `${x},${y}`)
  rootElement.appendChild(element)

  ants.push({ element, x, y, α })
}

function simulate() {
  for (const ant of ants) {
    ant.x += speed * Math.cos(ant.α)
    ant.y += speed * Math.sin(ant.α)
    ant.α += jitter * (Math.random() - 0.5)
    let points = ant.element.getAttribute('points')
    points = `${points} ${ant.x},${ant.y}`
    ant.element.setAttribute('points', points)
  }

  timeStepsDone++
  if (timeStepsDone > maxTimeSteps) {
    clearInterval(timer)
    timer = null
  }
}
