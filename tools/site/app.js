// 教程站点主应用。
// 运行模型：点击「运行」→ 动态 import 浏览器启动器 → 启动器创建 Cordis
// Context、加载本课 cordis.yml 声明的插件 → 插件代码（转译自原 .ts）在
// 浏览器里真跑：console/process.stdout 进终端，node:fs 落在内存文件系统。

import { marked } from '../vendor/marked.esm.js'
import hljs from '../vendor/hljs.js'
import { renderIntroOverview, renderMapPage, renderLessonAside, renderLessonBrief, renderMechanism } from './course-map.js'

marked.setOptions({ gfm: true, breaks: false })

const $ = (sel, el = document) => el.querySelector(sel)
const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 全局状态 ----------

const state = {
  content: null,
  lesson: null,       // 当前课
  expected: null,     // 当前课的 Node 参考输出
  runnerMod: null,    // 懒加载的浏览器启动器
  running: false,
  runResults: loadRunResults(),
}

function loadRunResults() {
  try { return JSON.parse(localStorage.getItem('dsh-run-results') || '{}') } catch { return {} }
}
function saveRunResults() {
  try { localStorage.setItem('dsh-run-results', JSON.stringify(state.runResults)) } catch {}
}

// ---------- 代码修改存储 ----------
// { 'p14/main.ts': '改过的完整源码', 'p5/cordis.yml': '…' }
// 只存浏览器 localStorage；「还原代码修改」按课清空。

function loadCodeEdits() {
  try { return JSON.parse(localStorage.getItem('dsh-code-edits') || '{}') } catch { return {} }
}
function saveCodeEdits(all) {
  try { localStorage.setItem('dsh-code-edits', JSON.stringify(all)) } catch (e) {
    termAppend('t-warn', '（保存修改失败：浏览器存储空间不足）\n')
  }
}
function lessonEdits(lesson) {
  const prefix = lesson.id + '/'
  return Object.fromEntries(
    Object.entries(loadCodeEdits()).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]),
  )
}
function setCodeEdit(lesson, file, source) {
  const all = loadCodeEdits()
  const key = lesson.id + '/' + file
  if (source === null) delete all[key]
  else all[key] = source
  saveCodeEdits(all)
}
function clearLessonEdits(lesson) {
  const all = loadCodeEdits()
  for (const key of Object.keys(all)) {
    if (key.startsWith(lesson.id + '/')) delete all[key]
  }
  saveCodeEdits(all)
}

// ---------- 内容与路由 ----------

