export class Gameloop {
  #isStopped = true
  #render
  #simulate
  #timePerFrame

  constructor(params) {
    this.#render = params.render
    this.#simulate = params.simulate
    this.setMaxFPS(params.maxFPS ?? defaultMaxFPS)
  }

  setMaxFPS(fps) {
    this.#timePerFrame = 1e3 / fps
  }

  start() {
    if (!this.#isStopped) {
      return
    }
    this.#isStopped = false

    let lastFrame = performance.now()
    let accumulatedTime = 0
    requestAnimationFrame((frame) => {
      step(performance.now())
      lastFrame = frame
    })
    const step = (currentFrame) => {
      if (this.#isStopped) {
        return
      }
      const frameTime = currentFrame - lastFrame
      accumulatedTime += frameTime
      const stepsToSimulate = Math.floor(accumulatedTime / this.#timePerFrame)
      for (let i = 0; i < stepsToSimulate; i++) {
        this.#simulate(this.#timePerFrame)
      }
      if (stepsToSimulate > 0) {
        this.#render()
      }
      lastFrame = currentFrame
      accumulatedTime -= stepsToSimulate * this.#timePerFrame
      requestAnimationFrame(step)
    }
  }

  stop() {
    this.#isStopped = true
  }

  listenToDocumentVisibility() {
    const listener = () => {
      if (document.visibilityState === 'visible') {
        gameloop.start()
      } else {
        gameloop.stop()
      }
    }
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  }
}

const defaultMaxFPS = 60
