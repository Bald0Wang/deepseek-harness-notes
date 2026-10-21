// 站点构建脚本：node tools/build-site.mjs
//
// 做五件事：
// 1. 把 27 课的 .ts 逐文件转译成浏览器可加载的 .js（保留原目录结构），
//    并给 plugin-directory.ts 打两处扩展名补丁（浏览器里 .ts 的 MIME 不合法）；
// 2. vendor 一组运行时（cordis / loader / schemastery / cosmokit / marked / hljs）；
// 3. 在 Node 里真实跑一遍每一课，把输出存成「参考输出」（页面端对照用）；
// 4. 汇总课程内容（md、源码、yml）成 content.json；
// 5. 把 tools/site 的页面与 tools/shims 的 shim 拷进 docs/。

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { COURSE } from './site/course-data.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')

// ---------- 0. 清场 ----------

rmSync(docs, { recursive: true, force: true })
for (const dir of ['', '/vendor', '/shims', '/lessons', '/expected', '/assets']) {
  mkdirSync(join(docs, dir), { recursive: true })
}
writeFileSync(join(docs, '.nojekyll'), '')

// ---------- 1. 转译课程 ----------

const lessonDirs = []
for (const part of readdirSync(join(root, 'lessons')).sort()) {
  const partPath = join(root, 'lessons', part)
  if (!statSync(partPath).isDirectory()) continue
  for (const lesson of readdirSync(partPath).sort()) {
    const lessonPath = join(partPath, lesson)
    if (!statSync(lessonPath).isDirectory()) continue
    // part0 这类纯阅读篇没有代码目录
    if (!existsSync(join(lessonPath, 'cordis.yml'))) continue
    lessonDirs.push({ part, lesson, lessonPath })
  }
}

