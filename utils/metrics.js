export class Metric {
  #count = 0
  #insertIdx = 0
  #sum = 0
  #values

  constructor(params) {
    this.#values = new Array(params?.windowSize ?? defaultWindowSize)
  }

  emit(value) {
    const removedValue = this.#values[this.#insertIdx]
    if (removedValue == null) {
      this.#sum += value
      this.#count++
    } else {
      this.#sum += value - removedValue
    }
    this.#values[this.#insertIdx] = value
    this.#insertIdx++
  }

  read() {
    if (this.#count === 0) {
      return null
    }
    return this.#sum / this.#count
  }
}

const defaultWindowSize = 100
