// node:util 的浏览器 shim：只需要 format / inspect / promisify 的宽松等价物。

function formatValue(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function format(f, ...args) {
  if (typeof f !== 'string') return [formatValue(f), ...args.map(formatValue)].join(' ')
  let i = 0
  const out = f.replace(/%[sdifjoOc%]/g, (m) => {
    if (m === '%%') return '%'
    if (i >= args.length) return m
    const arg = args[i++]
    switch (m) {
      case '%s': return formatValue(arg)
      case '%d': case '%i': return String(parseInt(arg, 10))
      case '%f': return String(parseFloat(arg))
      case '%j': case '%o': case '%O':
        try { return JSON.stringify(arg) } catch { return '[Circular]' }
      case '%c': return ''
      default: return m
    }
  })
  let result = out
  if (i < args.length) result += ' ' + args.slice(i).map(formatValue).join(' ')
  return result
}

export function inspect(value, options) {
  return formatValue(value)
}

export const types = {
  isPromise: (v) => v instanceof Promise,
  isNativeError: (v) => v instanceof Error,
}

export function promisify(fn) {
  return function promisified(...args) {
    return new Promise((resolve, reject) => {
      fn(...args, (err, value) => (err ? reject(err) : resolve(value)))
    })
  }
}

export const callbackify = () => { throw new Error('util.callbackify 在浏览器运行时不可用') }
export const debuglog = () => () => {}

export default { format, inspect, types, promisify, callbackify, debuglog }