async function boot() {
  const res = await fetch('./content.json')
  state.content = await res.json()
  checkBuildConsistency()
  // 标题里的行内代码反引号（如 deriveMessages()）在页面标题里不需要，
  // 正文里的代码块由 markdown 正常渲染。
  for (const part of state.content.parts) {
    for (const lesson of part.lessons) lesson.title = lesson.title.replace(/`/g, '')
  }
  renderSidebar()
  window.addEventListener('hashchange', route)
  route()
}

// 页面（index.html/app.js）与内容（content.json）可能来自不同次构建——
// 浏览器或 CDN 的缓存各过期各的。混用最典型的症状：旧启动器去 fetch
// main.ts（新构建里只有 main.js），终端报 Failed to fetch dynamically
// imported module。检测到不一致就挂横幅引导刷新。
function checkBuildConsistency() {
  const pageBuild = globalThis.__DSH_BUILD__ || ''
  const contentBuild = state.content.buildId || ''
  if (!pageBuild || !contentBuild || pageBuild === contentBuild) return
  const banner = el('div', 'stale-banner')
  const text = el('span')
  text.append('⚠️ 站点刚更新过，本页面加载的还是旧版资源（继续使用可能出现「Failed to fetch dynamically imported module」之类的报错）。')
  const reload = el('button', 'btn btn-primary', '刷新到最新版')
  reload.addEventListener('click', () => location.reload())
  banner.append(text, reload)
  document.body.prepend(banner)
}

function lessons() {
  return state.content.parts.flatMap((p) => p.lessons)
}

function findPage(hash) {
  // #/intro | #/map | #/part0 | #/p12
  const id = hash.replace(/^#\/?/, '') || 'intro'
  if (id === 'intro') return { kind: 'intro' }
  if (id === 'map') return { kind: 'map' }
  const part = state.content.parts.find((p) => p.id === id)
  if (part) return { kind: 'part', part }
  const lesson = lessons().find((l) => l.id === id)
  if (lesson) return { kind: 'lesson', lesson }
  return { kind: 'intro' }
}

function route() {
  const page = findPage(location.hash)
  $('#sidebar').classList.remove('open')
  if (page.kind === 'lesson') renderLesson(page.lesson)
  else if (page.kind === 'part') renderPart(page.part)
  else if (page.kind === 'map') renderMap()
  else renderIntro()
  highlightSidebar(page)
  if (page.kind === 'lesson') {
    try { localStorage.setItem('dsh-last-lesson', page.lesson.id) } catch {}
    syncContinue()
  }
  window.scrollTo(0, 0)
}

function highlightSidebar(page) {
  const id = page.kind === 'lesson' ? page.lesson.id : page.kind === 'part' ? page.part.id : page.kind === 'map' ? 'map' : 'intro'
  for (const item of document.querySelectorAll('.side-item')) {
    item.classList.toggle('active', item.dataset.id === id)
  }
  // 篇章标题在「浏览该篇介绍页」时点亮；看具体课时也保持高亮归属篇
  for (const title of document.querySelectorAll('.side-part-title')) {
    const owningPart = page.kind === 'part' ? page.part.id : page.kind === 'lesson' ? page.lesson.dir.split('/')[1] : null
    const partId = state.content.parts.find((p) => p.dir === owningPart)?.id ?? owningPart
    title.classList.toggle('active', title.dataset.id === partId)
  }
}

// ---------- 侧栏 ----------

function renderSidebar() {
  const nav = $('#sidebar')
  nav.innerHTML = ''

  const tools = el('div', 'side-tools')
  const search = el('input', 'side-search')
  search.id = 'side-search'
  search.type = 'search'
  search.placeholder = '搜索课程 / 关键词（/）'
  search.autocomplete = 'off'
  search.addEventListener('input', () => filterSidebar(search.value))
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; filterSidebar(''); search.blur() }
  })
  tools.append(search)

  const progress = el('div', 'side-progress')
  const progressText = el('span', null, '0/27')
  progressText.id = 'progress-text'
  const track = el('div', 'progress-track')
  const fill = el('div', 'progress-fill')
  fill.id = 'progress-fill'
  track.append(fill)
  progress.append(progressText, track)
  tools.append(progress)

  const continueLink = el('a', 'side-continue')
  continueLink.id = 'side-continue'
  continueLink.hidden = true
  tools.append(continueLink)
  nav.append(tools)

  const intro = sideItem('intro', '', '教程总览（README）', '', false)
  nav.append(intro)
  const map = sideItem('map', '', '课程全景地图', '', false)
  nav.append(map)

  for (const part of state.content.parts) {
    const section = el('div', 'side-section')
    section.dataset.part = part.id
    // 篇章标题可点：跳到该篇的介绍页（#/part1 等）
    const partTitle = el('a', 'side-part-title', `${part.label} · ${part.title}`)
    partTitle.href = `#/${part.id}`
    partTitle.dataset.id = part.id
    section.append(partTitle)
    for (const lesson of part.lessons) {
      const meta = lesson.meta
      const haystack = [
        lesson.title,
        meta?.shortTitle,
        meta?.oneLiner,
        meta?.gives,
        ...(meta?.concepts || []).map((c) => c.term),
        ...(meta?.dsh || []).map((d) => d.path),
      ].filter(Boolean).join(' ').toLowerCase()
      const item = sideItem(lesson.id, lesson.num, lesson.title.replace(/^\s*\d+\s*[·：:]\s*/, ''), haystack)
      section.append(item)
    }
    nav.append(section)
  }

  refreshDots()
  refreshProgress()
  syncContinue()
}

function sideItem(id, num, title, haystack = '', showDot = true) {
  const item = el('a', 'side-item')
  item.href = `#/${id}`
  item.dataset.id = id
  if (haystack) item.dataset.haystack = haystack
  item.title = title
  if (num !== '') item.append(el('span', 'num', String(num).padStart(2, '0')))
  item.append(el('span', 'title', title))
  if (showDot) {
    const dot = el('span', 'side-dot none')
    dot.dataset.statusFor = id
    item.append(dot)
  }
  return item
}

function filterSidebar(raw) {
  const query = raw.trim().toLowerCase()
  for (const item of document.querySelectorAll('.side-item')) {
    const haystack = item.dataset.haystack
    if (!haystack) continue // 首页 / 全景 永远可见
    item.classList.toggle('side-empty', Boolean(query) && !haystack.includes(query))
  }
  for (const section of document.querySelectorAll('.side-section')) {
    const items = [...section.querySelectorAll('.side-item[data-haystack]')]
    section.classList.toggle('no-match', items.length > 0 && items.every((i) => i.classList.contains('side-empty')))
  }
}

function refreshDots() {
  for (const dot of document.querySelectorAll('.side-dot')) {
    const rec = state.runResults[dot.dataset.statusFor]
    dot.className = `side-dot ${rec ? (rec.ok ? 'ok' : 'bad') : 'none'}`
  }
  refreshProgress()
}

function refreshProgress() {
  const total = lessons().length
  const done = Object.values(state.runResults).filter((r) => r.ok).length
  const text = $('#progress-text')
  const fill = $('#progress-fill')
  if (text) text.textContent = `${done}/${total} 课已跑通`
  if (fill) fill.style.width = `${total ? (done / total) * 100 : 0}%`
}

function syncContinue() {
  const link = $('#side-continue')
  if (!link) return
  let last = ''
  try { last = localStorage.getItem('dsh-last-lesson') || '' } catch {}
  const lesson = lessons().find((l) => l.id === last)
  if (!lesson) { link.hidden = true; return }
  link.hidden = false
  link.href = `#/${lesson.id}`
  link.textContent = `↩ 继续上次 · ${lesson.title.replace(/^\s*\d+\s*[·：:]\s*/, '')}`
}

// ---------- 页面渲染 ----------

function setMain(node) {
  const main = $('#main')
  main.innerHTML = ''
  main.append(node)
}

function renderIntro() {
  state.lesson = null
  const wrap = el('div')
  wrap.append(el('div', 'crumb', '首页'))
  const title = el('h1', 'article-title', 'DeepSeek Harness 实战教程')
  wrap.append(title)
  wrap.append(el('div', 'article-meta', '给 JS 学习者的 TypeScript 插件开发课 · 浏览器交互运行版'))
  wrap.append(renderIntroOverview())
  const article = el('article', 'md')
  article.innerHTML = marked.parse(state.content.intro)
  stripFirstHeading(article)
  fixDocLinks(article)
  wrap.append(article)
  highlightCode(article)
  setMain(wrap)
}

function renderMap() {
  state.lesson = null
  setMain(renderMapPage())
}

function renderPart(part) {
  state.lesson = null
  const wrap = el('div')
  wrap.append(el('div', 'crumb', `${part.label}`))
  wrap.append(el('h1', 'article-title', part.title))
  const article = el('article', 'md')
  article.innerHTML = marked.parse(part.readme)
  stripFirstHeading(article)
  fixDocLinks(article)
  wrap.append(article)
  highlightCode(article)
  setMain(wrap)
}

function renderLesson(lesson) {
  state.lesson = lesson
  state.expected = null

  const wrap = el('div')
  const part = state.content.parts.find((p) => p.lessons.includes(lesson))
  wrap.append(el('div', 'crumb', `${part.label} · ${part.title}`))
  wrap.append(el('h1', 'article-title', lesson.title))

  const meta = el('div', 'article-meta')
  meta.append(
    `${lesson.files.length} 个源文件 · `,
    Object.assign(el('code'), { textContent: lesson.dir }),
  )
  if (lesson.nodeRun) meta.append(` · Node 参考 ${lesson.nodeRun.ms}ms`)
  wrap.append(meta)

  // 源码放最前：先看代码在干嘛，再读讲解；读完用右下角 🚀 跳回来
  const codeSection = buildCodeSection(lesson)
  codeSection.id = 'lesson-code'
  wrap.append(codeSection)

  // 本课在整门课里的位置 + 机制结构图
  const lessonMeta = lesson.meta
  if (lessonMeta) {
    wrap.append(renderLessonBrief(lessonMeta))
    const mechanism = renderMechanism(lessonMeta)
    if (mechanism) wrap.append(mechanism)
  }

  wrap.append(buildRunner(lesson))

  const article = el('article', 'md')
  article.innerHTML = marked.parse(lesson.md)
  stripFirstHeading(article)
  fixDocLinks(article)
  wrap.append(buildSectionNav(article))
  wrap.append(article)
  highlightCode(article)

  // 读完换个说法：生活类比 + 容易懵的点
  const aside = lessonMeta ? renderLessonAside(lessonMeta) : null
  if (aside) wrap.append(aside)

  wrap.append(buildPager(lesson))
  setMain(wrap)
  refreshDots()
  refreshEditIndicators(lesson)
}

function buildPager(lesson) {
  const list = lessons()
  const index = list.findIndex((l) => l.id === lesson.id)
  const prev = index > 0 ? list[index - 1] : null
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null
  const wrap = el('div', 'lesson-pager-wrap')
  const pager = el('nav', 'lesson-pager')
  pager.setAttribute('aria-label', '课节导航')
  if (prev) {
    const link = el('a', 'pager-link prev')
    link.href = `#/${prev.id}`
    link.append(el('span', 'pager-k', '← 上一课'))
    link.append(el('span', 'pager-title', `${String(prev.num).padStart(2, '0')} · ${prev.title.replace(/^\s*\d+\s*[·：:]\s*/, '')}`))
    pager.append(link)
  } else {
    pager.append(el('span'))
  }
  if (next) {
    const link = el('a', 'pager-link next')
    link.href = `#/${next.id}`
    link.append(el('span', 'pager-k', '下一课 →'))
    link.append(el('span', 'pager-title', `${String(next.num).padStart(2, '0')} · ${next.title.replace(/^\s*\d+\s*[·：:]\s*/, '')}`))
    pager.append(link)
  }
  wrap.append(pager)
  wrap.append(el('p', 'pager-hint', '提示：键盘 ← → 可以直接翻课；按 / 搜索课程。'))
  return wrap
}

// 把仓库里的相对 Markdown 链接改写成站内 hash 路由，避免在页面上点出 404。
// 课程文案里的相对路径历史上有几处层级写错（例如 ../part0-...），所以这里
// 不按“当前目录”解析，而是按路径里能认出的模式匹配，容错更高。
function fixDocLinks(scope) {
  for (const a of scope.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || ''
    if (/^(https?:|mailto:|#|\/)/.test(href)) continue
    let m
    if ((m = /part0-typescript-primer\/README\.md$/.exec(href))) {
      a.setAttribute('href', '#/part0')
      continue
    }
    if ((m = /part([1-3])\/README\.md$/.exec(href))) {
      a.setAttribute('href', `#/part${m[1]}`)
      continue
    }
    if ((m = /(?:^|\/)(\d{2})-[^/]+\/main\.md$/.exec(href))) {
      a.setAttribute('href', `#/p${Number(m[1])}`)
      continue
    }
    if (/deepseek-harness\//.test(href)) {
      a.classList.add('broken-doc-link')
      a.title = '真身源码链接：需要在仓库同级检出 DeepSeek Harness v0.2.1-alpha.1 才能打开'
      continue
    }
    if (/\.md($|#)/.test(href)) {
      a.classList.add('broken-doc-link')
      a.title = '这个链接指向仓库里的 Markdown 文件，浏览器站点里没有对应页面'
    }
  }
}

function buildSectionNav(article) {
  const headings = [...article.querySelectorAll('h2')]
  if (headings.length < 2) return document.createDocumentFragment()
  const nav = el('nav', 'section-nav')
  nav.setAttribute('aria-label', '本课小节')
  nav.append(el('span', 'section-nav-k', '小节结构'))
  headings.forEach((heading, index) => {
    heading.id = `sec-${index + 1}`
    const chip = el('button', 'section-chip')
    chip.type = 'button'
    chip.append(el('span', 'section-chip-num', String(index + 1).padStart(2, '0')))
    chip.append(el('span', null, heading.textContent))
    chip.addEventListener('click', () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    nav.append(chip)
  })
  return nav
}

// 页面本身已经有 h1；markdown 文件里同一个标题会再出现一次，去掉重复。
function stripFirstHeading(scope) {
  const heading = scope.querySelector('h1')
  if (heading) heading.remove()
}

function highlightCode(scope) {
  for (const block of scope.querySelectorAll('pre code')) {
    // v11 对打过 data-highlighted 标记的元素会直接跳过——重渲染复用元素时必须清掉
    delete block.dataset.highlighted
    try { hljs.highlightElement(block) } catch { /* 高亮失败不影响阅读 */ }
  }
}

// ---------- 运行面板 ----------

function buildRunner(lesson) {
  const runner = el('section', 'runner')

  // 27 课的 Key 提示
  if (lesson.isRealApi) {
    const note = el('div', 'note-box')
    note.append(el('span', 'icon', '🔑'))
    const text = el('span')
    text.append('本课代码支持真 DeepSeek API：右上角填 Key 后运行，第一行会变成「真模型已注册」，并如实复刻仓库在 Node 里带 Key 的行为——真模型的注册会与先到的 mock 冲突报错、剧本仍由 mock 驱动（real-provider 注入 llm，mock 必须先在：这是本课「换得动」主题的一部分）。')
    text.append(el('br'))
    text.append('「测试」按钮会用你的 Key 真实调用一次 API（1 token）。Key 只保存在你的浏览器 localStorage，不会出现在任何发布文件里。')
    note.append(text)
    runner.append(note)
  }

  // 带 disabled 条目的课（02）：默认按「教学启用」跑（去掉 disabled，
  // 跑出 md 承诺的生命周期输出），可切回「仓库原样」。
  if (lesson.hasDisabled) {
    const note = el('div', 'note-box')
    note.append(el('span', 'icon', 'ℹ'))
    const text = el('span')
    text.append('仓库里这一课的 cordis.yml 带着 disabled: true（按原样运行将毫无输出）。')
    text.append(el('br'))
    text.append('页面默认按「教学启用」模式运行（自动忽略 disabled）；想看仓库原样，切换下面的运行模式。')
    note.append(text)
    runner.append(note)

    const modeRow = el('div', null)
    modeRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim);margin:12px 16px 0'
    modeRow.append(document.createTextNode('运行模式：'))
    const sel = el('select')
    sel.id = 'run-mode'
    sel.style.cssText = 'background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:13px'
    const optA = el('option', null, '教学启用（忽略 disabled）')
    optA.value = 'enabled'
    const optB = el('option', null, '仓库原样（disabled: true）')
    optB.value = 'raw'
    sel.append(optA, optB)
    modeRow.append(sel)
    runner.append(modeRow)
  }

  // 头部：标题 + 按钮 + 状态
  const head = el('div', 'runner-head')
  head.append(el('div', 'runner-title', '⌨ 运行本课'))
  const status = el('span', 'run-status', '待运行')
  status.id = 'run-status'
  head.append(status)
  const resetBtn = el('button', 'btn', '重置文件系统')
  resetBtn.title = '清空本课的内存文件系统（session.jsonl 等），下次运行从头开始'
  resetBtn.addEventListener('click', () => {
    globalThis.__DSH_FS__.clear()
    renderFsPane()
    termAppend('t-meta', '(已清空内存文件系统)\n')
  })
  const resetCodeBtn = el('button', 'btn', '还原代码修改')
  resetCodeBtn.id = 'reset-code-btn'
  resetCodeBtn.hidden = true
  resetCodeBtn.title = '把本课所有被改过的源码/yml 恢复成仓库原版'
  resetCodeBtn.addEventListener('click', () => {
    clearLessonEdits(lesson)
    renderLesson(lesson)
    termAppend('t-meta', '(已还原本课全部代码修改)\n')
  })
  const clearBtn = el('button', 'btn btn-ghost', '清屏')
  clearBtn.addEventListener('click', () => { $('#term').textContent = '' })
  const runBtn = el('button', 'btn btn-primary', '▶ 运行')
  runBtn.id = 'run-btn'
  head.append(resetBtn, resetCodeBtn, clearBtn, runBtn)
  runner.append(head)

  const cmd = el('div', 'runner-cmd')
  cmd.append(el('span', 'dollar', '$'))
  cmd.append(document.createTextNode(lesson.command + '   （在浏览器里等效执行）'))
  const cmdCopy = el('button', 'btn btn-ghost cmd-copy', '复制')
  cmdCopy.title = '复制这条命令，在本地终端运行'
  cmdCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lesson.command)
      cmdCopy.textContent = '已复制'
      setTimeout(() => (cmdCopy.textContent = '复制'), 1200)
    } catch { /* 剪贴板不可用时忽略 */ }
  })
  cmd.append(cmdCopy)
  runner.append(cmd)

  // 终端 / 文件系统 / Node 参考 三个标签页
  const tabs = el('div', 'runner-tabs')
  const tabDefs = [
    ['term', '终端'],
    ['fs', '虚拟文件系统'],
    ['expected', 'Node 参考输出'],
  ]
  const bodies = el('div', 'runner-body')
  for (const [key, label] of tabDefs) {
    const tab = el('div', `runner-tab${key === 'term' ? ' active' : ''}`, label)
    tab.dataset.tab = key
    tab.addEventListener('click', () => {
      for (const t of tabs.children) t.classList.toggle('active', t.dataset.tab === key)
      for (const b of bodies.children) b.style.display = b.dataset.body === key ? '' : 'none'
      if (key === 'fs') renderFsPane()
      if (key === 'expected') renderExpectedPane(lesson)
    })
    tabs.append(tab)
  }
  runner.append(tabs)

  const termPane = el('div', 'term')
  termPane.id = 'term'
  termPane.dataset.body = 'term'
  const fsPane = el('div', 'fs-pane')
  fsPane.dataset.body = 'fs'
  fsPane.style.display = 'none'
  const expectedPane = el('div', 'expected-pane')
  expectedPane.dataset.body = 'expected'
  expectedPane.style.display = 'none'
  bodies.append(termPane, fsPane, expectedPane)
  runner.append(bodies)

  runBtn.addEventListener('click', () => runLesson(lesson))
  return runner
}

