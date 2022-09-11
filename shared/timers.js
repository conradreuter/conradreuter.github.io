export class LapTimer {
  #lastTime = null

  start() {
    this.#lastTime = performance.now()
  }

  lap() {
    const currentTime = performance.now()
    const timeDifference = currentTime - this.#lastTime
    this.#lastTime = currentTime
    return timeDifference
  }
}
