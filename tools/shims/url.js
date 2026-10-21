// node:url 的浏览器 shim：伪 file:// URL 与路径字符串互转。

export function pathToFileURL(path) {
  let s = String(path).replace(/\\/g, '/')
  if (!s.startsWith('/')) s = '/' + s
  const encoded = encodeURI(s).replace(/[?#]/g, encodeURIComponent)
  return { href: 'file://' + encoded, pathname: encoded, protocol: 'file:', host: '', search: '', hash: '' }
}

export function fileURLToPath(url) {
  const s = typeof url === 'string' ? url : url.href
  if (!s.startsWith('file://')) throw new Error(`URL must be of scheme file: ${s}`)
  return decodeURIComponent(s.slice('file://'.length) || '/')
}

export default { pathToFileURL, fileURLToPath }
