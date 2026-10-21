// node:path 的浏览器 shim：课程只用到 POSIX 字符串操作
// （join / dirname / basename / extname / resolve / normalize）。

function assertPath(p) {
  if (typeof p !== 'string') throw new TypeError(`Path must be a string. Received ${typeof p}`)
}

export function normalize(path) {
  assertPath(path)
  if (path === '') return '.'
  const isAbsolute = path.charCodeAt(0) === 47 /* /*/
  const trailingSeparator = path.charCodeAt(path.length - 1) === 47
  let up = 0
  const parts = path.split('/')
  const out = []
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part === '') continue
    if (part === '.') {
      if (i === 0 && !isAbsolute) out.unshift('')
      continue
    }
    if (part === '..') {
      if (i === 0 || (i === 1 && out[0] === '') || out[0] === '..') {
        if (!isAbsolute) out.unshift('..')
        up++
      } else if (out.length) {
        out.shift()
      }
      continue
    }
    out.unshift(part)
  }
  let res = out.join('/')
  if (isAbsolute) res = '/' + res
  else if (res === '' || (out.length === 1 && out[0] === '')) res = '.'
  if (trailingSeparator && res !== '/' && res !== '.') res += '/'
  return res
}

export function join(...paths) {
  if (paths.length === 0) return '.'
  let joined = ''
  for (let i = 0; i < paths.length; i++) {
    const arg = paths[i]
    assertPath(arg)
    if (arg !== '') {
      if (joined === '') joined = arg
      else joined += '/' + arg
    }
  }
  if (joined === '') return '.'
  return normalize(joined)
}

export function dirname(path) {
  assertPath(path)
  if (path.length === 0) return '.'
  const hasRoot = path.charCodeAt(0) === 47 /* /*/
  let end = -1
  let matchedNonSlash = false
  for (let i = path.length - 1; i >= 0; i--) {
    if (path.charCodeAt(i) === 47 /* /*/) {
      if (!matchedNonSlash) continue
      end = i
      break
    }
    matchedNonSlash = true
  }
  if (end === -1) return hasRoot ? '/' : '.'
  if (end === 0) return '/'
  return path.slice(0, end)
}

export function basename(path, ext) {
  assertPath(path)
  let start = 0
  let end = path.length
  for (let i = end - 1; i >= 0; i--) {
    if (path.charCodeAt(i) === 47 /* /*/) {
      if (i === end - 1) {
        end = i
        continue
      }
      start = i + 1
      break
    }
  }
  let base = path.slice(start, end)
  if (ext !== undefined && ext.length && base.endsWith(ext)) base = base.slice(0, -ext.length)
  return base
}

export function extname(path) {
  assertPath(path)
  let end = path.length
  for (let i = end - 1; i >= 0; i--) {
    const code = path.charCodeAt(i)
    if (code === 47 /* /*/) break
    if (code === 46 /* . */) {
      if (i === 0) return ''
      return path.slice(i)
    }
  }
  return ''
}

export function resolve(...paths) {
  let resolved = ''
  for (let i = paths.length - 1; i >= 0; i--) {
    const arg = paths[i]
    assertPath(arg)
    if (arg === '') continue
    resolved = arg + '/' + resolved
    if (arg.charCodeAt(0) === 47 /* /*/) break
  }
  if (resolved === '') return '/'
  return normalize(resolved)
}

export function isAbsolute(path) {
  assertPath(path)
  return path.length > 0 && path.charCodeAt(0) === 47 /* /*/
}

export const sep = '/'
export const delimiter = ':'
export const posix = { normalize, join, dirname, basename, extname, resolve, isAbsolute, sep, delimiter }
export default posix