// 终端：直接追加文本节点，流式输出天然支持
function termAppend(kind, text) {
  const term = $('#term')
  if (!term) return
  const atBottom = term.scrollTop + term.clientHeight >= term.scrollHeight - 30
  if (kind) {
    const span = el('span', kind)
    span.textContent = text
    term.append(span)
  } else {
    term.append(document.createTextNode(text))
  }
  if (atBottom) term.scrollTop = term.scrollHeight
}

function setStatus(cls, text) {
  const status = $('#run-status')
  if (!status) return
  status.className = `run-status ${cls}`
  status.textContent = text
  status.onclick = null
}

// ---------- 运行引擎 ----------

async function runLesson(lesson) {
  if (state.running) return
  state.running = true
  const runBtn = $('#run-btn')
  runBtn.disabled = true
  runBtn.textContent = '运行中…'
  $('#term').textContent = ''
  setStatus('running', '运行中')
  globalThis.__DSH_CWD__ = '/' + lesson.dir.replace(/\/+$/, '')

  termAppend('t-cmd', `$ ${lesson.command}\n`)
  state.expectedMode = $('#run-mode')?.value ?? null
  const stripDisabled = lesson.hasDisabled && state.expectedMode !== 'raw'
  const t0 = Date.now()
  let lastWrite = Date.now()
  let failed = false

  const write = (text, kind) => {
    lastWrite = Date.now()
    // 过滤宿主浏览器注入的遥测噪音（如 IAB 的 RUM 脚本），不属于课程输出
    if (/\[RUM\]|ArmsEventBridge/.test(text)) return
    termAppend(kind, text)
  }
  globalThis.__DSH_OUT__ = (s) => write(s)

  // 捕获课程代码里的 console.*（进入终端，同时保留原控制台行为）
  const levels = { log: '', info: '', warn: 't-warn', error: 't-err' }
  const originals = {}
  for (const [level, cls] of Object.entries(levels)) {
    originals[level] = console[level]
    console[level] = (...args) => {
      const text = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' ') + '\n'
      write(text, cls)
      originals[level](...args)
    }
  }

  let ctx = null
  // 本课的代码修改：.ts 交给启动器现场转译，yml 直接替代磁盘版本
  const edits = lessonEdits(lesson)
  const editedYml = edits['cordis.yml'] ?? null
  const tsEdits = Object.fromEntries(Object.entries(edits).filter(([f]) => f.endsWith('.ts')))
  const sources = Object.fromEntries(lesson.files.map((f) => [f.name, f.code]))
  if (Object.keys(edits).length) {
    termAppend('t-meta', `(已应用本地代码修改：${Object.keys(edits).join('、')} —— 输出会与 Node 参考不同；还原点「还原代码修改」)\n`)
  }
  try {
    // 构建期会把这里的导入加 ?v=<buildId>；若页面本身是旧构建（?v= 404），
    // 回退到无版本 URL 拉最新文件——旧页面配新启动器是兼容组合
    state.runnerMod ??= await import('../vendor/dsh-launcher.js').catch(() => import('../vendor/dsh-laun' + 'cher.js'))
    const base = new URL(lesson.dir, location.href).href
    const result = await state.runnerMod.runLesson(base, (line) => write(line + '\n'), {
      stripDisabled,
      edits: tsEdits,
      sources,
      editedYml,
    })
    ctx = result.ctx
    if (result.hasFailure) failed = true
  } catch (err) {
    failed = true
    write(`${err?.stack ?? err}\n`, 't-err')
    writeImportFailureHint(err)
  }

  // 等输出平息：课程里有 loader.await() 之后的异步剧情（流式回答、恢复轮），
  // 用「安静窗口 + Node 参考时长」判断结束。
  const nodeMs = (stripDisabled ? lesson.nodeRunEnabled?.ms : lesson.nodeRun?.ms) || lesson.nodeRun?.ms || 10000
  const runStart = t0
  const capMs = Math.min(Math.max(nodeMs * 2 + 8000, 15000), 120000)
  for (;;) {
    await sleep(120)
    const elapsed = Date.now() - runStart
    const quiet = Date.now() - lastWrite
    if (quiet >= 700 && elapsed >= nodeMs * 0.8) break
    if (quiet >= 3000) break
    if (elapsed >= capMs) break
  }

  // Node 里进程跑完就退出；浏览器里手动 dispose 清掉计时器（不产生输出）
  globalThis.__DSH_OUT__ = null
  for (const [level, fn] of Object.entries(originals)) console[level] = fn
  try { await ctx?.dispose() } catch { /* dispose 阶段的异常不影响结果 */ }

  const elapsed = Date.now() - t0
  renderFsPane()

  if (failed) {
    setStatus('bad', `✗ 失败 · ${elapsed}ms`)
  } else {
    const actual = $('#term').textContent
    const verdict = await compareWithNode(lesson, actual)
    state.runResults[lesson.id] = { ok: true, match: verdict?.match ?? null, at: Date.now() }
    saveRunResults()
    refreshDots()
    if (verdict?.match) {
      setStatus('ok', `✓ 完成 · ${elapsed}ms · 与 Node 参考输出一致`)
    } else if (verdict) {
      setStatus('diff', `✓ 完成 · ${elapsed}ms · 与 Node 参考有差异（${verdict.diffLines} 行${Object.keys(edits).length ? '，含本地修改' : ''}，点击查看）`)
      $('#run-status').onclick = () => {
        const tab = document.querySelector('[data-tab="expected"]')
        tab?.click()
      }
    } else {
      setStatus('ok', `✓ 完成 · ${elapsed}ms`)
    }
  }

  runBtn.disabled = false
  runBtn.textContent = '▶ 再跑一次'
  state.running = false
}

