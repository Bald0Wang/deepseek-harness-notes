// node:fs/promises 的浏览器 shim（异步族，走同一个内存文件系统）。

function store() {
  if (!globalThis.__DSH_FS__) globalThis.__DSH_FS__ = new Map()
  return globalThis.__DSH_FS__
}

const norm = (p) => {
  let s = String(p)
  if (s.startsWith('file://')) s = decodeURIComponent(s.slice('file://'.length))
  while (s.startsWith('./')) s = s.slice(2)
  const ns = String(globalThis.__DSH_CWD__ || '').replace(/\/+$/, '')
  return ns + '/' + s
}

export async function readFile(path, encoding) {
  const key = norm(path)
  if (!store().has(key)) {
    const err = new Error(`ENOENT: no such file or directory, open '${key}'`)
    err.code = 'ENOENT'
    throw err
  }
  return store().get(key)
}

export async function writeFile(path, data) {
  store().set(norm(path), typeof data === 'string' ? data : String(data))
}

export async function appendFile(path, data) {
  const key = norm(path)
  store().set(key, (store().get(key) ?? '') + (typeof data === 'string' ? data : String(data)))
}

export async function access(path, mode) {
  if (!store().has(norm(path))) {
    const err = new Error(`ENOENT: no such file or directory, access '${norm(path)}'`)
    err.code = 'ENOENT'
    throw err
  }
}

export async function rename(from, to) {
  const key = norm(from)
  if (store().has(key)) {
    store().set(norm(to), store().get(key))
    store().delete(key)
  }
}

export async function mkdir(path, options) {
  store().set(norm(path) + '/', '')
}

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }

export default { readFile, writeFile, appendFile, access, rename, mkdir, constants }
