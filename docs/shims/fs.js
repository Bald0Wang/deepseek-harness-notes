// node:fs 的浏览器 shim：课程只用 5 个同步函数（内存文件系统）。
// window.__DSH_FS__ 是一个 Map，由页面创建；「重置文件系统」按钮清空它，
// 这样 17 课（resume-session）可以像磁盘一样跨运行保留 session 日志。
//
// 每课的文件按 __DSH_CWD__（当前课程目录）加命名空间前缀：所有课的
// session.jsonl 都写在同一个相对路径上，不加前缀会互相污染。

function store() {
  if (!globalThis.__DSH_FS__) globalThis.__DSH_FS__ = new Map()
  return globalThis.__DSH_FS__
}

function norm(path) {
  let s = String(path)
  if (s.startsWith('file://')) s = decodeURIComponent(s.slice('file://'.length))
  while (s.startsWith('./')) s = s.slice(2)
  const ns = String(globalThis.__DSH_CWD__ || '').replace(/\/+$/, '')
  return ns + '/' + s
}

function toString(data) {
  return typeof data === 'string' ? data : String(data)
}

export function existsSync(path) {
  return store().has(norm(path))
}

export function readFileSync(path) {
  const key = norm(path)
  if (!store().has(key)) {
    const err = new Error(`ENOENT: no such file or directory, open '${key}'`)
    err.code = 'ENOENT'
    err.errno = -2
    err.path = key
    throw err
  }
  return store().get(key)
}

export function writeFileSync(path, data) {
  store().set(norm(path), toString(data))
}

export function appendFileSync(path, data) {
  const key = norm(path)
  store().set(key, (store().get(key) ?? '') + toString(data))
}

export function mkdirSync(path, options) {
  // 教学代码只做 mkdirSync(dirname(file), { recursive: true })，
  // 内存文件系统里目录无需真实存在，记个标记即可。
  store().set(norm(path) + '/', '')
}

export function readdirSync(path) {
  const prefix = norm(path).replace(/\/$/, '') + '/'
  const names = new Set()
  for (const key of store().keys()) {
    if (key.startsWith(prefix)) {
      const rest = key.slice(prefix.length)
      if (rest) names.add(rest.split('/')[0])
    }
  }
  return [...names]
}

export function statSync(path) {
  const key = norm(path)
  if (!store().has(key)) {
    const err = new Error(`ENOENT: no such file or directory, stat '${key}'`)
    err.code = 'ENOENT'
    throw err
  }
  return { isFile: () => true, isDirectory: () => false, size: store().get(key).length }
}

export function rmSync(path, options) {
  const key = norm(path)
  store().delete(key)
  if (options?.recursive) {
    const prefix = key.replace(/\/$/, '') + '/'
    for (const k of [...store().keys()]) if (k.startsWith(prefix)) store().delete(k)
  }
}

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0 }

export default {
  existsSync, readFileSync, writeFileSync, appendFileSync,
  mkdirSync, readdirSync, statSync, rmSync, constants,
}
