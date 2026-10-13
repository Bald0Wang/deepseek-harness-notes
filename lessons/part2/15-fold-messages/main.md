# 15 · 从日志折出模型看得见的历史

> 源码：[session.ts](./session.ts) · [llm.ts](./llm.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [json-schema.ts](./json-schema.ts) · [provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 14 课把发生过的事都写进了日志。但有个尴尬的问题：**模型看不见那份日志**。

每一轮我们都是这么请求的：

```ts
const options: GenerateOptions = { messages: [{ role: 'user', content: input }] }
```

请求里永远只有当前这一句。模型问"刚才我问了什么"，它真的一无所知——不是它记性差，是我们压根没告诉它。

本课把日志和请求接上。

## 日志 ≠ 模型请求

这是两个不同的东西，得分开看：

| | 日志（session log） | 模型请求（messages） |
|---|---|---|
| 内容 | 发生过的**一切**，包括失败的调用、turn 边界 | 模型**需要知道**的历史 |
| 谁读 | 人、复盘工具、UI | 只有模型 |
| 长度 | 只增不减 | 可以压缩、可以裁剪 |
| 修改 | 永不改写 | 每次请求重新生成 |

第 14 课我们只做了左边。右边是空的，所以 loop 每一轮都是"失忆"状态。

harness 的做法是：**每次请求前，从日志现场折一份请求出来**。这个动作叫 `deriveMessages()`——名字里的 "derive" 是"推导"，意思是"不另外存一份，现算"。

## 一行代码换掉一整段历史

[main.ts](./main.ts) 里改动最小的地方最关键：

```ts
// 第 14 课：请求只带当前这一句
const options: GenerateOptions = { messages: [{ role: 'user', content: input }] }

// 本课：请求带整段折出来的历史
const options: GenerateOptions = { messages: ctx.session.deriveMessages() }
```

注意是 `ctx.session.deriveMessages()`，不是 `ctx.session.list()`。两者的区别就是本课的全部内容：

- `list()` 返回日志全量——**人**看的，`tool/call`、失败记录全在里面
- `deriveMessages()` 返回模型可见的那部分——**模型**看的，折叠过的

harness 真身在 [packages/core/session/src/index.ts 第 856 行](../../../deepseek-harness/packages/core/session/src/index.ts#L856) 实现了 `deriveMessages()`，折叠逻辑在 [surface.ts](../../../deepseek-harness/packages/core/session/src/surface.ts)。那里有句注释值得抄下来：

> The model-visible surface deliberately shadows replaced ranges, so it is the wrong source for a human transcript.

翻译：**模型看得见的那块，故意遮住了被替换掉的范围，所以拿它当人类看的对话记录是错的。** 人看 `list()`，模型看 `deriveMessages()`，各取所需。

## 哪些行进得去，哪些进不去

不是每行日志都能变成一条消息。看 `SessionRecordMap` 里那四种类型：

```ts
'user/message'     → 用户说的话        → 进
'assistant/message' → 模型说的话        → 进
'tool/result'      → 工具的返回值       → 进
'tool/call'        → 模型的调用意图     → 不进
```

`tool/call` 为什么不进？因为**它已经被同一轮的 `assistant/message` 代表了**。模型说"我要调 get_weather"和模型说的一段话，在它那儿是同一次输出；工具调用的参数是我们为了执行方便另外拆出来存的结构。再把它塞回 messages，等于同一件事说两遍。

harness 真身把"能进消息历史的类型"单独列了个联合，叫 `SurfaceEventType`（[types.ts 第 439 行](../../../deepseek-harness/packages/core/session/src/types.ts#L439)）。我们照抄这个思路，只是名字起得直白些：

```ts
export type SurfaceRecordType = 'user/message' | 'assistant/message' | 'tool/result'
```

有了这张表，`SessionLine` 上那个可选字段就能写得**类型安全**：

```ts
readonly surfaceOp?: K extends SurfaceRecordType ? SurfaceOp : never
```

`K` 是当前这个成员的 `type`。三种消息类型拿到 `SurfaceOp | undefined`，`tool/call` 拿到 `never`——**给它传 `surfaceOp` 直接编译报错**。类型层面就保证了 `tool/call` 永远进不了模型历史，不靠运行时检查，也不靠"记得别传"。

## 折叠：surfaceOp 的三种命运

折叠的过程在 [session.ts](./session.ts) 的 `deriveMessages()` 里，核心是个有序列表：

```ts
deriveMessages(): ChatMessage[] {
  const surface: SessionLine[] = []
  for (const line of this.records) {
    const op = line.surfaceOp
    if (op === undefined) continue              // 非消息行：跳过
    if (op === 'append') { surface.push(line); continue }
    // replace：挖掉旧段，在原来的位置插入新行
    const start = surface.findIndex((node) => node.seq === op.startSeq)
    const end = surface.findIndex((node) => node.seq === op.endSeq)
    if (start === -1 || end === -1) continue
    surface.splice(start, end - start + 1, line)
  }
  return surface.map(toChatMessage)
}
```

本课只走前两条路：`undefined`（`tool/call`）跳过，`append`（其余三种）加到末尾。`replace` 那条分支是下一课的主角。

## 跑起来

```
=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。出门看情况带把伞。

=== 用户说：你好 ===
[模型回答] 我不知道怎么回答"你好"，但我可以查天气。

=== 用户说：刚才我问了什么？ ===
[模型回答] 你问了我北京天气，我查完还提醒了你带伞。

=== 日志全量（8 条）===
#1 [user/message] 北京天气怎么样？
#2 [tool/call] get_weather({"city":"北京"})
#3 [tool/result] 北京：晴，12°C
#4 [assistant/message] 北京：晴，12°C。出门看情况带把伞。
#5 [user/message] 你好
#6 [assistant/message] 我不知道怎么回答"你好"，但我可以查天气。
#7 [user/message] 刚才我问了什么？
#8 [assistant/message] 你问了我北京天气，我查完还提醒了你带伞。

=== 模型看到的历史（折叠后 7 条）===
[user] 北京天气怎么样？
[tool] 北京：晴，12°C
[assistant] 北京：晴，12°C。出门看情况带把伞。
[user] 你好
[assistant] 我不知道怎么回答"你好"，但我可以查天气。
[user] 刚才我问了什么？
[assistant] 你问了我北京天气，我查完还提醒了你带伞。
```

**日志 8 条，模型看得见 7 条。** 差的那 1 条就是 `#2` 的 `tool/call`。

第三轮"刚才我问了什么"模型能答对，靠的是那 7 条历史真的递到了它面前。[mock-provider.ts](./mock-provider.ts) 的 `decide` 里是这样判的：

```ts
const sawWeather = history.some((message) => message.content.includes('北京'))
if (sawWeather) return textResponse('你问了我北京天气，我查完还提醒了你带伞。')
return textResponse('我没有历史记忆，每次请求只带当前这一句。')
```

注意这个 else 分支——它就是第 14 课的样子。当时每条请求只有一句 user 消息，`history.some(...)` 永远为 false，所以模型只会说"我没有历史记忆"。**同一份代码，改不改那行 `deriveMessages()`，决定了模型是失忆还是记得。**

## 动手改一改

**实验一：把 `deriveMessages()` 改回手搓。** 把 [main.ts](./main.ts) 里的 `messages: ctx.session.deriveMessages()` 改回 `messages: [{ role: 'user', content: input }]`，跑一遍。第三轮立刻变成"我没有历史记忆"。**一行代码，记忆全失。**

**实验二：把 `tool/call` 塞进模型历史。** 把 [session.ts](./session.ts) 里 `toLine` 的 `case 'tool/call'` 改成 `return { seq, time, type: 'tool/call', data: record.data, surfaceOp: op }`。编译直接报错——`never` 不接受任何值。这就是第 14 课说的"判别联合不用写断言"的又一例：**编译期说不通的事，运行时连试都不用试。**

**实验三：往日志里塞一条不存在的类型。** 在 `replay()` 之前加一句 `ctx.session.append({ type: 'tool/call', data: { callId: 'x', name: 'y', arguments: '{}' } })`，跑一遍看日志变成 9 条、模型历史还是 7 条。日志什么都收，模型只看该看的——**这就是两条线分开的好处。**

## 小结

- 日志是给人看的全量事实，模型请求是折出来的可见子集，两者不是一回事
- `deriveMessages()` 每次请求前从日志现算，日志和模型看到的东西永远一致
- `tool/call` 不进模型历史——它已被同轮的 `assistant/message` 代表；类型上用 `never` 保证
- `surfaceOp` 有三种命运：`undefined` 跳过、`'append'` 进、`'replace'` 挖掉旧段换新的
- 同一份 `decide` 代码，请求里带历史就记得、不带就失忆——差别只在 `main.ts` 那一行

下一篇：[16 · 压缩：让历史变短，日志不变](16-compaction/main.md)
