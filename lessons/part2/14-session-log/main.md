# 14 · session log：把发生过的事写进磁盘

> 源码：[session.ts](./session.ts) · [llm.ts](./llm.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [json-schema.ts](./json-schema.ts) · [provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 12 课的 agent loop 跑完了，然后呢？

**什么都没留下。** 屏幕上的字打印完就没了，进程一退，模型问过什么、工具返回了什么，全部蒸发。

本课给 loop 装上**记忆**。

## 问题：屏幕不是事实来源

想想你要做的那些事，全都要读历史：

- 关掉终端，明天重新打开，怎么接着聊？
- 用户往上翻聊天记录，那界面上的字从哪来？
- 事后复盘"这个工具为什么被调了三次"，证据在哪？

harness 的答案是一条**只增不减的日志**（append-only log），叫 session log。它有一套铁律：

> **凡是进过模型请求的东西，必须能从日志里原样重建。**

反过来也成立：凡是日志里没有的，就不该进模型请求。这条双向约束叫"模型可见 ⟺ 已记录"，是 harness 最核心的设计不变量之一。

## 又是第 07 课的三个角色

| 角色 | 位置 |
|---|---|
| Service Definition | [session.ts](./session.ts) 的 `abstract class Session` |
| Service Provider | 同文件的 `class JsonlSession` |
| Consumer | [main.ts](./main.ts) 的 `agent` 插件 |

`inject` 现在要写三个名字：

```ts
export const inject = ['llm', 'tools', 'session']
```

Cordis 会等三条接缝全部就位才激活 `agent`——第 02 课"注册即效果"的规矩，一个插件都不例外。

## 一行一条 JSON

[session.ts](./session.ts) 里最值得看的是 `SessionLine` 的类型定义：

```ts
export type SessionLine = {
  [K in keyof SessionRecordMap]: {
    readonly seq: number
    readonly time: number
    readonly type: K
    readonly data: SessionRecordMap[K]
    readonly surfaceOp?: K extends SurfaceRecordType ? SurfaceOp : never
  }
}[keyof SessionRecordMap]
```

这坨符号是第 10 课那个判别联合的**批量生成版**。拆开看：

```ts
// SessionRecordMap 是一张表：一个 type 对应一种 data
export interface SessionRecordMap {
  'user/message': { content: string }
  'assistant/message': { text: string }
  'tool/call': { callId: string; name: string; arguments: string }
  'tool/result': { callId: string; name: string; value: unknown; isError: boolean }
}
```

外层那层 `{ [K in ...]: {...} }[keyof ...]` 的意思是："对表里每一个 key，造一个带 `type: K` 和对应 `data` 的成员，然后取它们的并集。"

最后那个 `surfaceOp` 字段本课不用管——它是可选的，只在下一课"压缩上下文"时出现。你现在只需知道：**日志里多一个可选字段，不会让旧的日志文件失效**，这正是 append-only 格式能一步步演化的原因。

效果就是你写下的每一行都有类型保护：

```ts
ctx.session.append({ type: 'user/message', data: { content: input } })   // ✓
ctx.session.append({ type: 'user/message', data: { txt: input } })      // ✗ 编译报错
ctx.session.append({ type: '不存在的事件', data: {} })                   // ✗ 编译报错
```

harness 真身的 `SessionEvent`（[packages/core/session/src/types.ts 第 493 行](../../../deepseek-harness/packages/core/session/src/types.ts#L493)）用的是同一招，只是它的 `SessionEventMap` 有二十多种事件。真身还给整个事件加了一个 `ignorable?: true` 标记：**不认识的事件类型，要么能安全跳过（带标记），要么必须拒绝重建**——不能默默丢掉一条可能影响解释的记录。

## arguments 存字符串，不存对象

注意 `tool/call` 的 data：

```ts
'tool/call': { callId: string; name: string; arguments: string }
```

`arguments` 是**模型吐出的原始 JSON 字符串**，不是我们 `parseArgs()` 之后的对象。为什么？

因为日志的职责是"模型说了什么"，不是"我们理解成了什么"。模型吐的字符串是事实，我们解析的结果是解释。解释可能出错（第 11 课的校验失败就是解释出错），事实不会。harness 真身的 `tool/call` 事件一字不差地保留了这一点——注释里写着 "raw `arguments` JSON string exactly as the model produced it (unparsed)"。

所以 [main.ts](./main.ts) 里要绕一下：

```ts
// 内存里 turn.args 已经是对象了，但落盘要还原成模型吐的那串字符
data: { callId: turn.id, name: turn.name, arguments: JSON.stringify(turn.args) }
```

## append-only：写出去的行永不改写

`append()` 的核心只有三行：

```ts
append(record: SessionRecord, op: SurfaceOp = 'append'): number {
  this.seq += 1
  const line = this.toLine(this.seq, record, op)
  this.records.push(line)
  appendFileSync(this.file, `${JSON.stringify(line)}\n`)
  return line.seq
}
```

第二个参数 `op` 本课用不到——它默认 `'append'`，就是"这条记录追加到末尾"。下一课会用到它的另一种取值（`replace`），用它来压缩上下文。本课只关心 `appendFileSync` 那一行。

`appendFileSync` 只往文件末尾加字节。**没有任何代码路径会修改或删除已经写下的行。** 这不是懒，是设计：

- 追加写不会写坏文件——中途断电最多损失最后一行，前面的都完好
- 历史不可变，复盘时你看到的和当时发生的完全一致
- 想要"改"历史（比如压缩上下文），不是覆盖旧行，而是**追加一条新记录**说明"从这里开始用新版本"

harness 的 JSONL 后端（[packages/session/session-persistence-jsonl](../../../deepseek-harness/packages/session/session-persistence-jsonl)）还加了 zstd 压缩、分代文件名（`session.v4.jsonl`）和原子替换。分代的意思是：格式升级时**新起一个文件**，老文件原样留着。我们只保留 append-only 这个内核。

## 跑起来

```
=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。出门看情况带把伞。

=== 用户说：你好 ===
[模型回答] 我不知道怎么回答"你好"，但我可以查天气。

=== 从日志重放 ===
#1 [user/message] 北京天气怎么样？
#2 [tool/call] get_weather({"city":"北京"})
#3 [tool/result] 北京：晴，12°C
#4 [assistant/message] 北京：晴，12°C。出门看情况带把伞。
#5 [user/message] 你好
#6 [assistant/message] 我不知道怎么回答"你好"，但我可以查天气。
共 6 条记录
```

第一轮现在是**两圈**：模型决定调工具 → 执行 → 结果喂回模型 → 模型说人话。第 12 课缺的那半圈，本课补上了。注意工具结果是用 `messages: [{ role: 'user', content: String(result.value) }]` 喂回去的——harness 真身有专门的 `role: 'tool'` 消息和 `toolCallId` 关联，我们简化成一条 user 消息，能跑通 loop 就行。

磁盘上的 `.sessions/demo/session.jsonl`（前五行）：

```jsonl
{"type":"session","version":1}
{"seq":1,"time":1791793946476,"type":"user/message","data":{"content":"北京天气怎么样？"},"surfaceOp":"append"}
{"seq":2,"time":1791793946478,"type":"tool/call","data":{"callId":"call-1","name":"get_weather","arguments":"{\"city\":\"北京\"}"}}
{"seq":3,"time":1791793946479,"type":"tool/result","data":{"callId":"call-1","name":"get_weather","value":"北京：晴，12°C","isError":false},"surfaceOp":"append"}
{"seq":4,"time":1791793946481,"type":"assistant/message","data":{"text":"北京：晴，12°C。出门看情况带把伞。"},"surfaceOp":"append"}
```

注意三点。第一行是**头行**，只有 `type` 和 `version`，没有 `seq`——它不记录发生过什么，只说明"这个文件是什么格式的"（harness 真身在 `packages/session/session-persistence-jsonl/src/format.ts` 里也叫 `HeaderLine`）。`tool/call` 那行**没有** `surfaceOp` 字段（它不进模型可见历史），其余消息行都带着 `"surfaceOp":"append"`。这个字段是给下一课准备的，本课 `append()` 只写默认值。

## 恢复：接着昨天的写

`JsonlSession` 的构造函数里有一段：

```ts
if (existsSync(this.file)) {
  const existing = Session.load(this.file)
  this.records.push(...existing)
  this.seq = existing.at(-1)?.seq ?? 0
  this.restoredCount = existing.length
}
```

磁盘上有日志，就把它整份读进内存，`seq` 接着最后一行的往下数。**再跑一次同样的程序，你会看到 12 条记录**——前 6 条是上次的，后 6 条是这次的，`seq` 从 7 连续编到 12。历史一行没丢。

这就是"会话可以恢复"的最小实现。harness 的 resume 还复杂得多（要重建请求头、处理 fork 血缘），但内核就是这个：日志是事实，启动时先把事实读进来。`Session.load()` 现在还会核对第一行的格式版本，对不上直接抛错——**拒绝加载比猜着加载安全**。这一点下一课展开。

## 动手改一改

**实验一：故意漏记一条。** 把 `run()` 里 `user/message` 那行 `ctx.session.append(...)` 注释掉，再跑一次。重放时 `#1` 变成了 `[tool/call]`——**没有用户提问，工具却调用了**。日志一旦缺环，整个对话就讲不通。这就是为什么 harness 定下"模型可见 ⟺ 已记录"这条铁律：少记一条，比多记十条严重得多。

**实验二：让模型调用不存在的工具。** 把 `decide` 里的工具名改成 `get_weatherz`，跑一遍看 `tool/result` 里 `isError: true` 那条记录。失败也是历史的一部分——harness 真身的 `tool/result` 事件为此专门带了 `error?: { name, code, reason }` 字段，把失败的身份信息留在日志里。

## 小结

- session log 是一条 append-only 的 JSONL 文件，是 harness 的唯一事实来源
- `SessionLine` 用映射类型批量生成判别联合，`type` 和 `data` 的类型锁在一起
- `arguments` 存模型吐出的原始字符串，不存我们解析后的对象——日志记事实，不记解释
- 追加写不改旧行；格式升级靠新起分代文件，老文件原样保留
- 启动时读回日志、`seq` 接着往下编，就是"恢复会话"的最小内核
- **模型可见 ⟺ 已记录**：少记一条比多记十条严重

下一篇：[15 · 从日志折出模型看得见的历史](15-fold-messages/main.md)
