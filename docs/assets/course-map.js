// 课程全景与每课“定位卡”的渲染层。
// 数据在 course-data.js（纯数据，构建期也会读），这里只负责变成 DOM。
// 设计原则：所有图都是普通 HTML + CSS，不用 canvas/svg——可选中、可打印、
// 在手机上自动折行，也不会因为某个库挂了就白屏。

import { COURSE } from './course-data.js?v=1792581065675'

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const lessonHref = (num) => `#/p${num}`

function stageOf(id) {
  return COURSE.stages.find((s) => s.id === id) || COURSE.stages[0]
}

function stageChip(id) {
  const stage = stageOf(id)
  const chip = el('span', `stage-chip stage-${stage.id}`, `${stage.icon} ${stage.name}`)
  return chip
}

// ---------- 六格阶段条（每课顶部 / 全景图共用） ----------

export function renderStageStrip(currentId, { compact = false } = {}) {
  const strip = el('div', `stage-strip${compact ? ' compact' : ''}`)
  strip.setAttribute('role', 'list')
  strip.setAttribute('aria-label', '本课在 Agent 运行时中的位置')
  for (const stage of COURSE.stages) {
    const current = stage.id === currentId
    const item = el('a', `stage-step stage-${stage.id}${current ? ' current' : ''}`)
    item.href = '#/map'
    item.title = `${stage.name}：${stage.blurb}`
    item.setAttribute('role', 'listitem')
    if (current) item.setAttribute('aria-current', 'step')
    item.append(el('span', 'stage-dot'))
    item.append(el('span', 'stage-name', stage.name))
    strip.append(item)
  }
  return strip
}

// ---------- 每课定位卡：上一课 → 本课 → 下一课 ----------

export function renderLessonBrief(meta) {
  const stage = stageOf(meta.stage)
  const section = el('section', `lesson-brief stage-${stage.id}`)

  const top = el('div', 'brief-top')
  const badge = el('span', `brief-badge stage-${stage.id}`, `${stage.icon} 第 ${meta.part} 篇 · ${stage.name} · ${String(meta.num).padStart(2, '0')}/27`)
  top.append(badge)
  top.append(el('span', 'brief-oneliner', meta.oneLiner))
  section.append(top)

  const relation = el('div', 'brief-relation')
  const steps = [
    [meta.num === 1 ? '起点' : '上一课留下', meta.problem, 'rel-problem'],
    ['本课给你', meta.gives, 'rel-gives'],
    [meta.num === 27 ? '课程终点' : '下一课用它', meta.nextUses, 'rel-next'],
  ]
  steps.forEach(([label, text, cls], index) => {
    const item = el('div', `rel-step ${cls}`)
    item.append(el('span', 'rel-index', String(index + 1).padStart(2, '0')))
    item.append(el('span', 'rel-k', label))
    item.append(el('p', 'rel-text', text))
    relation.append(item)
    if (index < steps.length - 1) relation.append(el('span', 'rel-join', '→'))
  })
  section.append(relation)

  const foot = el('div', 'brief-foot')
  const pos = el('div', 'brief-pos')
  pos.append(el('span', 'foot-k', '在运行时里的位置'))
  pos.append(renderStageStrip(meta.stage, { compact: true }))
  foot.append(pos)

  if (meta.dsh && meta.dsh.length) {
    const dsh = el('div', 'brief-dsh')
    dsh.append(el('span', 'foot-k', 'DSH 真身'))
    for (const item of meta.dsh) {
      const wrap = el('span', 'dsh-item')
      wrap.append(el('code', null, item.path))
      if (item.what) wrap.append(el('span', 'dsh-what', item.what))
      dsh.append(wrap)
    }
    foot.append(dsh)
  }
  section.append(foot)
  return section
}

// ---------- 本课机制结构图 ----------

