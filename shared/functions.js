export function noop() {}

export function times(n, fn) {
  const result = Array(n)
  for (let i = 0; i < n; i++) {
    result[i] = fn(i)
  }
  return result
}
