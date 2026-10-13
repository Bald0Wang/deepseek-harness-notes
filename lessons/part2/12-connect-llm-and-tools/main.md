# 12 · 把假模型和工具接起来

> 源码：[llm.ts](./llm.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 09 课你造了一条 `llm` 接缝，第 10、11 课你造了一条 `tools` 接缝。两边的接口都调通了，但**它们还没见过面**。

本课让它们合流。你会看到 harness 的心脏第一次跳动。

## 两条接缝，一个 loop

先把两边的形状摆在一起：

| 接缝 | 定义方 | 提供方 | 消费方 |
|---|---|---|---|
| `llm` | [llm.ts](./llm.ts)（第 09 课） | `MockAdapter` | 本课的 `agent` |
| `tools` | [tools.ts](./tools.ts)（第 10 课） | `MapTools` | 本课的 `agent` |

[main.ts](./main.ts) 就是那个消费方，它的 `inject` 要写两个名字：

```ts
export const inject = ['llm', 'tools']
```

一个插件可以同时依赖多条接缝。Cordis 会等两条都就位了才激活它——这就是第 02 课"注册即效果"的好处：**顺序你根本不用管**。

## 假模型升级成"常驻大脑"

第 09 课的假模型只会照着固定剧本念。本课的 [mock-provider.ts](./mock-provider.ts) 里，剧本条目可以是**两种东西**：

```ts
private script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]))[]
//               └─ 静态剧本，读一次翻页 ─┘  └─ 函数，每一轮都重新问它 ─┘
```

`stream()` 里对两者区别对待：

```ts
async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
  const entry = this.script[this.cursor]
  if (!entry) throw new Error('MockAdapter: 剧本用完了')

  // 函数条目是"常驻大脑"：每一轮都重新问它，不消耗
  if (typeof entry !== 'function') this.cursor += 1

  const chunks = typeof entry === 'function' ? entry(options) : entry
  for (const chunk of chunks) { yield chunk }
}
```

为什么函数条目不能消耗？因为**真模型就是这样的**：它是无状态的，你每发一次请求，它都看着当前的 `messages` 重新决策一次。第一轮问"北京天气"，它决定调工具；第二轮问"你好"，它就决定回文字。同一个模型，不同输入，不同决策。

如果按第 09 课的 `shift()` 写法，剧本读完就没了，第二轮直接抛错。那个写法只够演示"流式输出"，撑不起 agent loop。

`decide()` 就是这颗假大脑，注意它的签名收的是**整个请求**而不是一句字符串：

```ts
export function decide(options: GenerateOptions): StreamChunk[] {
  const input = options.messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''
  if (input.includes('北京')) return toolCallResponse('call-1', 'get_weather', { city: '北京' })
  if (input.includes('天气')) return toolCallResponse('call-2', 'get_weather', { city: '北京' })
  return textResponse(`我不知道怎么回答"${input}"，但我可以查天气。`)
}
```

真模型靠训练学会"什么时候该调工具"，我们没法训练，就用 `if` 把决策写死。**重点不在这段逻辑，而在于它输出的形状和真模型一模一样**——消费方完全感知不到差别。

## collect()：把碎片拼回整块

第 09 课的 `for await` 循环只是把 chunk 打印出来。本课的 [main.ts](./main.ts) 里换成了 `collect()`——它要把流式碎片**拼回一个完整的结构**。

关键在于：模型的工具参数是被切碎的。`toolCallResponse()` 故意把参数 JSON 切成了两半：

```ts
{ type: 'tool-call-delta', index: 0, id: 'call-1', name: 'get_weather', argumentsDelta: '{"cit' }
{ type: 'tool-call-delta', index: 0, id: 'call-1', argumentsDelta: 'y":"北京"}' }
```

`argumentsDelta` 是"增量"，必须拼起来才是完整的 `{"city":"北京"}`。而且**模型可能同时开多个内容块**（先说半句话，再调个工具），所以碎片要按 `index` 分组存放：

```ts
const texts = new Map<number, string>()
const calls = new Map<number, { id: string; name: string; arguments: string }>()

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'text-delta':
      texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
      break
    case 'tool-call-delta': {
      const existing = calls.get(chunk.index) ?? { id: chunk.id, name: '', arguments: '' }
      // name 可能只在第一条 delta 上出现，后续是 undefined，不能覆盖
      if (chunk.name !== undefined) existing.name = chunk.name
      existing.arguments += chunk.argumentsDelta
      calls.set(chunk.index, existing)
      break
    }
    // ...
  }
}
```

`name` 那一行是踩过坑才写的：真模型只在第一个 delta 里给工具名，后面的 delta 这个字段是 `undefined`。无条件赋值会把名字抹掉。

## ModelTurn：一个判别联合

`collect()` 的返回类型是本课的第二个重点：

```ts
type ModelTurn =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; id: string; name: string; args: Record<string, unknown> }
```

这就是第一篇反复强调的**判别联合**（第 07 课的 `FiberState` 也是它）。每个成员带一个 `kind` 标签，消费方 `switch` 一下就能收窄类型：

```ts
switch (turn.kind) {
  case 'text':
    console.log(`[模型回答] ${turn.text}`)
    break
  case 'tool-call':
    console.log(`[模型决定] 调用 ${turn.name}，参数 ${JSON.stringify(turn.args)}`)
    await executeTool(turn)
    break
}
```

`switch` 一进 `case 'tool-call'`，TypeScript 就知道 `turn.name` 一定存在——不用写任何类型断言。如果你漏写一个分支，`turn` 在那个分支里还是整个联合类型，一访问 `.name` 就编译报错。**这是类型系统在替你把关。**

harness 真身里对应的东西是 `ContentBlock`（[packages/llm/llm/src/types.ts](../../../deepseek-harness/packages/llm/llm/src/types.ts)），模型的一轮输出永远是一个 block 数组——`text`、`reasoning`、`image`、`tool-call`、`tool-addition`……本课先只看两种，第三篇再扩展。真身的 `ToolCallBlock` 和我们的 `{ kind: 'tool-call', ... }` 是同一个东西：都带 `id`、`name` 和一串**原始 JSON 字符串** `arguments`（注意不是解析好的对象——解析和校验是运行时的事，不是模型的事）。

## 跑起来

```
=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C

=== 用户说：你好 ===
[模型回答] 我不知道怎么回答"你好"，但我可以查天气。
```

同一颗假大脑，两种输入，两种输出。第二条路径里 `tools` 一行都没用上——但它已经在那儿待命了。

## 缺的那一半

盯着上面的输出看：模型说"调用 `get_weather`"，工具返回了"北京：晴，12°C"——**然后呢？**

真实对话里，这个结果必须再发回给模型，模型看着它才能说出一句人话：

```
用户：北京天气怎么样？
模型：调用 get_weather({"city":"北京"})
工具：北京：晴，12°C
模型：北京今天晴，12 摄氏度。      ← 现在才轮到它说话
```

本轮结束后，结果只是打印在了屏幕上。缺的是"**把工具结果追加到 messages，再请求一次模型**"。

这就是 agent loop 的第二圈，也是第三篇的开场。你现在写的 `collect()` 和 `ModelTurn`，就是那圈循环的两个零件。

## 动手改一改

**实验一：让模型多说一句话。** 在 [main.ts](./main.ts) 的 `executeTool()` 里，拿到结果后再请求一次模型：

```ts
async function executeTool(call: Extract<ModelTurn, { kind: 'tool-call' }>) {
  const result = await ctx.tools.call(call.name, call.args)
  if (!result.ok) {
    console.log(`[工具失败] ${result.error}`)
    return
  }
  console.log(`[工具返回] ${String(result.value)}`)

  // 把工具结果告诉模型，让它说人话
  const follow = await collect(ctx.llm.stream({
    messages: [{ role: 'user', content: call.args.city as string }],
  }))
  if (follow.kind === 'text') console.log(`[模型回答] ${follow.text}`)
}
```

注意这里直接读了 `call.args.city`——第 11 课的校验保证了 `city` 一定存在且是字符串，但 TypeScript 不知道，所以要写 `as string`。（harness 真身用 `InferArgs<S>` 从 schema 推导参数类型，这样就不用断言了。我们为了不引入泛型地狱，先手动标一下。）

**实验二：故意让参数不合法。** 把 `decide` 里的第一条改成 `toolCallResponse('call-1', 'get_weather', { unit: 'kelvin' })`，跑一遍：

```
[模型决定] 调用 get_weather，参数 {"unit":"kelvin"}
[工具失败] invalid arguments: $.city 是必填项，但没有提供
```

第 11 课的校验层在这条路上也生效——它在 `execute` 外面包着，谁调用都逃不掉。

## 小结

- 一个插件可以 `inject` 多条接缝，Cordis 保证它们都就位后才激活
- 假模型分静态剧本（读一次翻页）和函数条目（每轮重新决策）两种，**函数条目才像真模型**
- `collect()` 按 `index` 把流式碎片拼回整块，工具参数的 `argumentsDelta` 必须拼接才能解析
- `ModelTurn` 是判别联合，`switch (turn.kind)` 让 TypeScript 替你收窄类型
- 现在只跑了一圈：模型 → 工具 → 打印。**把工具结果喂回模型**是第三篇的事

下一篇：[13 · 工具失败了怎么办](13-tool-failure/main.md)
