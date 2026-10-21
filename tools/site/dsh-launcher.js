// 教学专用「浏览器启动器」——等价于仓库根目录的 launcher.ts。
//
// 与 launcher.ts 的区别只有三处：
// 1. cordis.yml 不通过 include 插件读取（它依赖磁盘上的 yml 写回），
//    而是直接 fetch 课程目录下的 cordis.yml 再解析；
// 2. 退出方式：Node 里进程自然退出即可，浏览器里由页面在输出平息后
//    调 dispose() 清掉计时器；
// 3. 支持「改了再跑」：只要本课有任何一个文件被改过，整课 .ts 都会在
//    浏览器里现场编译（sucrase，与构建期 esbuild 同为「只剥类型」），
//    全部经 blob 模块加载——磁盘上的 canonical .js 一个都不碰。这样
//    「还原修改」「反复改同一文件」都天然干净：import map 一旦注册
//    无法撤销，但我们的 key 全部带内容哈希，每版独立、互不覆盖。

import { Context } from './cordis.js'
import Loader from './cordis-plugin-loader.js'
import { parseYmlEntries } from './yml-entries.js'

// FiberState：0 PENDING / 1 LOADING / 2 ACTIVE / 3 FAILED / 4 UNLOADING / 5 DISPOSED
const FiberState = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, UNLOADING: 4, DISPOSED: 5 }

