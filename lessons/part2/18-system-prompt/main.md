# 18 · system prompt：谁在给模型下指令

> 源码：[system-prompt.ts](./system-prompt.ts) · [session.ts](./session.ts) · [llm.ts](./llm.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [json-schema.ts](./json-schema.ts) · [provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 12 课到第 17 课，我们一直在解决同一个问题：**模型知道什么。** 工具（12）、失败怎么告诉它（13）、历史（14~15）、历史太长怎么办（16）、进程重启后历史从哪来（17）。

但还有另一半没碰：**谁在告诉模型它该是谁。**

你问 ChatGPT "帮我写首诗" 它写诗，问它 "1+1 等于几" 它算数——不是因为它聪明，是因为有人在它开口之前先说了一段话，告诉它"你是什么、你能干什么、什么不能干"。这段话就是 **system prompt**。

本课把这段话从"某个文件里写死的常量"变成一个**可注册、可排序、可中途替换的注册表**。

## 一个字符串字段装不下

最直觉的做法是在 agent 里加个常量：

```ts
const SYSTEM = '你是一个天气助手，只回答天气相关的问题。'
```

然后每轮请求塞进 `messages` 数组。这样能跑，但撑不过三个需求：

1. **工具清单要进去。** 第 12 课的工具描述从哪来？从 `ctx.tools` 拿。可工具是别的插件注册的——它注册的时候，agent 早就 `apply` 完了。一个常量怎么知道后来发生了什么？
2. **人设要能换。** 同一套 agent，有人要礼貌版，有人要毒舌版。改常量就得改代码。
3. **顺序不能乱。** 身份段必须在最前面，工具清单放最后。谁先注册谁在前？那不就成抽奖了。

所以 harness 的做法是：**不是一个字符串，是一张段落注册表。**

## SystemPrompt 服务

看 [system-prompt.ts](./system-prompt.ts)，它是个 Service：

```ts
export abstract class SystemPrompt extends Service {
  constructor(ctx: Context) { super(ctx, 'systemPrompt') }

  abstract section(section: Section): () => void
  abstract assemble(): string
  abstract renderTools(schemas: readonly ToolSchema[]): string
}
```

三个方法，三种角色：

| 方法 | 谁调用 | 干什么 |
|---|---|---|
| `section()` | 任何插件 | 注册一段话，返回摘除函数 |
| `assemble()` | agent，每轮请求前 | 把当前所有段落拼成完整提示词 |
| `renderTools()` | agent，经工具清单段 | 把工具清单渲染成一段文本 |

注意 `section()` 的返回值是 `() => void`——**注册是个效果（effect）**，第 06 课的老规矩。插件卸载时，它的段落自动消失，不需要谁去手动清理。

一段话长这样：

```ts
export interface Section {
  readonly name: string       // 唯一名字
  readonly order: number      // 排序权重
  readonly text: string | (() => string)  // 内容，或现算内容的函数
  readonly complete?: boolean // true 时这一段就是全部
}
```

`text` 可以是函数，这是本课的第二个关键设计。工具清单就得用它——`assemble()` 每次被问到才去 `ctx.tools` 拿一次，拿到的永远是"此刻的全部工具"。

## 顺序：一张公开的表，不是注册先后

`assemble()` 的核心是排序：

```ts
const sorted = [...this.sections].sort((a, b) => a.order - b.order)
```

`order` 从哪来？从 `SECTION_ORDER` 这张表：

```ts
export const SECTION_ORDER = {
  identity: -1000,   // 身份：你是谁。永远在最前面
  persona: 0,        // 人设：部署方给定的行为准则
  tools: 1000,       // 工具清单
} as const
```

**为什么需要一张表，而不是谁先注册谁在前？** 因为写插件的人控制不了加载顺序。天气插件先加载还是 persona 插件先加载，取决于 cordis.yml 怎么写、取决于依赖图怎么解——但"身份必须在最前面"这件事是内容要求，跟加载顺序无关。 harness 真身在 [packages/core/system-prompt/src/index.ts 第 125 行](../../../deepseek-harness/packages/core/system-prompt/src/index.ts#L125) 有一张 `SECTION_ORDERS`，把全仓库几十个段落都钉死在固定槽位上，`HARNESS_IDENTITY` 是 `-1000`、`PERSONA_PREFIX` 是 `0`、`TOOLS_SDK` 是 `5000`。我们只留三个，机制一样。

`complete` 字段是个逃生门：某一段标记了 `complete: true`，它就成了全部提示词，别的段落和工具清单一起让位。多段同时标 `complete` 直接抛错——**这种配置错误不该静默投票解决。**

## 接进 loop

[main.ts](./main.ts) 的 `apply()` 注册两段：

```ts
ctx.systemPrompt.section({
  name: 'agent:identity',
  order: SECTION_ORDER.identity,
  text: '你是一个天气助手，只回答天气相关的问题。',
})
ctx.systemPrompt.section({
  name: 'agent:persona',
  order: SECTION_ORDER.persona,
  text: '回答时语气礼貌，不确定就明说。',
})
```

但工具清单不能这么写——天气工具是 `weather.ts` 注册的，跟这个插件没关系，而且它注册的时候，agent 早就 `apply` 完了。所以工具清单必须是**函数形式**：

```ts
ctx.systemPrompt.section({
  name: 'agent:tools',
  order: SECTION_ORDER.tools,
  text: () => ctx.systemPrompt.renderTools(ctx.tools.schemas()),
})
```

`assemble()` 被调用时才执行这个函数，所以拿到的永远是"此刻的全部工具"。

然后 `run()` 里两行是关键：

```ts
const system = ctx.systemPrompt.assemble()
ctx.sessionLog.append({ type: 'system/message', data: { content: system } })
const options: GenerateOptions = { messages: ctx.sessionLog.deriveMessages() }
```

第一行：提示词不是常量，是**现算的**。第二行：`deriveMessages()` 第 15 课就写好了，它本来就会把所有消息行折成历史；现在消息行里多了一种 `system/message`，日志一改，模型请求自动就带上了。

注意 `session.ts` 里 `ChatMessage.role` 从三种变四种：

```ts
export type ChatMessage = {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
}
```

还有一处容易漏的：`toChatMessage()` 里 `system/message` 那一支，和 `deriveMessages()` 里的 `sortSystemFirst()`。system 行是**按写入时刻**落的——每轮请求都跟在 user 后面。如果原样折出来，历史中间会插一条系统指令，对话被劈成两半。所以折完要把 system 提前：

```ts
function sortSystemFirst(messages: ChatMessage[]): ChatMessage[] {
  const system = messages.filter((message) => message.role === 'system')
  const rest = messages.filter((message) => message.role !== 'system')
  return [...system, ...rest]
}
```

**模型要求"先指令，后对话"**，这是接口约定，不是我们的偏好。

## 提示词变了，日志怎么办

一个立刻浮现的问题：提示词不随对话变化，每轮都追加一条，日志不就被灌满了？

我们的做法是**只在变了的时候记**，而且用第 16 课的 `replace` 顶掉上一版：

```ts
if (system !== lastSystem) {
  ctx.sessionLog.append(
    { type: 'system/message', data: { content: system } },
    lastSystemSeq === undefined ? 'append' : { op: 'replace', startSeq: lastSystemSeq, endSeq: lastSystemSeq },
  )
  lastSystem = system
  lastSystemSeq = ctx.sessionLog.list().at(-1)?.seq
}
```

日志里旧版还在（append-only 的规矩没破），模型只看得见最新版。**提示词的变化历史，和对话历史一样可以追溯。**

为什么非得记？因为第 14 课的那条铁律：**模型看得见的 ⟺ 日志里有的。** 提示词直接决定模型怎么回答，它当然是模型可见输入。不记下来，重启后恢复的会话就丢了"它当时是谁"。

## 跑起来

```
=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。另外提醒您，出门请酌情携带雨具。

=== 用户说：帮我写一首诗 ===
[模型回答] 抱歉，我是一个天气助手，只能回答天气相关的问题。

=== 改写身份段：允许闲聊 ===
[提示词变更] 现在共 58 字
[提示词变更] 现在共 84 字

=== 用户说：帮我写一首诗 ===
[模型回答] 晴空一字一行诗，云落枝头化作雨。
```

三处值得停下来看：

**第一轮，"出门请酌情携带雨具"。** 这句话来自 persona 段的"语气礼貌"。[mock-provider.ts](./mock-provider.ts) 的 `decide()` 会读 system 消息里有没有"语气"两个字，有就换礼貌版措辞。**提示词生效的唯一证据，就是模型的决策真的被它改变了。**

**第二轮，写诗被谢绝。** 身份段说"只回答天气相关的问题"，模型据此拒答。第 12 课问"你好"时它至少还会说不知道；现在它有身份了，知道自己不该接这个活。

**第三轮，同一句话答上来了。** 中间那三行是 `widenScope()`——用上一段注册返回的销毁器把旧身份段摘掉，注册一段新的"主要回答天气，但也能闲聊几句"。进程没重启，agent 没重建，**提示词换了，模型行为跟着变了。**

这就是注册表和常量的分界线：常量改一次要动代码，注册表改一次只需要一句 `section()`。

`[提示词变更]` 打了两行——旧段摘掉时一次，新段注册时一次。事件是 `ctx.on('system-prompt/change')` 收到的，**不是启动时假设好的**。谁写的插件都行，注册表只负责通知"我变了"。

## 日志与模型历史

```
=== 日志全量（10 条）===
#1 [user/message] 北京天气怎么样？
#2 [system/message] 你是一个天气助手，只回答天气相关的问题。

回答时语气礼貌，不确定就明说。

你可以使用以下工具：
- get_weather：查询一个城市的天气。需要城市名。
#3 [tool/call] get_weather({"city":"北京"})
#4 [tool/result] 北京：晴，12°C
#5 [assistant/message] 北京：晴，12°C。另外提醒您，出门请酌情携带雨具。
#6 [user/message] 帮我写一首诗
#7 [assistant/message] 抱歉，我是一个天气助手，只能回答天气相关的问题。
#8 [user/message] 帮我写一首诗
#9 [system/message] 你是一个天气助手，主要回答天气，但也能闲聊几句。

回答时语气礼貌，不确定就明说。

你可以使用以下工具：
- get_weather：查询一个城市的天气。需要城市名。
#10 [assistant/message] 晴空一字一行诗，云落枝头化作雨。

=== 第二轮请求时模型看到的历史（8 条）===
[system] 你是一个天气助手，主要回答天气，但也能闲聊几句。

回答时语气礼貌，不确定就明说。

你可以使用以下工具：
- get_weather：查询一个城市的天气。需要城市名。
[user] 北京天气怎么样？
[tool] 北京：晴，12°C
[assistant] 北京：晴，12°C。另外提醒您，出门请酌情携带雨具。
[user] 帮我写一首诗
[assistant] 抱歉，我是一个天气助手，只能回答天气相关的问题。
[user] 帮我写一首诗
[assistant] 晴空一字一行诗，云落枝头化作雨。
```

日志 10 条，模型历史 8 条。差两条：`#3` 是 `tool/call`（第 14 课起它就不进模型请求），`#2` 是旧版提示词——被 `#9` 的 `replace` 顶掉了。

`#2` 没从日志里消失，只是不再进请求。想看"它当时为什么拒绝写诗"，翻 `#2` 就行。**这就是第 16 课那套折叠机制的第二次服役：第一次用来压缩对话，这次用来替换提示词版本。**

日志里的 `system/message` 行有工具清单，这正好印证了 `text` 的函数形式：`#9` 是 `widenScope()` 之后新算出来的，清单一字不差。

## harness 真身的提示词长什么样

我们这套是"两段手写文本 + 一个工具清单渲染"。harness 真身 [packages/core/system-prompt](../../../deepseek-harness/packages/core/system-prompt/src/index.ts) 复杂得多，但骨架上处处能对上：

| 我们的 | harness 真身 |
|---|---|
| `SECTION_ORDER` 三个槽位 | `SECTION_ORDERS` 几十个槽位，`HARNESS_IDENTITY: -1000`、`TOOLS_SDK: 5000` |
| `assemble()` 每次请求前调用 | `agent.ts` 每个 step 重算（`assemble()` 在 loop 里，不在启动时） |
| `text: string \| (() => string)` | `text: string \| ((context) => string)`，收组装上下文 |
| 两段纯文本 | `includeHarnessIdentity` / `includeRuntimeContext` 开关 + `personaPrefix` / `personaSuffix` 配置字段 |
| 身份写死在代码里 | 默认身份也是硬编码的：`'You are an AI agent powered by DeepSeek Harness.'` |
| 没有变量 | `renderPrompt()` 支持 `{{provider}}`、`{{model}}`、`{{cwd}}` 插值，由 loop 提供 |
| 工具清单靠 `renderTools()` 手接 | `tools()` 注册一个 provider，`assemble()` 里自动收集并排序 |

有一点特别值得说：**harness 的身份段也是硬编码字符串。** 提示词的"注册表机制"和"内容本身"是两件事——机制做成可扩展的，内容该固定就固定。

还有一件反直觉的事：**Skills 不走 system prompt。** harness 的技能说明是通过 user 消息通道送进去的（`<system-reminder>` 标签），不是拼在 system prompt 里。要不要进 system prompt，取决于"这段话该不该每一轮都在场"——技能是按需加载的，身份是永远在场的。

`system/message` 也是 harness 真有的 session 事件类型。提示词每次变化都在日志里留痕，所以**换个进程、换台机器，都能重建出"模型当时听到了什么"**。

## 动手改一改

**实验一：注册一段没用的空文本。** 在 `apply()` 里加一段 `text: ''` 的段落，跑。`assemble()` 会把空文本过滤掉（`filter((text) => text.length > 0)`），输出不变。段落可以"注册了但此刻没话说"——这对条件性提示词很有用。

**实验二：把身份段的 order 改成 `2000`。** 现在身份排在工具清单（1000）后面了。跑一遍看日志里的 `system/message`——"只回答天气"那句话掉到了工具清单下面。**顺序是内容要求，order 那张表就是把它写下来的地方。**

**实验三：标一个 `complete`。** 给人设段加 `complete: true`，跑。现在整个提示词只剩人设那一句，身份段和工具清单全部让位。这就是"完全接管"模式——某些预设（比如纯对话角色）不需要工具清单时用它。

再进一步：给两段都标 `complete`，看它启动即崩：

```
system prompt 有 2 段标记了 complete：agent:identity、agent:persona
```

**两个都说自己是全部，这不是投票能解决的事。** 宁可启动时炸掉。

**实验四：给工具清单段换个 order。** 把 `agent:tools` 的 `order` 改成 `-2000`，跑。现在工具清单跑到了身份前面。模型先看到"你能用什么"，再看到"你是谁"——多数模型对指令顺序不敏感，但**这个顺序本该由部署方决定，不该由注册时机撞运气。**

## 小结

- system prompt 不是常量，是**有序段落注册表**：`section()` 注册、`assemble()` 现算、`renderTools()` 渲染工具清单
- 顺序由 `SECTION_ORDER` 这张公开表决定，不靠注册先后——写插件的人控制不了加载顺序
- `text` 可以是函数：工具清单这种"内容取决于别的插件"的段落，每次组装现算
- `complete: true` 是逃生门：一段独占全部；多段同时标 complete 直接抛错
- 提示词变了才追加日志，且用 `replace` 顶掉旧版——日志留痕、模型只看最新
- `deriveMessages()` 折完后要把 system 提前：模型要求先指令后对话
- 提示词生效的唯一证据是**模型决策被改变**，不是它被拼进了请求
- harness 真身在 [packages/core/system-prompt](../../../deepseek-harness/packages/core/system-prompt/src/index.ts)，`SECTION_ORDERS` 是同一张表的完整版

下一篇：[19 · 工具注册表：让插件自己把工具递上来](../part3/19-tool-registry/main.md)