// 模块动态加载失败最常见的原因是缓存的新旧构建混用（其次是网络），
// 给一句能直接照做的人话提示。
function writeImportFailureHint(err) {
  const msg = String(err?.message ?? err ?? '')
  if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg)) {
    termAppend('t-warn', '提示：这多半是浏览器缓存了旧版页面资源。刷新本页（⌘R / Ctrl+R）即可解决；若刷新后仍报错，检查网络或稍后再试。\n')
  }
}

function normalizeOutput(text) {
  let s = (text ?? '')
    .replace(/\[RUM\][^\n]*\n?/g, '')
    .replace(/ArmsEventBridge[^\n]*\n?/g, '')
    .replace(/\b\d+(\.\d+)?\s?(ms|毫秒|s|秒)\b/gi, '⟨t⟩')
    .replace(/\b0x[0-9a-f]+\b/gi, '⟨addr⟩')
  // 堆栈帧：Node 与浏览器的调用栈天然不同，折叠成同一个标记；
  // 文件路径取 basename（.ts/.js 差异也抹平）。
  s = s.replace(/[^\s("'（]*\/([A-Za-z0-9_.-]+)\.(ts|js):(\d+):(\d+)/g, '$1:$3')
  s = s.replace(/(^\s+at .*$\n?)+/gm, '⟪stack frame⟫\n')
  let lines = s.split('\n').map((l) => l.replace(/\s+$/, ''))
  // 计时抖动：把相邻重复（含两行交替，如 02 课的 A/B 心跳）的行折叠成一个周期。
  const collapsed = []
  let i = 0
  while (i < lines.length) {
    let advanced = false
    for (const period of [2, 1]) {
      if (i + period >= lines.length) continue
      let j = i + period
      // 每个周期两行都要验证（只验单相位会让 j 越过已断裂的伙伴行）
      while (
        j + period <= lines.length - 1
        && lines[j] === lines[i + (j - i) % period]
        && (period === 1 || lines[j + 1] === lines[i + (j + 1 - i) % period])
      ) j += period
      // 尾部不足一个周期的零头（如心跳停在半拍）逐行吞掉，避免跳过后续行
      while (j <= lines.length - 1 && lines[j] === lines[i + (j - i) % period]) j += 1
      if (j - i >= period * 4) {
        for (let k = 0; k < period; k++) collapsed.push(lines[i + k])
        i = j
        advanced = true
        break
      }
    }
    if (!advanced) {
      collapsed.push(lines[i])
      i += 1
    }
  }
  // 注册表清单（xx: ACTIVE 这类行）：行序由宿主加载机制决定
  // （Node 的启动器会多加载一个 include 插件，浏览器端没有），
  // 剔除 include 行、块内排序后对比——状态本身才是课程要展示的。
  const STATUS_ROW = /^[\w$-]+: (ACTIVE|LOADING|PENDING|FAILED|UNLOADING|DISPOSED)$/
  // 关键：切换到折叠后的行序列（collapsed），否则上面的折叠白做
  lines = collapsed.filter((l) => !/^Include: /.test(l))
  let runStart = -1
  for (let k = 0; k <= lines.length; k++) {
    const isRow = k < lines.length && STATUS_ROW.test(lines[k])
    if (isRow && runStart < 0) runStart = k
    if (!isRow && runStart >= 0) {
      const sorted = lines.slice(runStart, k).sort()
      lines.splice(runStart, k - runStart, ...sorted)
      runStart = -1
    }
  }
  lines = lines.filter((l, idx, arr) => l !== '' || idx < arr.length - 1)
  return lines.join('\n').replace(/\n+$/, '')
}

async function compareWithNode(lesson, actual) {
  try {
    const id = `${lesson.dir.split('/')[1]}-${lesson.slug}`
    const variant = lesson.hasDisabled && state.expectedMode !== 'raw' ? '.enabled' : ''
    if (state.expected?.variant !== variant) {
      const res = await fetch(`./expected/${id}${variant}.txt`)
      if (!res.ok) return null
      state.expected = { variant, text: await res.text() }
    }
    // 终端里第一行是我们 echo 的命令，比对时去掉
    const body = actual.replace(/^\$ [^\n]*\n/, '')
    const a = normalizeOutput(body)
    const b = normalizeOutput(state.expected.text.replace(/\[stderr\]\n?/, ''))
    if (a === b) return { match: true }
    const aLines = a.split('\n')
    const bLines = b.split('\n')
    let diff = 0
    const max = Math.max(aLines.length, bLines.length)
    for (let i = 0; i < max; i++) if (aLines[i] !== bLines[i]) diff++
    return { match: false, diffLines: diff }
  } catch {
    return null
  }
}

// ---------- Node 参考输出面板 ----------

async function renderExpectedPane(lesson) {
  const pane = document.querySelector('[data-body="expected"]')
  if (!pane || pane.dataset.filledFor === lesson.id + (state.expectedMode ?? '')) return
  pane.dataset.filledFor = lesson.id + (state.expectedMode ?? '')
  pane.innerHTML = ''
  const id = `${lesson.dir.split('/')[1]}-${lesson.slug}`
  let variant = ''
  let variantNote = ''
  if (lesson.hasDisabled && state.expectedMode !== 'raw') variant = '.enabled'
  try {
    const res = await fetch(`./expected/${id}${variant}.txt`)
    const text = res.ok ? await res.text() : '（没有采集到参考输出）'
    const pre = el('pre')
    pre.textContent = text
    pane.append(pre)
    const note = el('div', 'expected-note')
    note.textContent = `这份输出是构建时在本仓库上用 Node 真实运行采集的${variantNote || (variant ? '（教学启用模式）' : '')}；浏览器端的运行结果会自动与它比对。`
    pane.append(note)
  } catch (err) {
    pane.append(el('div', 'fs-empty', `读取失败：${err}`))
  }
}

// ---------- 虚拟文件系统面板 ----------

function renderFsPane() {
  const pane = document.querySelector('[data-body="fs"]')
  if (!pane) return
  pane.innerHTML = ''
  const ns = String(globalThis.__DSH_CWD__ || '').replace(/\/+$/, '') + '/'
  const files = [...globalThis.__DSH_FS__.entries()]
    .filter(([k]) => !k.endsWith('/'))
    .map(([k, v]) => [k.startsWith(ns) ? k.slice(ns.length) : k, v])
  if (!files.length) {
    pane.append(el('div', 'fs-empty', '（还没有文件。运行带 session 日志的课（14 课起）后，这里会出现它写下的文件。）'))
    return
  }
  const list = el('div', 'fs-list')
  const content = el('div', 'fs-content', '')
  let active = null
  for (const [name, body] of files) {
    const chip = el('span', 'fs-chip', `${name} · ${body.length}B`)
    chip.addEventListener('click', () => {
      for (const c of list.children) c.classList.toggle('active', c === chip)
      content.textContent = body
    })
    list.append(chip)
    if (!active) { chip.click(); active = name }
  }
  pane.append(list, content)
}

// ---------- 源码查看与编辑 ----------
// 每个文件页签支持「编辑此文件」：保存后，下一次「▶ 运行」会用改过的
// 源码（.ts 在浏览器里现场转译，cordis.yml 直接替换）——课程 md 里
// 「动手改一改」的实验都能在页面上直接做。

function buildCodeSection(lesson) {
  const section = el('section', 'code-section')
  const head = el('div', 'section-head')
  head.append(el('h2', null, '本课源码'))
  head.append(el('span', 'section-note', '改了就能跑：点「编辑」，保存后再按「▶ 运行」'))
  section.append(head)

  const tabs = el('div', 'code-tabs')
  const view = el('div', 'code-view')
  const pre = el('pre')
  const codeEl = el('code')
  pre.append(codeEl)

  // 编辑器面板（与只读视图互斥展示）
  const editorWrap = el('div', 'code-editor')
  editorWrap.style.display = 'none'
  const editorBar = el('div', 'code-editor-bar')
  const editorHint = el('span', 'code-editor-hint')
  const saveBtn = el('button', 'btn btn-primary', '保存修改')
  const cancelBtn = el('button', 'btn', '放弃')
  const revertBtn = el('button', 'btn btn-ghost', '还原原文')
  editorBar.append(editorHint, el('span', 'code-editor-spacer'), revertBtn, cancelBtn, saveBtn)
  const textarea = el('textarea', 'code-textarea')
  textarea.spellcheck = false
  textarea.wrap = 'off'
  editorWrap.append(editorBar, textarea)

  view.append(pre, editorWrap)

  const entries = [
    ...lesson.files.map((f) => ({ name: f.name, label: f.name, code: f.code, lang: 'typescript' })),
    { name: 'cordis.yml', label: 'cordis.yml', code: lesson.yml, lang: 'yaml' },
  ]

  let current = null   // 当前展示的 entry
  let editing = false  // 是否处于编辑模式

  const copy = el('button', 'btn btn-ghost code-copy', '复制')
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(editing ? textarea.value : codeEl.textContent)
      copy.textContent = '已复制'
      setTimeout(() => (copy.textContent = '复制'), 1200)
    } catch { /* 剪贴板不可用时忽略 */ }
  })
  const editBtn = el('button', 'btn btn-ghost code-edit', '✏️ 编辑')
  editBtn.addEventListener('click', () => enterEdit())
  view.append(copy, editBtn)

  function show(entry) {
    current = entry
    editing = false
    editorWrap.style.display = 'none'
    pre.style.display = ''
    editBtn.style.display = ''
    copy.style.display = ''
    codeEl.className = `language-${entry.lang}`
    // 展示内容：有修改的显示修改版
    codeEl.textContent = lessonEdits(lesson)[entry.name] ?? entry.code
    // 同一个 <code> 会被页签切换反复使用，不清标记 hljs 会跳过第二次高亮
    delete codeEl.dataset.highlighted
    try { hljs.highlightElement(codeEl) } catch { /* 忽略高亮错误 */ }
    editBtn.textContent = '✏️ 编辑'
    refreshMarks()
  }

  function enterEdit() {
    if (!current) return
    editing = true
    pre.style.display = 'none'
    editorWrap.style.display = ''
    copy.style.display = 'none'
    editBtn.style.display = 'none'
    textarea.value = lessonEdits(lesson)[current.name] ?? current.code
    editorHint.textContent = `正在编辑 ${current.name}（Tab 缩进两格；保存后按「▶ 运行」生效）`
    refreshMarks()
    textarea.focus()
  }

  function exitEdit() {
    if (current) show(current)
  }

  // Tab 键插入两格缩进，而不是跳出文本框
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const { selectionStart: s, selectionEnd: t, value } = textarea
      textarea.value = value.slice(0, s) + '  ' + value.slice(t)
      textarea.selectionStart = textarea.selectionEnd = s + 2
    }
    if (e.key === 'Escape') exitEdit()
  })

  saveBtn.addEventListener('click', () => {
    if (!current) return
    if (textarea.value === current.code) {
      // 改回了原样：视为还原
      setCodeEdit(lesson, current.name, null)
      termAppend('t-meta', `(${current.name} 与原文一致，已视为还原)\n`)
    } else {
      setCodeEdit(lesson, current.name, textarea.value)
      termAppend('t-meta', `(已保存 ${current.name} 的修改，按「▶ 运行」用新代码跑)\n`)
    }
    refreshEditIndicators(lesson)
    exitEdit()
  })
  cancelBtn.addEventListener('click', exitEdit)
  revertBtn.addEventListener('click', () => {
    if (!current) return
    setCodeEdit(lesson, current.name, null)
    termAppend('t-meta', `(已还原 ${current.name} 的修改)\n`)
    refreshEditIndicators(lesson)
    exitEdit()
  })

  // 页签上的 ● 修改标记
  function refreshMarks() {
    const edited = lessonEdits(lesson)
    for (const tab of tabs.children) {
      tab.classList.toggle('modified', Boolean(edited[tab.dataset.name]))
    }
  }

  let first = true
  for (const entry of entries) {
    const tab = el('button', 'code-tab', entry.label)
    tab.dataset.name = entry.name
    tab.addEventListener('click', () => {
      for (const t of tabs.children) t.classList.toggle('active', t === tab)
      show(entry)
    })
    tabs.append(tab)
    if (first) { tab.click(); first = false }
  }

  section.append(tabs, view)
  return section
}

