// node:timers 的浏览器 shim：全局计时器直接转发。

export const setTimeout = globalThis.setTimeout.bind(globalThis)
export const clearTimeout = globalThis.clearTimeout.bind(globalThis)
export const setInterval = globalThis.setInterval.bind(globalThis)
export const clearInterval = globalThis.clearInterval.bind(globalThis)
export const setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args)
export const clearImmediate = clearTimeout

export default { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate }
