// node:module 的浏览器 shim。Cordis Loader 只在 Node 内部加载器路径上调用
// createRequire（浏览器路径不会走到），这里给一个会明确报错的占位。

export function createRequire() {
  return function require(id) {
    throw new Error(`require('${id}') 不可用：当前运行环境是浏览器（教学运行时）`)
  }
}

export default { createRequire }
