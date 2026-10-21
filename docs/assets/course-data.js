// 课程全景的“事实层”：六层运行时结构、学习路线、术语表、易混概念，
// 以及 27 课各自的定位信息（正文事实来自 lesson-facts.js）。
//
// 这个文件是纯数据，构建脚本会直接 import 它，把每课 meta 塞进 content.json；
// 页面端只读 content.json，不再重复请求这些数据。

import { LESSON_FACTS } from './lesson-facts.js'

export const STAGES = [
  {
    id: 'assembly',
    icon: '🧩',
    name: '装配',
    en: 'Assembly',
    blurb: '应用不是 new 出来的，是一份 cordis.yml 配出来的。launcher 建根 Context，Loader 按条目加载插件。',
    flow: 'cordis.yml → Loader 读条目 → 按 name 加载模块 → 调用 apply(ctx)',
    data: 'cordis.yml · launcher.ts · 插件模块路径',
    lessons: [1, 6, 20, 21],
  },
  {
    id: 'kernel',
    icon: '⚙️',
    name: '内核',
    en: 'Cordis Kernel',
    blurb: 'Cordis 只有三样东西：插件、上下文、组合。服务、事件、配置、effect 都长在这套骨架上。',
    flow: 'ctx.plugin() → fiber 状态机 → service / event 注册 → 卸载时 effect 自动回收',
    data: 'ctx（Context 实例）· fiber 状态 · effect 清单',
    lessons: [2, 3, 4, 5, 8],
  },
  {
    id: 'seam',
    icon: '🔌',
    name: '接缝',
    en: 'Capability Seam',
    blurb: '定义、提供、消费三个角色分开。消费方只认接口，换实现不用改调用方——这是全教程最重要的一条架构纪律。',
    flow: '定义接口 → 提供方挂到 ctx → 消费方按名字取 → 换实现零改动',
    data: 'ctx.llm · ctx.tools · ctx.session',
    lessons: [7, 9, 10, 11, 19],
  },
  {
    id: 'loop',
    icon: '🔁',
    name: '循环',
    en: 'Agent Loop',
    blurb: 'Agent 的心跳：把消息发给模型，模型要工具就去调，拿到结果再发回去，直到它不再要工具。',
    flow: '用户输入 → 请求模型 → 流式 chunk → 工具调用 → 结果回喂 → 下一轮',
    data: 'messages[] · StreamChunk · tool_call / tool_result',
    lessons: [12, 13, 22, 23],
  },
  {
    id: 'memory',
    icon: '🧠',
    name: '记忆',
    en: 'Session & Memory',
    blurb: '日志是唯一事实来源。模型看不见日志，只看见从日志折出来的请求；太长就压缩，重启就恢复。',
    flow: 'append 一行 → fold 成 messages → 超预算就 compact → 重启时 resume',
    data: 'session.jsonl · replace 记录 · 摘要 · token 预算',
    lessons: [14, 15, 16, 17, 24, 25],
  },
  {
    id: 'shell',
    icon: '🐚',
    name: '外壳',
    en: 'Shell',
    blurb: '让 Agent 像个产品：知道自己是谁（system prompt）、有完整的生死（生命周期事件）、能接真模型（provider）。',
    flow: 'system prompt 定人设 → 生命周期事件观测 → provider 换真模型 → 账单与超时',
    data: 'SystemPrompt · SessionEventMap · baseURL / apiKey / model',
    lessons: [18, 26, 27],
  },
]

export const ROUTES = [
  {
    id: 'full',
    tag: '主线',
    title: '从零走完 27 课',
    desc: '第一次来就走这条。按顺序读，每一课都建立在前一课的代码上，最后你会有一个能接真模型的 Agent。',
    time: '约 12–15 小时',
    start: 1,
    nums: Array.from({ length: 27 }, (_, i) => i + 1),
  },
  {
    id: 'tools',
    tag: '工具线',
    title: '只看“Agent 怎么动手”',
    desc: '从假模型接缝出发，经 defineTool、参数校验、agent loop、失败处理，到流式与重试。适合想给自己 Agent 加工具的人。',
    time: '约 4 小时',
    start: 9,
    nums: [9, 10, 11, 12, 13, 19, 22, 23],
  },
  {
    id: 'memory',
    tag: '记忆线',
    title: '只看“Agent 怎么记事”',
    desc: 'append-only 日志、折叠、压缩、恢复、system prompt、预算。适合被上下文长度和“重启就失忆”折磨过的人。',
    time: '约 5 小时',
    start: 14,
    nums: [12, 14, 15, 16, 17, 18, 24, 25, 26],
  },
  {
    id: 'agent',
    tag: '组装线',
    title: '只看“怎么装成一个产品”',
    desc: '工具注册表、能力协商、目录即插件、流式 loop、错误恢复、上下文预算、真 API。适合已经懂 Cordis 的人。',
    time: '约 5 小时',
    start: 19,
    nums: [19, 20, 21, 22, 23, 24, 25, 26, 27],
  },
]