// 「还原代码修改」按钮的可见性
function refreshEditIndicators(lesson) {
  const btn = $('#reset-code-btn')
  if (btn) {
    const count = Object.keys(lessonEdits(lesson)).length
    btn.hidden = count === 0
    btn.textContent = count ? `还原代码修改（${count}）` : '还原代码修改'
  }
}

// ---------- API Key ----------

const keyInput = $('#key-input')
const keyStatus = $('#key-status')

// ---------- 右下角 🚀：读到下面了一键跳回本课源码 ----------

function initRocket() {
  const rocket = el('button', 'rocket-btn', '🚀')
  rocket.id = 'rocket-code'
  rocket.title = '跳回本课源码'
  rocket.hidden = true
  rocket.addEventListener('click', () => {
    document.querySelector('#lesson-code')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  document.body.append(rocket)

  // 滚过源码区之后才出现；离开课页隐藏
  let ticking = false
  window.addEventListener('scroll', () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      const code = document.querySelector('#lesson-code')
      const past = window.scrollY > 480 && code
        && code.getBoundingClientRect().bottom < 0 // 源码区已完全滚出视口
      rocket.hidden = !past
    })
  }, { passive: true })
}

function initKeyBox() {
  keyInput.value = localStorage.getItem('dsh-deepseek-key') || ''
  keyInput.addEventListener('change', () => {
    localStorage.setItem('dsh-deepseek-key', keyInput.value.trim())
    keyStatus.textContent = ''
  })
  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') keyInput.blur()
  })
  $('#key-test').addEventListener('click', testKey)
  $('#key-mobile').addEventListener('click', () => {
    const value = prompt('填入 DeepSeek API Key（只保存在本机浏览器，第 27 课真 API 用）', keyInput.value || '')
    if (value === null) return
    keyInput.value = value.trim()
    localStorage.setItem('dsh-deepseek-key', keyInput.value)
    keyStatus.textContent = keyInput.value ? '已保存' : '已清空'
    keyStatus.className = `key-status ${keyInput.value ? 'ok' : 'bad'}`
  })
}

