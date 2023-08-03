export function isPromiseLike(target) {
  return target != null && target.then != null && typeof target.then === 'function'
}

export function measureTiming(fn) {
  const start = now()
  const result = fn()
  return isPromiseLike(result) ? result.then(withTiming) : withTiming(result)

  function withTiming(syncResult) {
    const end = now()
    const diff = end - start
    return [diff, syncResult]
  }
}

export function now() {
  return performance.now()
}
