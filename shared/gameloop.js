export class Gameloop {
  #clock = 0
  #fixedFrameTime
  #isStopped = true
  #pendingAnimationFrameID
  #render
  #simulate

  constructor(params) {
    this.#render = params.render
    this.#simulate = params.simulate
    this.setMaxFPS(params.maxFPS ?? defaultMaxFPS)
  }

  setMaxFPS(fps) {
    this.#fixedFrameTime = 1e3 / fps
  }

  get clock() {
    return this.#clock
  }

  get isRunning() {
    return !this.#isStopped
  }

  start() {
    if (this.#isStopped) {
      this.#isStopped = false
      this.#run()
    }
  }

  stop() {
    this.#isStopped = true
    if (this.#pendingAnimationFrameID != null) {
      cancelAnimationFrame(this.#pendingAnimationFrameID)
      this.#pendingAnimationFrameID = null
    }
  }

  #run() {
    let lastFrame = performance.now()
    let accumulatedTime = 0
    this.#pendingAnimationFrameID = requestAnimationFrame((frame) => {
      step(performance.now())
      lastFrame = frame
    })
    const step = (currentFrame) => {
      if (this.#isStopped) {
        return
      }
      const frameTime = currentFrame - lastFrame
      accumulatedTime += frameTime
      const stepsToSimulate = Math.floor(accumulatedTime / this.#fixedFrameTime)
      for (let i = 0; i < stepsToSimulate; i++) {
        this.#simulate(this.#fixedFrameTime)
        this.#clock += this.#fixedFrameTime
      }
      if (stepsToSimulate > 0) {
        this.#render()
      }
      lastFrame = currentFrame
      accumulatedTime -= stepsToSimulate * this.#fixedFrameTime
      this.#pendingAnimationFrameID = requestAnimationFrame(step)
    }
  }

  listenToDocumentVisibility() {
    let wasStoppedByDocumentVisibility = false
    const listener = () => {
      if (document.visibilityState === 'visible') {
        if (wasStoppedByDocumentVisibility) {
          this.start()
          wasStoppedByDocumentVisibility = false
        }
      } else {
        if (this.isRunning) {
          this.stop()
          wasStoppedByDocumentVisibility = true
        }
      }
    }
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  }
}

const defaultMaxFPS = 60