export function renderMechanism(meta) {
  const flow = meta.flow
  if (!flow || !flow.nodes?.length) return null

  const section = el('section', 'lesson-mechanism')
  const head = el('div', 'section-head')
  const title = el('h2')
  title.append(document.createTextNode('本课结构图'))
  head.append(title)
  head.append(el('span', 'section-note', '先看骨架，再读细节'))
  section.append(head)
  if (flow.title) section.append(el('p', 'flow-title', flow.title))

  const kind = flow.kind === 'split' ? 'split' : 'chain'
  const wrap = el('div', `flow flow-${kind}`)

  if (kind === 'chain') {
    flow.nodes.forEach((node, index) => {
      wrap.append(flowNode(node, index + 1))
      if (index < flow.nodes.length - 1) wrap.append(el('span', 'flow-arrow', '→'))
    })
  } else {
    // split：第一个 in 节点当入口，最后一个 out 节点当出口，中间并排当分支。
    const input = flow.nodes[0]
    const output = flow.nodes.length > 2 && flow.nodes.at(-1).k === 'out' ? flow.nodes.at(-1) : null
    const branches = flow.nodes.slice(1, output ? -1 : undefined)
    wrap.append(flowNode(input, 1))
    const grid = el('div', 'flow-branches')
    branches.forEach((node, index) => grid.append(flowNode(node, index + 2)))
    wrap.append(grid)
    if (output) wrap.append(flowNode(output, flow.nodes.length))
  }

  section.append(wrap)
  if (flow.note) section.append(el('p', 'flow-caption', flow.note))
  return section
}

function flowNode(node, index) {
  const nodeEl = el('div', `flow-node k-${node.k || 'step'}`)
  nodeEl.append(el('span', 'flow-num', String(index).padStart(2, '0')))
  const body = el('div', 'flow-body')
  body.append(el('b', null, node.t))
  if (node.s) body.append(el('span', null, node.s))
  nodeEl.append(body)
  return nodeEl
}

// ---------- 读完之后：生活类比 + 易懵点 ----------

export function renderLessonAside(meta) {
  const section = el('section', 'lesson-aside')

  if (meta.analogy) {
    const a = meta.analogy
    const scene = a.scene || '生活'
    const icon = /恋|爱/.test(scene) ? '💘' : /游戏/.test(scene) ? '🎮' : /剧/.test(scene) ? '📺' : '💡'
    const card = el('div', 'aside-card analogy-card')
    const head = el('div', 'aside-head')
    head.append(el('span', 'aside-icon', icon))
    const headText = el('div')
    headText.append(el('h3', null, `换个说法：${a.title}`))
    headText.append(el('span', 'aside-sub', `用「${scene}」把这一课的机制再讲一遍`))
    head.append(headText)
    card.append(head)

    const table = el('div', 'analogy-table')
    const headRow = el('div', 'analogy-row head')
    headRow.append(el('span', null, '场景里'))
    headRow.append(el('span', null, '代码里'))
    table.append(headRow)
    for (const [sceneText, codeText] of a.lines) {
      const row = el('div', 'analogy-row')
      row.append(el('span', 'analogy-scene', sceneText))
      row.append(el('span', 'analogy-code', codeText))
      table.append(row)
    }
    card.append(table)
    if (a.punchline) card.append(el('p', 'analogy-punch', a.punchline))
    section.append(card)
  }

  if (meta.pitfalls?.length) {
    const card = el('div', 'aside-card pitfall-card')
    const head = el('div', 'aside-head')
    head.append(el('span', 'aside-icon', '⚠️'))
    const headText = el('div')
    headText.append(el('h3', null, '容易懵的点'))
    headText.append(el('span', 'aside-sub', '读的时候卡住，多半是这三处'))
    head.append(headText)
    card.append(head)
    const list = el('ul', 'pitfall-list')
    for (const text of meta.pitfalls) {
      const li = el('li')
      li.append(el('span', 'pitfall-mark', '·'))
      li.append(document.createTextNode(text))
      list.append(li)
    }
    card.append(list)
    section.append(card)
  }

  return section.children.length ? section : null
}

// ---------- 全局全景图页面 ----------

