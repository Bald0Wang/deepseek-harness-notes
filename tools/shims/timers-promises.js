// node:timers/promises 的浏览器 shim。

export function setTimeout(delay = 1, value, options = {}) {
  const { signal } = options
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => resolve(value), delay)
    if (signal) {
      const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')) }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export const setImmediate = (value) => Promise.resolve(value)
export const setInterval = () => { throw new Error('timers/promises.setInterval 在浏览器运行时不可用') }

export default { setTimeout, setImmediate, setInterval }