// 静态导入：from './x.ts' → from './x.js'
const TS_FROM_RE = /(\bfrom\s*)(['"])(\.\.?\/[^'"]*?)\.ts\2/g
// 动态导入：import('./x.ts') → import('./x.js')
const TS_IMPORT_CALL_RE = /(\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*?)\.ts\2/g

async function transpileLesson({ part, lesson, lessonPath }) {
  const outDir = join(docs, 'lessons', part, lesson)
  mkdirSync(outDir, { recursive: true })
  const sources = {}
  let isPluginDirectory = false
  let patchedPluginDirectory = false

  for (const file of readdirSync(lessonPath).sort()) {
    const srcPath = join(lessonPath, file)
    if (file === 'cordis.yml') {
      cpSync(srcPath, join(outDir, file))
      continue
    }
    if (!file.endsWith('.ts')) continue

    let source = readFileSync(srcPath, 'utf8')

    // plugin-directory 在浏览器里用绝对 URL 动态 import manifest.ts /
    // 各插件 .ts，Cordis Loader 的相对路径改写管不到绝对 URL，这里补上。
    // 另外加一个 manifest 覆盖钩子（__DSH_MANIFEST__）：默认不生效，
    // 第 27 课「真 API」模式用它换成去掉 mock 的 manifest 变体。
    if (file === 'plugin-directory.ts') {
      isPluginDirectory = true
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
      if (source !== before) patchedPluginDirectory = true
    }

    sources[file] = source

    const result = await esbuild.transform(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      legalComments: 'none',
      sourcefile: file,
    })
    // 相对导入的 .ts 扩展名改写成 .js（静态与动态导入都改）。
    const js = result.code
      .replace(TS_FROM_RE, (_m, pre, q, spec) => `${pre}${q}${spec}.js${q}`)
      .replace(TS_IMPORT_CALL_RE, (_m, pre, q, spec) => `${pre}${q}${spec}.js${q}`)
    writeFileSync(join(outDir, file.replace(/\.ts$/, '.js')), js)
  }

  if (isPluginDirectory && !patchedPluginDirectory) {
    throw new Error(`${part}/${lesson}/plugin-directory.ts 补丁未命中——源码变了，请更新补丁`)
  }

  return { sources, patchedPluginDirectory }
}

const lessons = []
for (const dir of lessonDirs) {
  const { sources, patchedPluginDirectory } = await transpileLesson(dir)
  lessons.push({ ...dir, sources, patchedPluginDirectory })
}
console.log(`转译完成：${lessons.length} 课（其中 ${lessons.filter((l) => l.patchedPluginDirectory).length} 课打了 plugin-directory 补丁）`)

// ---------- 2. vendor 运行时 ----------

const vendorDir = join(docs, 'vendor')
const copyVendor = (pkgFile, outName) => {
  const src = join(root, 'node_modules', pkgFile)
  if (!existsSync(src)) throw new Error(`vendor 源不存在：${pkgFile}`)
  cpSync(src, join(vendorDir, outName))
  return join(vendorDir, outName)
}

copyVendor('@deepseek-ai/cordis/lib/index.js', 'cordis.js')
copyVendor('@deepseek-ai/cosmokit/lib/index.js', 'cosmokit.js')
copyVendor('@deepseek-ai/cordis-plugin-loader/lib/index.js', 'cordis-plugin-loader.js')
copyVendor('@deepseek-ai/schemastery/lib/index.mjs', 'schemastery.js')
copyVendor('marked/lib/marked.esm.js', 'marked.esm.js')

// schemastery 声明为零依赖；这里做个断言，防止未来版本引入新依赖。
for (const file of ['cordis.js', 'cosmokit.js', 'cordis-plugin-loader.js', 'schemastery.js']) {
  const code = readFileSync(join(vendorDir, file), 'utf8')
  const bad = [...code.matchAll(/from\s+["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:') && !spec.startsWith('@deepseek-ai/'))
  if (bad.length) throw new Error(`${file} 引入了未映射的裸依赖：${bad.join(', ')}`)
}

await esbuild.build({
  entryPoints: [join(root, 'node_modules/highlight.js/lib/common.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  outfile: join(vendorDir, 'hljs.js'),
})
cpSync(
  join(root, 'node_modules/highlight.js/styles/github-dark.min.css'),
  join(docs, 'assets', 'hljs.css'),
)

// 页面 authored 资产
cpSync(join(root, 'tools/site/dsh-launcher.js'), join(vendorDir, 'dsh-launcher.js'))
cpSync(join(root, 'tools/site/yml-entries.js'), join(vendorDir, 'yml-entries.js'))
for (const shim of readdirSync(join(root, 'tools/shims'))) {
  cpSync(join(root, 'tools/shims', shim), join(docs, 'shims', shim))
}

// 用同一份解析器在构建期校验所有 yml（宁可构建失败，不可线上装错）。
{
  const { parseYmlEntries } = await import(join(root, 'tools/site/yml-entries.js'))
  for (const lesson of lessons) {
    parseYmlEntries(readFileSync(join(lesson.lessonPath, 'cordis.yml'), 'utf8'))
  }
  console.log('cordis.yml 解析校验通过')
}

// ---------- 3. Node 参考输出 ----------

function captureNodeRun({ part, lesson, lessonPath }) {
  // 课程会把 .sessions/ 写进课目录；它被 git 忽略，git clean 清不掉，
  // 必须显式删除，否则跨构建累积会让参考输出变成“第 N 次运行”。
  // part2 的课也一律从空日志起跑——各课 md 的「跑起来」写的是首次运行；
  // 「再跑一次」的第二次运行由课文自己演示，不靠仓库里残留的 .sessions。
  rmSync(join(lessonPath, '.sessions'), { recursive: true, force: true })
  const started = Date.now()
  const proc = spawnSync('node', ['--import', 'tsx/esm', '../../../launcher.ts'], {
    cwd: lessonPath,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, DEEPSEEK_API_KEY: '' },
    encoding: 'utf8',
  })
  const ms = Date.now() - started
  const output = `${proc.stdout ?? ''}${proc.stderr ? `\n[stderr]\n${proc.stderr}` : ''}`
  const status = proc.status === null ? 'killed' : proc.status
  // 跑完立即还原，避免脏状态串扰/入库。
  spawnSync('git', ['checkout', '--', '.'], { cwd: lessonPath })
  spawnSync('git', ['clean', '-fdq'], { cwd: lessonPath })
  rmSync(join(lessonPath, '.sessions'), { recursive: true, force: true })
  return { output, ms, ok: proc.status === 0 && !proc.killed, status }
}

const expectedDir = join(docs, 'expected')
for (const lesson of lessons) {
  const id = `${lesson.part}-${lesson.lesson}`
  const run = captureNodeRun(lesson)
  writeFileSync(join(expectedDir, `${id}.txt`), run.output)
  lesson.nodeRun = run
  const flag = run.ok ? 'ok' : `exit=${run.status}`
  console.log(`  Node 参考：${id} [${flag}] ${run.ms}ms，${run.output.length} 字符`)

  // 仓库里带着 disabled 条目的课（如 02）：再采一份「去掉 disabled」的教学启用版。
  const ymlPath = join(lesson.lessonPath, 'cordis.yml')
  const ymlText = readFileSync(ymlPath, 'utf8')
  if (/^\s*disabled:/m.test(ymlText)) {
    lesson.hasDisabled = true
    const enabledYml = ymlText
      .split('\n')
      .filter((line) => !/^\s*disabled:/.test(line))
      .join('\n')
    writeFileSync(ymlPath, enabledYml)
    const run2 = captureNodeRun(lesson)
    writeFileSync(join(expectedDir, `${id}.enabled.txt`), run2.output)
    lesson.nodeRunEnabled = run2
    const flag2 = run2.ok ? 'ok' : `exit=${run2.status}`
    console.log(`  Node 参考：${id}（教学启用版） [${flag2}] ${run2.ms}ms，${run2.output.length} 字符`)
  }
}

// ---------- 4. content.json ----------

const partMeta = {
  'part0-typescript-primer': { id: 'part0', label: '第 0 篇', title: 'TypeScript 零基础速查' },
  part1: { id: 'part1', label: '第一篇', title: 'Cordis 插件内核' },
  part2: { id: 'part2', label: '第二篇', title: 'Harness 的工具与记忆' },
  part3: { id: 'part3', label: '第三篇', title: '组装一个能跑的 Agent' },
}

function firstHeading(md, fallback) {
  for (const line of md.split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim()
  }
  return fallback
}

const content = {
  generatedAt: new Date().toISOString(),
  intro: readFileSync(join(root, 'README.md'), 'utf8'),
  parts: [],
}

// 第 27 课真 API 的模型 id（页面的「测试 Key」用同一模型发一条 1-token 请求）
{
  const rp = join(root, 'lessons/part3/27-real-api/real-provider.ts')
  const m = /const MODEL = '([^']+)'/.exec(readFileSync(rp, 'utf8'))
  content.realApiModel = m ? m[1] : 'deepseek-chat'
}

for (const [dirName, meta] of Object.entries(partMeta)) {
  const partPath = join(root, 'lessons', dirName)
  if (!existsSync(partPath)) continue
  const part = { ...meta, dir: dirName, readme: readFileSync(join(partPath, 'README.md'), 'utf8'), lessons: [] }

  for (const lesson of lessons.filter((l) => l.part === dirName)) {
    const mdPath = join(lesson.lessonPath, 'main.md')
    const md = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : ''
    const yml = readFileSync(join(lesson.lessonPath, 'cordis.yml'), 'utf8')
    const num = Number.parseInt(lesson.lesson.split('-')[0], 10)
    const relDir = `lessons/${lesson.part}/${lesson.lesson}/`
    const files = Object.entries(lesson.sources).map(([name, code]) => ({ name, code }))

    part.lessons.push({
      id: `p${num}`,
      num,
      dir: relDir,
      slug: lesson.lesson,
      title: firstHeading(md, lesson.lesson),
      md,
      yml,
      files,
      command: `cd ${relDir} && node --import tsx/esm ../../../launcher.ts`,
      nodeRun: { ok: lesson.nodeRun.ok, ms: lesson.nodeRun.ms },
      hasDisabled: Boolean(lesson.hasDisabled),
      nodeRunEnabled: lesson.nodeRunEnabled ? { ok: lesson.nodeRunEnabled.ok, ms: lesson.nodeRunEnabled.ms } : null,
      isRealApi: lesson.lesson === '27-real-api',
      meta: COURSE.lessons[num] || null,
    })
  }
  content.parts.push(part)
}

writeFileSync(join(docs, 'content.json'), JSON.stringify(content))
console.log(`content.json：${content.parts.flatMap((p) => p.lessons).length} 课`)

// ---------- 5. 页面骨架 ----------

cpSync(join(root, 'tools/site/index.html'), join(docs, 'index.html'))
cpSync(join(root, 'tools/site/app.js'), join(docs, 'assets', 'app.js'))
cpSync(join(root, 'tools/site/app.css'), join(docs, 'assets', 'app.css'))
for (const file of ['course-map.js', 'course-data.js', 'lesson-facts.js']) {
  cpSync(join(root, 'tools/site', file), join(docs, 'assets', file))
}

console.log('构建完成 → docs/')