async function testKey() {
  const key = keyInput.value.trim()
  localStorage.setItem('dsh-deepseek-key', key)
  if (!key) {
    keyStatus.textContent = '未填 Key'
    keyStatus.className = 'key-status bad'
    return
  }
  keyStatus.textContent = '测试中…'
  keyStatus.className = 'key-status busy'
  try {
    const model = state.content?.realApiModel || 'deepseek-chat'
    const res = await fetch('https://api.deepseek.com/anthropic/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    })
    if (res.ok) {
      keyStatus.textContent = `✓ Key 有效（${model}）`
      keyStatus.className = 'key-status ok'
    } else {
      const body = await res.text().catch(() => '')
      keyStatus.textContent = `✗ HTTP ${res.status}${body ? `：${body.slice(0, 60)}` : ''}`
      keyStatus.className = 'key-status bad'
    }
  } catch (err) {
    keyStatus.textContent = `✗ 网络错误`
    keyStatus.className = 'key-status bad'
  }
}

// ---------- 启动 ----------

$('#sidebar-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'))

// 键盘：← / → 翻课，/ 聚焦搜索
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
  const target = e.target
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return

  if (e.key === '/') {
    e.preventDefault()
    $('#side-search')?.focus()
    return
  }
  if (!state.lesson || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  const list = lessons()
  const index = list.findIndex((l) => l.id === state.lesson.id)
  if (index < 0) return
  const next = e.key === 'ArrowRight' ? list[index + 1] : list[index - 1]
  if (next) location.hash = `#/${next.id}`
})

// 课程正文里的「源码：main.ts / cordis.yml」链接：不跳 404，
// 而是切到页面底部的源码标签并滚过去。
document.addEventListener('click', (e) => {
  const link = e.target.closest?.('article.md a[href]')
  if (!link) return
  const name = (link.getAttribute('href') || '').split('/').pop().split('#')[0]
  if (!/\.(ts|yml|yaml)$/.test(name)) return
  const tab = [...document.querySelectorAll('.code-tab')].find((t) => t.textContent === name)
  if (!tab) return
  e.preventDefault()
  tab.click()
  document.querySelector('.code-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

initKeyBox()
initRocket()
boot().catch((err) => {
  setMain(el('div', 'loading', `加载失败：${err}`))
})