export const GLOSSARY = [
  { term: 'ctx / Context', plain: '所有插件共享的能力仓库，也是生命周期的根。插件从这里拿能力，也往这里放能力。', lessons: [1, 3] },
  { term: 'Plugin', plain: '一个导出 apply(ctx) 的模块。它不初始化、不 new，只描述“我要贡献什么”。', lessons: [1] },
  { term: 'Effect', plain: '注册时登记、插件卸载时自动撤销的资源。定时器、监听器、服务注册都该走它。', lessons: [2, 4] },
  { term: 'Fiber', plain: '插件在 Cordis 里的运行时实例和状态机：PENDING / LOADING / ACTIVE / FAILED / DISPOSED。', lessons: [8, 20] },
  { term: 'Service', plain: '挂在 ctx 上、有类型、有生命周期、可替换的能力。别人通过 ctx.xxx 使用它。', lessons: [3, 7] },
  { term: 'Seam（接缝）', plain: '定义方、提供方、消费方三角色分开。消费方只依赖定义，所以换实现不用改调用方。', lessons: [7, 10, 14] },
  { term: 'Tool', plain: '一张给模型看的 JSON Schema 说明书 + 一个真正执行的函数。模型按名字挑，loop 按名字调。', lessons: [10, 11, 19] },
  { term: 'LlmAdapter', plain: '模型调用的统一接口。上层只认 stream() 产出的 chunk，不认底下是 mock 还是 DeepSeek。', lessons: [9, 22, 27] },
  { term: 'Session log', plain: '一行一条 JSON 的 append-only 日志，是会话的唯一事实来源。写出去的行永不改写。', lessons: [14] },
  { term: 'Fold / deriveMessages', plain: '把日志折成模型这一次能看见的消息。日志是全量事实，请求只是它的一个视图。', lessons: [15] },
  { term: 'Compaction', plain: '往日志追加一条 replace 记录，用摘要顶掉一段旧历史。旧行还在，只是不再进请求。', lessons: [16, 24, 25] },
  { term: 'Resume', plain: '重启后先校验头行，再重放日志，把会话接上。不是“重新开始”。', lessons: [17] },
  { term: 'System prompt', plain: '在消息最前面告诉模型“你是谁”的指令层，按一张公开的顺序表拼装，可以中途改写。', lessons: [18] },
  { term: 'Token budget', plain: '一次请求 = 消息 + 工具清单 + system prompt。预算就是给这三块算账，超了就压缩。', lessons: [24] },
  { term: 'Guard', plain: '循环的保险丝：等待上限、重复调用检测、重试上限。失败可以恢复，但不能无限恢复。', lessons: [23] },
  { term: 'Provider', plain: '具体的模型后端。mock 和真 DeepSeek 都实现同一个 LlmAdapter 接口。', lessons: [9, 27] },
]

export const CONFUSIONS = [
  {
    a: '插件',
    b: '服务',
    text: '插件是“加载单位”（一个模块、一个 apply）；服务是“能力单位”（挂在 ctx 上的一个名字）。一个插件可以提供多个服务，一个服务也可以由别的插件替换实现。',
    lessons: [1, 3, 7],
  },
  {
    a: '服务',
    b: '工具',
    text: '服务是给代码用的（ctx.tools），工具是给模型用的（JSON Schema 说明书）。工具注册在服务里，模型只看见工具，看不见服务。',
    lessons: [3, 10, 19],
  },
  {
    a: 'session log',
    b: 'messages',
    text: '日志是事实（发生过什么，全量、只增不减）；messages 是视图（这一次请求让模型看见什么）。日志进磁盘，messages 进请求。',
    lessons: [14, 15],
  },
  {
    a: '压缩',
    b: '删除',
    text: '压缩不删任何一行旧日志，只追加一条 replace 记录，把某段历史的“当前解释权”换掉。所以随时能回放、迁移、复盘。',
    lessons: [16, 25],
  },
  {
    a: 'resume',
    b: '重新运行',
    text: 'resume 先读头行校验版本和格式，再把日志重放进内存；重新运行是空日志从头开始。前者能接着聊，后者会失忆。',
    lessons: [17],
  },
  {
    a: 'inject',
    b: 'import',
    text: 'import 是代码层的静态依赖，编译时就绑死；inject 是运行时的能力声明，Loader 按它决定加载顺序，缺了会在启动时报 PENDING/FAILED。',
    lessons: [3, 20],
  },
  {
    a: 'effect',
    b: 'try / finally',
    text: 'try/finally 管一次函数调用；effect 管一个插件的整个生命周期。插件被卸载、热替换、依赖失败时，effect 都会被统一回收。',
    lessons: [2, 6],
  },
  {
    a: 'PENDING',
    b: 'FAILED',
    text: 'PENDING 是“我在等一个还没到的依赖”，还有救；FAILED 是“我要的依赖根本没声明/已经失败”，不会再自己好。',
    lessons: [8, 20],
  },
]

const PART_OF = (num) => (num <= 9 ? 1 : num <= 18 ? 2 : 3)
const STAGE_OF = (num) => STAGES.find((s) => s.lessons.includes(num))?.id || 'kernel'

function shortTitle(title) {
  const clean = title.replace(/^\d+\s*·\s*/, '').trim()
  const colon = clean.search(/[：:]/)
  if (colon > 0 && clean.slice(0, colon).length <= 12) return clean.slice(0, colon)
  return clean.length > 14 ? `${clean.slice(0, 13)}…` : clean
}

const lessons = {}
for (const fact of LESSON_FACTS) {
  lessons[fact.num] = {
    ...fact,
    part: PART_OF(fact.num),
    stage: STAGE_OF(fact.num),
    shortTitle: shortTitle(fact.title),
  }
}

export const COURSE = {
  version: 'v0.2.1-alpha.1',
  stages: STAGES,
  routes: ROUTES,
  glossary: GLOSSARY,
  confusions: CONFUSIONS,
  lessons,
}