// 相对导入改写：blob 模块没有基址，一律换成「绝对 URL + 内容哈希」。
// 静态 from './x.ts' / 动态 import('./x.ts') 都处理，扩展名统一换 .js。
const REL_FROM = /(\bfrom\s*)(['"])(\.\.?\/[^'"]*?)\.(?:ts|js)\2/g
const REL_IMPORT = /(\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*?)\.(?:ts|js)\2/g

// blob 缓存：同一段编译产物跨运行复用。
const blobCache = new Map()

function hashSource(source) {
  let h = 5381
  for (let i = 0; i < source.length; i++) h = ((h << 5) + h + source.charCodeAt(i)) | 0
  return h.toString(36)
}

// plugin-directory 的浏览器补丁——与构建脚本 tools/build-site.mjs 里的
// 三处替换保持一致（manifest 扩展名 / 绝对 URL 扩展名 / manifest 覆盖钩子）。
// 幂等：输入可能已经带补丁（如旧版 content.json），特征齐了就直接放行。
function patchPluginDirectorySource(source, fileName) {
  if (source.includes('__DSH_MANIFEST__') && source.includes('/manifest.js`')) return source
  const before = source
  source = source.replace('/manifest.ts`', '/manifest.js`')
  source = source.replace(
    'const manifest = (await import(manifestUrl.href)) as { default: DirectoryManifest }',
    'const manifest = (await import((globalThis as any).__DSH_MANIFEST__ ?? manifestUrl.href)) as { default: DirectoryManifest }',
  )
  source = source.replace(
    'const url = new URL(`${dir.replace(/\\/$/, \'\')}/${plugin}`, this.ctx.baseUrl)',
    'const url = new URL(`${dir.replace(/\\/$/, \'\')}/${plugin.replace(/\\.ts$/, \'.js\')}`, this.ctx.baseUrl)',
  )
  if (source === before || !source.includes('__DSH_MANIFEST__')) {
    throw new Error(`${fileName} 的浏览器补丁未命中——源码变了，请同步更新补丁`)
  }
  return source
}

/**
 * 编译整课（仅在本课有编辑时调用）。
 * @param lessonUrl 课程目录绝对 URL（/ 结尾）
 * @param sources { '文件名.ts': 源码 }——该课全部 .ts（未编辑的给原文）
 * @param write 终端输出
 * @returns { canonicalUrl('….js') → { url: blob 或带哈希 URL, ns: 模块命名空间 Promise } }
 */
async function compileLesson(lessonUrl, sources, write) {
  const { default: sucrase } = await import('./sucrase.js')

  // 1) 全部转译 + 相对导入改写成 canonical?__dsh_edit=<hash>
  //    hash 基于目标文件的实际内容 → 内容变则 key 变，import map 永不覆盖。
  const compiled = new Map() // fileName.ts -> { js }
  const hashOf = new Map()   // fileName.ts -> hash
  for (const [fileName, source] of Object.entries(sources)) {
    let finalSource = source
    if (fileName === 'plugin-directory.ts') finalSource = patchPluginDirectorySource(source, fileName)
    let js
    try {
      js = sucrase.transform(finalSource, { transforms: ['typescript'] }).code
    } catch (err) {
      throw new Error(`转译 ${fileName} 失败（改过的代码有语法错误？）：${err.message}`)
    }
    compiled.set(fileName, js)
    hashOf.set(fileName, hashSource(finalSource))
  }

  // 2) 每个文件确定「canonical?__dsh_edit=hash」URL；相对导入改写成该形式
  const versionedUrl = new Map() // fileName.ts -> canonical?hash URL
  for (const [fileName] of compiled) {
    const canonical = new URL(fileName.replace(/\.ts$/, '.js'), lessonUrl).href
    versionedUrl.set(fileName, `${canonical}?__dsh_edit=${hashOf.get(fileName)}`)
  }

  // 3) 重写相对导入后生成 blob，并注册 import map（静态导入的传导全靠
  //    它；key 带内容哈希，每版独立、永不互相覆盖）
  const importMapEntries = {}
  for (const [fileName] of compiled) {
    const js = rewriteImpl(compiled.get(fileName), lessonUrl, versionedUrl)
    importMapEntries[versionedUrl.get(fileName)] = blobOf(js)
  }
  registerImportMap(importMapEntries, write)

  // 4) canonical → 模块命名空间（给 Loader 的 internal resolver 用）
  const byCanonical = new Map()
  for (const [fileName] of compiled) {
    const canonical = new URL(fileName.replace(/\.ts$/, '.js'), lessonUrl).href
    byCanonical.set(canonical, import(importMapEntries[versionedUrl.get(fileName)]))
  }
  return { byCanonical, manifestUrl: versionedUrl.get('manifest.ts') ?? null }
}

function rewriteImpl(js, lessonUrl, versionedUrl) {
  return js
    .replace(REL_FROM, (_m, pre, q, spec) => `${pre}${q}${resolveSpec(spec, lessonUrl, versionedUrl)}${q}`)
    .replace(REL_IMPORT, (_m, pre, q, spec) => `${pre}${q}${resolveSpec(spec, lessonUrl, versionedUrl)}${q}`)
}

function resolveSpec(spec, lessonUrl, versionedUrl) {
  // './llm' → 同名 .ts 的 versioned URL；对不上（不应发生）退回绝对 .js
  for (const [fileName, versioned] of versionedUrl.entries()) {
    if (new URL(spec.replace(/\.(ts|js)$/, '') + '.ts', lessonUrl).href === new URL(fileName, lessonUrl).href) {
      return versioned
    }
  }
  return new URL(spec.replace(/\.(ts|js)$/, '') + '.js', lessonUrl).href
}

function blobOf(js) {
  const key = 'js:' + hashSource(js)
  if (!blobCache.has(key)) {
    blobCache.set(key, URL.createObjectURL(new Blob([js], { type: 'text/javascript' })))
  }
  return blobCache.get(key)
}

/**
 * 注册 import map。多 import map 需要 Chrome 133+；不支持时静态导入
 * 无法顶替（报错事件里提示），入口文件仍经 resolver 生效。
 */
function registerImportMap(entries, write) {
  if (!Object.keys(entries).length) return
  const s = document.createElement('script')
  s.type = 'importmap'
  s.textContent = JSON.stringify({ imports: entries })
  s.addEventListener('error', () => {
    write?.('(提示：本浏览器不支持运行时追加 import map——被改文件之间的静态导入可能拿到未修改版本，刷新页面可重置)')
  })
  document.head.append(s)
}

/**
 * 运行一课。
 * @param lessonUrl 课程目录的绝对 URL（以 / 结尾），如 https://…/lessons/part1/01-first-plugin/
 * @param write 往终端写一行的回调（已含换行语义，传纯文本）
 * @param options.stripDisabled 为 true 时忽略 yml 里的 disabled 标记（教学启用模式）
 * @param options.edits { '文件名.ts': 改过的完整源码 }——有则整课现场编译
 * @param options.sources { '文件名.ts': 原源码 }——本课全部 .ts 原文（页面从 content.json 提供）
 * @param options.editedYml 改过的 cordis.yml 全文（有则不再 fetch 磁盘版本）
 */
export async function runLesson(lessonUrl, write, options = {}) {
  if (!lessonUrl.endsWith('/')) lessonUrl += '/'
  const edits = options.edits ?? {}
  delete globalThis.__DSH_MANIFEST__

  // ---------- 改动编译：整课 blob 化 ----------
  let overrides = null // Map<canonical .js URL, Promise<ns>>
  if (Object.keys(edits).length) {
    const sources = {}
    for (const [fileName, original] of Object.entries(options.sources ?? {})) {
      sources[fileName] = edits[fileName] ?? original
    }
    for (const [fileName, edited] of Object.entries(edits)) {
      sources[fileName] = edited
    }
    const compiled = await compileLesson(lessonUrl, sources, write)
    overrides = compiled.byCanonical
    if (compiled.manifestUrl) globalThis.__DSH_MANIFEST__ = compiled.manifestUrl
  }

  const ctx = new Context()
  ctx.baseUrl = lessonUrl

  // 把日志打到页面终端：默认只有一个内存缓冲 exporter，不配置就什么都看不到
  ctx.logger.exporter({
    colors: 0,
    export: (message) => {
      const text = message.args
        .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg)))
        .join(' ')
      write(`[${message.name}] ${text}`)
      // Loader 动态 import 插件失败（最常见原因：浏览器缓存的新旧构建混用，
      // 旧启动器会去 fetch 已不存在的 .ts）——补一句能照做的提示
      if (
        message.name === 'loader'
        && message.args.some((arg) => /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(String(arg?.message ?? arg)))
      ) {
        write('提示：多半是浏览器缓存了旧版页面资源——刷新本页（⌘R / Ctrl+R）即可解决。')
      }
    },
  })

  await ctx.plugin(Loader)

  // 接管 Loader 的模块解析：本课有编辑时，入口插件也必须拿到 blob 版。
  // Loader 的 EntryTree.import 会优先走 loader.internal（Node 内部加载器
  // 在浏览器里本来就是 undefined，这里名正言顺地补上浏览器版）。
  if (overrides) {
    ctx.loader.internal = {
      import: async (name, base) => {
        const abs = new URL(name, base ?? lessonUrl).href
        // yml/manifest 里的条目名是 canonical（不带哈希）——靠 resolver 映射到 blob
        if (overrides.has(abs)) return await overrides.get(abs)
        // 带哈希的（plugin-directory 造的 URL 已被构建补丁换成 .js，但这里
        // 仍兜底剥掉查询串再查一次）
        const bare = abs.replace(/\?__dsh_edit=[\w-]+$/, '')
        if (overrides.has(bare)) return await overrides.get(bare)
        return await import(abs)
      },
    }
  }

  // 读取 cordis.yml（或用页面传来的改过版本）
  let ymlText = options.editedYml ?? null
  if (ymlText === null) {
    const response = await fetch(new URL('cordis.yml', lessonUrl))
    if (!response.ok) throw new Error(`读取 cordis.yml 失败：HTTP ${response.status}`)
    ymlText = await response.text()
  }
  const entries = parseYmlEntries(ymlText)
  for (const entry of entries) {
    if (options.stripDisabled) delete entry.disabled
    // Cordis Loader 会把条目名拼成绝对 URL 再动态 import，它的 .ts→.js
    // 改写只对 ./ 开头的相对串生效，绝对 URL 会原样发出（浏览器里 .ts
    // 的 MIME 不合法）。这里在条目名层面先把扩展名换成 .js。
    if (typeof entry.name === 'string' && entry.name.endsWith('.ts')) {
      entry.name = entry.name.replace(/\.ts$/, '.js')
    }
    await ctx.loader.create(entry)
  }

  // 等所有插件的加载/生命周期任务尘埃落定
  await ctx.loader.await()

  // 应用启动完成：谁没跑起来、为什么
  let hasFailure = false
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) {
      if (fiber.state === FiberState.ACTIVE) continue
      const name = fiber.name
      if (fiber.state === FiberState.PENDING) {
        write(`[launcher] 插件未激活（PENDING，可能在等待依赖）：${name}`)
      } else if (fiber.state === FiberState.FAILED) {
        write(`[launcher] 插件加载失败（FAILED）：${name}`)
        hasFailure = true
      }
    }
  }

  return { ctx, hasFailure }
}