export function renderMapPage() {
  const wrap = el('div', 'page-map')
  wrap.append(el('div', 'crumb', '全局地图'))
  wrap.append(el('h1', 'article-title', '课程全景：27 课其实只在造一个东西'))

  const lede = el('p', 'map-lede')
  lede.append('这套教程不是 27 个孤立知识点。它从头到尾只在组装一个东西：')
  lede.append(el('strong', null, '一个能自己看、自己动手、还记得住事的 Agent。'))
  lede.append('下面这张“运行时解剖图”就是全课程的地图——每一课都能在其中一个器官上找到位置。')
  wrap.append(lede)

  const formula = el('div', 'map-formula')
  const parts = [
    ['插件骨架', '第 1 篇'],
    ['工具 + 模型', '第 2 篇 · 上'],
    ['日志 + 记忆', '第 2 篇 · 下'],
    ['循环 + 外壳', '第 3 篇'],
  ]
  formula.append(el('span', 'formula-lead', 'Agent ='))
  parts.forEach(([text, sub], index) => {
    const item = el('span', 'formula-item')
    item.append(el('b', null, text))
    item.append(el('span', null, sub))
    formula.append(item)
    if (index < parts.length - 1) formula.append(el('span', 'formula-plus', '+'))
  })
  wrap.append(formula)

  wrap.append(renderAnatomy())

  // 三条路线
  const routes = el('section', 'map-section')
  routes.append(sectionTitle('选一条路线', '不知道自己该从哪读？先选目标，再决定入口。'))
  const grid = el('div', 'route-grid')
  for (const route of COURSE.routes) {
    const card = el('a', 'route-card')
    card.href = lessonHref(route.start)
    const top = el('div', 'route-top')
    top.append(el('span', `route-tag route-${route.id}`, route.tag))
    top.append(el('span', 'route-time', route.time))
    card.append(top)
    card.append(el('b', 'route-title', route.title))
    card.append(el('p', 'route-desc', route.desc))
    const nums = el('div', 'route-lessons')
    for (const num of route.nums) {
      const meta = COURSE.lessons[num]
      if (!meta) continue
      nums.append(el('span', 'route-pill', String(num).padStart(2, '0')))
    }
    card.append(nums)
    card.append(el('span', 'route-go', `从第 ${route.start} 课开始 →`))
    grid.append(card)
  }
  routes.append(grid)
  wrap.append(routes)

  // 27 课全表
  const tableSection = el('section', 'map-section')
  tableSection.append(sectionTitle('27 课速查', '每一课的一句话、所在器官、对应的 DSH 真身。'))
  const tableWrap = el('div', 'map-table-wrap')
  const table = el('table', 'map-table')
  const thead = el('thead')
  const hr = el('tr')
  for (const label of ['#', '本课', '一句话', '器官', 'DSH 真身']) hr.append(el('th', null, label))
  thead.append(hr)
  table.append(thead)
  const tbody = el('tbody')
  for (const num of Object.keys(COURSE.lessons).map(Number).sort((a, b) => a - b)) {
    const meta = COURSE.lessons[num]
    const tr = el('tr')
    tr.append(el('td', 'map-num', String(num).padStart(2, '0')))
    const titleCell = el('td')
    const link = el('a', null, meta.shortTitle || meta.title)
    link.href = lessonHref(num)
    titleCell.append(link)
    tr.append(titleCell)
    tr.append(el('td', 'map-one', meta.oneLiner))
    const stageCell = el('td')
    stageCell.append(stageChip(meta.stage))
    tr.append(stageCell)
    const dshCell = el('td', 'map-dsh')
    dshCell.append(el('code', null, meta.dsh?.[0]?.path || '—'))
    tr.append(dshCell)
    tbody.append(tr)
  }
  table.append(tbody)
  tableWrap.append(table)
  tableSection.append(tableWrap)
  wrap.append(tableSection)

  // 最容易混的概念
  const confusions = el('section', 'map-section')
  confusions.append(sectionTitle('最容易混的八个概念', '不是背定义，而是把经常被当成一回事的两样东西拆开。'))
  const cgrid = el('div', 'confusion-grid')
  for (const item of COURSE.confusions) {
    const card = el('div', 'confusion-card')
    const title = el('div', 'confusion-title')
    title.append(el('span', null, item.a))
    title.append(el('span', 'confusion-neq', '≠'))
    title.append(el('span', null, item.b))
    card.append(title)
    card.append(el('p', null, item.text))
    card.append(el('span', 'confusion-where', `见第 ${item.lessons.join('、')} 课`))
    cgrid.append(card)
  }
  confusions.append(cgrid)
  wrap.append(confusions)

  // 术语小抄
  const glossary = el('section', 'map-section')
  glossary.append(sectionTitle('术语小抄', '读课时看到不认识的词，回这里查。'))
  const ggrid = el('div', 'glossary-grid')
  for (const entry of COURSE.glossary) {
    const card = el('div', 'glossary-card')
    card.append(el('code', 'glossary-term', entry.term))
    card.append(el('p', null, entry.plain))
    if (entry.lessons?.length) card.append(el('span', 'glossary-where', `第 ${entry.lessons.join('、')} 课`))
    ggrid.append(card)
  }
  glossary.append(ggrid)
  wrap.append(glossary)

  wrap.append(mapFooter())
  return wrap
}

