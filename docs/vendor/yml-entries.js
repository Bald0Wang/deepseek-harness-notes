// 教学仓库 cordis.yml 的定向解析器。
//
// 这些 yml 只用到了一个极小的子集：
//   - 顶层是数组，每项以 “- ” 开头；
//   - 每项的字段：id? / name / disabled? / config?；
//   - config 下再一层缩进的键值（字符串、true/false、行内数组）。
// 解析器遇到任何超出该子集的行都会抛错——宁可失败，不可悄悄装错。

function parseValue(raw) {
  const s = raw.trim()
  if (s.startsWith('\'') && s.endsWith('\'') && s.length >= 2) return s.slice(1, -1).replace(/''/g, '\'')
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1).replace(/\\"/g, '"')
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  // 行内数组：['alpha', 'beta']
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((piece) => parseValue(piece))
  }
  if (s.startsWith('{')) throw new Error(`cordis.yml 解析器不支持行内对象：${s}`)
  // 未加引号的字符串（如 ./main.ts）
  if (/[:#{}]/.test(s)) throw new Error(`cordis.yml 解析器无法理解该值：${s}`)
  return s
}

function indentOf(line) {
  const match = /^[ \t]*/.exec(line)
  return match[0].replace(/\t/g, '  ').length
}

/**
 * 把 cordis.yml 文本解析成 loader.create 的条目数组。
 * @param {string} text yml 原文
 * @returns {Array<{ id?: string, name: string, disabled?: boolean, config?: object }>}
 */
export function parseYmlEntries(text) {
  const source = text.replace(/^\uFEFF/, '')
  const entries = []
  let current = null
  let inConfig = false

  for (const rawLine of source.split(/\r?\n/)) {
    // 本仓库的 yml 注释都是整行或行尾注释；行尾注释前必有空白。
    const noComment = rawLine.replace(/(^|\s)#.*$/, '')
    if (!noComment.trim()) continue
    const indent = indentOf(noComment.trimEnd())

    // 新条目：顶层的 “- key: value”
    const entryMatch = /^- ([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(noComment)
    if (indent === 0 && entryMatch) {
      inConfig = false
      const [, key, value] = entryMatch
      current = {}
      entries.push(current)
      if (value === undefined || value === '') {
        if (key !== 'config') throw new Error(`cordis.yml 条目里的 ${key}: 后面必须跟值（除 config 外）`)
        current.config = {}
        inConfig = true
      } else {
        current[key] = parseValue(value)
      }
      continue
    }

    // 续行：条目字段（2 空格）或 config 子字段（4 空格）
    const kv = /^\s+([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(noComment)
    if (!kv || !current) throw new Error(`cordis.yml 解析器遇到不认识的行：${rawLine}`)
    const [, key, value] = kv

    if (value === undefined || value === '') {
      if (key === 'config' && indent === 2) {
        current.config = {}
        inConfig = true
      } else {
        throw new Error(`cordis.yml 解析器不支持嵌套块（${key}:）：${rawLine}`)
      }
      continue
    }

    if (inConfig && indent >= 4) {
      current.config[key] = parseValue(value)
    } else if (indent === 2) {
      if (key === 'config') throw new Error(`cordis.yml 不支持行内 config：${rawLine}`)
      current[key] = parseValue(value)
      inConfig = false
    } else {
      throw new Error(`cordis.yml 缩进不符合预期：${rawLine}`)
    }
  }

  for (const entry of entries) {
    if (typeof entry.name !== 'string') throw new Error(`cordis.yml 条目缺少 name：${JSON.stringify(entry)}`)
  }
  return entries
}
