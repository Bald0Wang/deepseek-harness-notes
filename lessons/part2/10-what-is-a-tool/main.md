# 10 · 工具是什么

> 源码：[tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第二篇开始。第一篇你学会了 Cordis 的地基，现在用它搭 harness 最显眼的那块砖——**工具（tool）**。

## 从第 09 课的悬念说起

第 09 课的假模型吐过一串这样的东西：

```
--- 内容块开始（tool-call）---
[工具调用片段] id=call-1 name=get_weather 参数={"cit
[工具调用片段] id=call-1 name=(同上) 参数=y":"北京"}
--- 内容块结束：工具 get_weather({"city":"北京"}) ---
```

模型说"我要调用 `get_weather`，参数是 `{"city":"北京"}`"。**然后呢？** 谁来执行？执行完怎么把结果还给模型？

答案就是本课的 `ctx.tools`。

## 一个工具 = 一张说明书 + 一个函数

模型是不联网、不会算数、不知道今天的日期的。它能做的只有"说出一个工具名 + 一串参数"。所以 harness 给每个工具准备两份东西：

| 部分 | 给谁看 | 内容 |
|---|---|---|
| 说明书（`name`/`description`/`parameters`） | **模型** | 它决定要不要调这个工具、该传什么参数 |
| 执行体（`execute`） | **运行时** | 真正干活的那段代码 |

模型只看说明书。说明书写得含糊，模型就调错；`execute` 写得再好也白搭。**写工具的一半功夫在写说明书。**

harness 真身里这个两份一体的东西叫 `ToolDefinition`（[packages/core/tools/src/index.ts](../../../deepseek-harness/packages/core/tools/src/index.ts)），由 `defineTool()` 工厂函数产出。我们照抄这个名字和形状。

## 又是第 07 课的三个角色

工具这条接缝的结构，和第 07 课的 `notifier` 一模一样：

| 角色 | 文件 |
|---|---|
| **Service Definition**（定义） | [tools.ts](./tools.ts)——`abstract class Tools` |
| **Service Provider**（提供方） | [provider.ts](./provider.ts)——基于 Map 的注册表 |
| **Consumer**（消费方） | [main.ts](./main.ts)——模拟 agent，只查表、调用 |

定义只有一个抽象类，四个方法：

```ts
export abstract class Tools extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  abstract register(definition: ToolDefinition): () => void
  abstract get(name: string): ToolDefinition | undefined
  abstract list(): ToolDefinition[]
  abstract call(name: string, args: unknown): Promise<ToolResult>
}
```

> [tools.ts](./tools.ts) **不进 cordis.yml**——它和第 07 课的 `notifier.ts`、第 09 课的 `llm.ts` 一样，只是词汇表。

四个方法的分工：`register` 往里放，`get`/`list` 往外查，`call` 执行。第 09 课的假模型已经在输出里说过 `get_weather` 这个名字了——本课就让它真的能被调用。

## register 返回一把摘除函数

看 [provider.ts](./provider.ts) 的核心：

```ts
register(definition: ToolDefinition): () => void {
  return this.ctx.effect(() => {
    this.definitions.set(definition.name, definition)
    return () => {
      this.definitions.delete(definition.name)
    }
  }, `tools.register(${definition.name})`)
}
```

这就是第 02 课的"**注册即效果**"，一字不差：

- `ctx.effect(fn, label)` 立即执行 `fn`，并收下它返回的清理函数
- 注册方插件一卸载，清理函数自动跑，工具从表里消失
- 没有"忘了反注册"这回事

返回的那把 `() => void` 是给手动摘除用的。harness 里的 `ctx.tools.register()` 也返回同样的句柄（`AdapterRegistrationHandle` 那种 disposable）。

`ctx.effect` 的第二个参数是**资源名**，它会出现在第 08 课讲的诊断信息里，所以别省。

## 说明书怎么写

[weather.ts](./weather.ts) 是完整范本，和 harness 里的 `web_search` 同一个形状：

```ts
export const inject = ['tools']   // ← 要拿 ctx.tools，必须先声明

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'get_weather',
    description: '查询一个城市的天气。需要城市名。',
    parameters: {
      city: {
        type: 'string',
        required: true,
        description: '城市名，例如 "北京"',
      },
    },
    async execute(args) {
      return `${args.city}：晴，12°C`
    },
  }))
}
```

对照 harness 真身（[packages/web/tool-web/src/search.ts](../../../deepseek-harness/packages/web/tool-web/src/search.ts) 第 325 行起）：

```ts
ctx.tools.register(defineTool({
  name: 'web_search',
  description: 'Search the web for current information. ...',
  parameters: {
    queries: { type: 'array', required: true, items: { type: 'string' }, description: `1–${maxQueries} search queries; their results are merged.` },
  },
  output: { schema: {...}, render: (_args, value) => [...] },
  timeoutMs,
  isConcurrencySafe: () => true,
  async execute(args, exec) { ... },
  presentCall: presentSearchCall,
  presentResult: (args, result) => presentSearchResult(args, result),
}))
```

`name`、`description`、`parameters`、`execute` 四个字段完全对得上。真身多出来的 `output`、`timeoutMs`、`isConcurrencySafe`、`presentCall`/`presentResult` 分别是"输出怎么渲染""超时多久""能不能并行""界面怎么展示"——本课先不做，第 11、12 课陆续补。

### description 是写给模型看的

`description` 和 `parameters` 里每个字段的 `description` 会**原样进入模型的请求**。所以：

- 写"查询一个城市的天气。需要城市名。"——模型知道该传 `city`
- 写"天气工具"——模型只能瞎猜

`parameters` 是手写的 JSON Schema DSL：`{ type: 'string', required: true, items: {...} }` 这种。第 11 课会讲 harness 怎么把它编译成标准 JSON Schema 并用它**校验模型传来的参数**——那是工具系统里最要紧的一道防线。

## 跑起来

```bash
cd lessons/part2/10-what-is-a-tool
node --import tsx/esm ../../../launcher.ts
```

预期输出：

```
=== 用户说：北京天气怎么样？ ===
[可用工具] get_weather — 查询一个城市的天气。需要城市名。
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C

=== 用户说：你好呀 ===
[可用工具] get_weather — 查询一个城市的天气。需要城市名。
[模型] 这个问题不用工具，直接回答。

=== 用户说：查一下天气 ===
[可用工具] get_weather — 查询一个城市的天气。需要城市名。
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
```

三段对话覆盖三种情况：有城市名 → 调工具；闲聊 → 不调；只有"天气"没城市名 → 用默认城市调。

`matchTool()` 是**假模型的决策逻辑**。真模型是通过第 09 课的 `tool-call` chunk 把决定告诉你的——第 12 课我们会把两者接起来，那时候这段 if 就换成"读流式输出"。

## 失败也是结果，不是异常

注意 [provider.ts](./provider.ts) 的 `call()`：

```ts
async call(name: string, args: unknown): Promise<ToolResult> {
  const definition = this.definitions.get(name)
  const callId = `call-${++this.counter}`
  if (!definition) {
    return { ok: false, callId, name, error: `工具不存在：${name}` }
  }
  try {
    const value = await definition.execute((args ?? {}) as ToolArgs, { callId })
    return { ok: true, callId, name, value }
  } catch (error) {
    return { ok: false, callId, name, error: error instanceof Error ? error.message : String(error) }
  }
}
```

工具执行失败时，`call()` **不往外抛**，而是返回一个 `ok: false` 的结果壳。这是 harness 的真实做法：工具报错是**常态**（模型传错参数、网络超时、文件不存在），这些信息要**喂回给模型**让它自己纠正，而不是把整个 agent 搞崩。

你刚才已经见过这个壳了——第一次运行忘了写 `inject`，输出是：

```
[weather-tool] Error: cannot get property "tools" without inject
[launcher] 插件加载失败（FAILED）：weather-tool
=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具失败] 工具不存在：get_weather
```

注意最后一行：**工具没注册成功，但 agent 没崩**，它规规矩矩地报了个"工具不存在"。这就是结果壳的价值——`ctx.tools.call()` 永远有东西可返回。launcher 则通过 FAILED 状态和退出码 1 告诉你"有插件没起来"（第 08 课）。

## 动手改一改

两个小实验，都能在 30 秒内看到差别：

**1. 看注册即效果。** 在 [cordis.yml](./cordis.yml) 里把 `- name: './weather.ts'` 删掉再跑——三段对话全部变成 `[工具失败] 工具不存在：get_weather`。工具注册是插件的效果，插件不在，工具就不在。

**2. 让工具抛错。** 把 `weather.ts` 的 `execute` 改成：

```ts
async execute() {
  throw new Error('网络超时')
}
```

再跑，你会看到 `[工具失败] 网络超时`——**异常被壳接住了**，agent 继续跑完后面两轮。这正是"失败也是结果"的意思。

## 小结

- 一个工具 = 说明书（`name`/`description`/`parameters`，给模型看）+ 执行体（`execute`，给运行时跑）
- `ctx.tools.register(defineTool({...}))` 注册工具，返回的摘除函数随注册方插件卸载自动执行
- `description` 和 `parameters` 会进模型请求，写清楚就是写好工具的一半
- `ctx.tools.call()` 永不抛异常，失败收进 `ok: false` 的结果壳，喂回给模型
- 工具接缝 = 第 07 课的三角色：定义（`Tools`）+ 提供方（`MapTools`）+ 消费方（agent）

下一篇：[11 · 给工具上校验](11-tool-validation/main.md)