function renderAnatomy({ compact = false } = {}) {
  const section = el('section', `anatomy${compact ? ' anatomy-compact' : ''}`)
  if (!compact) {
    section.append(sectionTitle('运行时解剖图', '从上往下是从地基到外壳的六层。点任意一课，直接跳进去。'))
  }
  for (const stage of COURSE.stages) {
    const row = el('div', `anatomy-row stage-${stage.id}`)
    const track = el('div', 'anatomy-track')
    track.append(el('span', 'anatomy-icon', stage.icon))
    track.append(el('span', 'anatomy-line'))
    row.append(track)

    const body = el('div', 'anatomy-body')
    const head = el('div', 'anatomy-head')
    head.append(el('h3', null, stage.name))
    head.append(el('span', 'anatomy-en', stage.en))
    head.append(el('span', 'anatomy-count', `${stage.lessons.length} 课`))
    body.append(head)
    body.append(el('p', 'anatomy-blurb', stage.blurb))

    const chips = el('div', 'anatomy-chips')
    for (const num of stage.lessons) {
      const meta = COURSE.lessons[num]
      if (!meta) continue
      const chip = el('a', 'map-chip')
      chip.href = lessonHref(num)
      chip.title = meta.oneLiner
      chip.append(el('span', 'chip-num', String(num).padStart(2, '0')))
      chip.append(el('span', null, meta.shortTitle || meta.title))
      chips.append(chip)
    }
    body.append(chips)
    if (!compact) {
      body.append(el('p', 'anatomy-flow', stage.flow))
      const data = el('div', 'anatomy-data')
      data.append(el('span', 'anatomy-data-k', '数据在这里长这样'))
      data.append(el('code', null, stage.data))
      body.append(data)
    }
    row.append(body)
    section.append(row)
  }
  return section
}

// ---------- 首页顶部的“先看全景” ----------

export function renderIntroOverview() {
  const section = el('section', 'intro-overview')
  const head = el('div', 'intro-overview-head')
  const titleWrap = el('div')
  titleWrap.append(el('h2', null, '先看全景，再进第 1 课'))
  titleWrap.append(el('p', null, '27 课被拆成六层。你现在在首页，下面是整张地图的缩略版。'))
  head.append(titleWrap)
  const link = el('a', 'btn btn-primary', '打开完整全景图 →')
  link.href = '#/map'
  head.append(link)
  section.append(head)
  section.append(renderAnatomy({ compact: true }))
  const foot = el('div', 'intro-overview-foot')
  foot.append('不想先看地图？直接开始：')
  const start = el('a', null, '第 1 课 · 第一个插件 →')
  start.href = '#/p1'
  foot.append(start)
  section.append(foot)

  const routes = el('div', 'intro-routes')
  for (const route of COURSE.routes) {
    const chip = el('a', 'intro-route')
    chip.href = lessonHref(route.start)
    chip.append(el('span', `route-tag route-${route.id}`, route.tag))
    chip.append(document.createTextNode(route.title))
    routes.append(chip)
  }
  section.append(routes)
  return section
}

function sectionTitle(title, note) {
  const wrap = el('div', 'map-section-head')
  wrap.append(el('h2', null, title))
  if (note) wrap.append(el('p', null, note))
  return wrap
}

function mapFooter() {
  const foot = el('div', 'map-footer')
  foot.append('这张图对应的版本：DeepSeek Harness v0.2.1-alpha.1。')
  foot.append('读完第 27 课，建议回到这里，把六层再走一遍——你会发现每一层都能用自己的话讲出来了。')
  return foot
}
