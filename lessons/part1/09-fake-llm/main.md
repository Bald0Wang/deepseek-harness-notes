# 09 · 造一个假 llm 服务

> 源码：[llm.ts](./llm.ts) · [mock-provider.ts](./mock-provider.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

这是第一篇的收尾，也是通往第二、三篇的桥。从这一课开始，我们进入 harness 的正题——**模型调用**。

## 为什么先造假模型

真实的模型调用要 API Key、要联网、要花钱。harness 自己的测试也面临同一个问题，它的解法是写一个 `MockAdapter`：一个按剧本演戏的假适配器。本课我们照抄这个思路，从零造一个简化版。

好处很直接：

- 不用 Key、不联网，随时能跑
- 输出完全可控，适合讲清楚"流式协议长什么样"
- 第二篇的 agent loop 可以直接拿它当模型，全程离线

## 三个文件，三种角色

又是上一课的接缝结构，一个字符都没变：

| 角色 | 文件 |
|---|---|
| **Service Definition**（定义） | [llm.ts](./llm.ts)——`abstract class Llm` |
| **Service Provider**（提供方） | [mock-provider.ts](./mock-provider.ts)——`MockAdapter` |
| **Consumer**（消费方） | [main.ts](./main.ts)——只管收碎片 |

定义只有十行：

```ts
export abstract class Llm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

harness 里对应的真身是 `dsh-llm` 包的 `LlmAdapter`，方法名叫 `stream`，参数类型叫 `GenerateOptions`，返回类型叫 `StreamChunk`——我们连名字都照着取，第三篇换真模型时你会有既视感。

> 同样地，[llm.ts](./llm.ts) **不进 cordis.yml**。它只是词汇表。

## StreamChunk：模型输出的词汇表

真实模型不是"一下子"给你整段回复，而是**一个字一个字往外吐**。每吐一口，就叫一个 chunk（碎片）。harness 把 chunk 分成七种，用 `type` 字段区分：

```ts
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: 'text' | 'tool-call' }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'finish'; reason: { kind: 'stop' | 'tool-calls' | 'max-tokens' | 'error' } }
```

这种写法叫**判别联合（discriminated union）**，是 TS 里最常用的模式之一，也是第 0 篇速查表里提过的"关公像"：

- `type` 是判别标签，每个 chunk 必须有一个
- `index` 是内容块的编号。模型可能边说边调工具，文字是 0 号块，工具调用是 1 号块，碎片靠 `index` 认领归属
- 顺序有约定：`block-start` → 若干 delta → `block-end` → `usage` → `finish`

一个完整回复的 chunk 序列长这样：

```
block-start  (text)
text-delta   "你"
text-delta   "好"
block-end    { type: 'text', text: '你好' }
usage        输入 10 / 输出 2
finish       stop
```

`usage`（token 用量）和 `finish`（结束原因）放在最后，因为只有流完了才知道花了多少、为什么停。

## 剧本：textResponse 和 toolCallResponse

假模型的核心是"照着念"。这两个函数把一句台词切成一串标准 chunk，代码是 harness 测试文件的简化版：

```ts
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}
```

`Array.from(text, ...)` 会遍历字符串的每个字符——所以"一个字符一条 delta"就是这么来的，模拟真实模型逐字吐字。

`toolCallResponse` 更有意思，它把参数（一个 JSON 字符串）**切成两半**分两次流出：

```ts
{ type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson.slice(0, 5) },
{ type: 'tool-call-delta', index: 0, id, argumentsDelta: argumentsJson.slice(5) },
```

注意第二条**没有 `name`**——因为名字已经在第一条说过了。所以消费方必须把同一个 `id` 的 delta 拼起来，才能还原完整的 `{"city":"北京"}`。这是真实流式协议的约束：**任何一条 delta 都可能只携带部分信息**。

## async function*：会吐东西的异步函数

```ts
async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
  const entry = this.script.shift()
  const chunks = typeof entry === 'function' ? entry(options) : entry
  for (const chunk of chunks) {
    yield chunk
  }
}
```

`async function*` 是"异步生成器"：`yield` 一次吐一个值，调用方用 `for await` 一个一个收。它返回的东西类型就是 `AsyncIterable<T>`——正好是抽象方法要求的返回类型，所以不用包一层。

> 对照 JS：`function*` + `yield` 你如果见过，`async function*` 就是它的异步版，配 `for await...of` 使用。

## 消费方：for await 一把梭

[main.ts](./main.ts) 里的 `run()` 是整个 harness agent loop 的胚胎：

```ts
for await (const chunk of ctx.llm.stream(options)) {
  print(chunk)
}
```

`print()` 是一个 `switch (chunk.type)`，对七种 chunk 各打一行。这正是第 0 篇讲的判别联合标准用法——**TS 会检查你是不是每种 `type` 都处理了**，漏一种就报错。

## 跑起来

```bash
cd lessons/part1/09-fake-llm
node --import tsx/esm ../../../launcher.ts
```

预期输出：

```
--- 内容块开始（text）---
你好，我是假模型。
--- 内容块结束：文字 "你好，我是假模型。" ---
[用量] 输入 10 / 输出 9 tokens
[结束] 原因：stop
--- 内容块开始（tool-call）---
[工具调用片段] id=call-1 name=get_weather 参数={"cit
[工具调用片段] id=call-1 name=(同上) 参数=y":"北京"}

--- 内容块结束：工具 get_weather({"city":"北京"}) ---
[用量] 输入 10 / 输出 5 tokens
[结束] 原因：tool-calls
--- 内容块开始（text）---
你刚才说：第二篇我们会学工具
--- 内容块结束：文字 "你刚才说：第二篇我们会学工具" ---
[用量] 输入 10 / 输出 14 tokens
[结束] 原因：stop
```

三段剧本依次演完：第一段纯文字，第二段工具调用（注意参数被切成两半，第二条 delta 没有 `name`），第三段是**函数剧本**——它读你的输入再决定说什么，说明剧本不一定是写死的。

## 动手改一改

试试把 [mock-provider.ts](./mock-provider.ts) 的剧本换成：

```ts
(options) => textResponse(`我收到 ${options.messages.length} 条消息`)
```

再跑一次，你会看到消费方把 `messages` 原样传了过来——**请求里有什么，提供方就能看到什么**，这就是 `GenerateOptions` 的作用。

## 小结

- 模型输出是**流式的**：`StreamChunk` 七种类型，用 `type` 判别
- chunk 顺序：`block-start` → delta → `block-end` → `usage` → `finish`
- `MockAdapter` 照剧本演戏，不用 API Key 就能驱动整个 agent
- `async function*` + `yield` + `for await` 是流式代码的三件套
- 判别联合 + `switch` 是处理这类数据的标准姿势，TS 会帮你查漏

第一篇到这里结束。你现在已经掌握了 harness 的全部地基：插件、生命周期、服务、事件、配置、组合、接缝、诊断、流式协议。

下一篇：[10 · 工具是什么](10-what-is-a-tool/main.md)（第二篇 · 工具与记忆）
