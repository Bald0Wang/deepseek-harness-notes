// node:events 的浏览器 shim：一个最小 EventEmitter。

export class EventEmitter {
  #listeners = new Map()

  addListener(event, listener) { return this.on(event, listener) }
  removeListener(event, listener) { return this.off(event, listener) }

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set())
    this.#listeners.get(event).add(listener)
    return this
  }

  once(event, listener) {
    const wrapped = (...args) => { this.off(event, wrapped); listener(...args) }
    wrapped.listener = listener
    return this.on(event, wrapped)
  }

  off(event, listener) {
    const set = this.#listeners.get(event)
    if (set) for (const fn of set) {
      if (fn === listener || fn.listener === listener) set.delete(fn)
    }
    return this
  }

  emit(event, ...args) {
    const set = this.#listeners.get(event)
    if (!set?.size) return false
    for (const fn of [...set]) fn(...args)
    return true
  }

  listenerCount(event) { return this.#listeners.get(event)?.size ?? 0 }
  eventNames() { return [...this.#listeners.keys()] }
  removeAllListeners(event) {
    if (event === undefined) this.#listeners.clear()
    else this.#listeners.delete(event)
    return this
  }
}

export default EventEmitter
export { EventEmitter as default_events }
