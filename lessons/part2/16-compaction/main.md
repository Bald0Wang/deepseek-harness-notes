# 16 · 压缩：让历史变短，日志不变

> 源码：[session.ts](./session.ts) · [llm.ts](./llm.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [json-schema.ts](./json-schema.ts) · [provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 15 课做完，模型终于"记得"前面聊过什么了。但新的问题立刻浮出来：**历史只会越来越长。**

跑一遍输出，注意每轮开头那行 `[run()] 本次请求 N 条消息`：

```
=== 用户说：北京天气怎么样？ ===
[run()] 本次请求 1 条消息
...
=== 用户说：你好 ===
[run()] 本次请求 4 条消息
```

第一轮请求里 1 条，第二轮 4 条。不是模型变啰嗦了，是**每一次请求都把整段历史重新带一遍**。聊到第 100 轮，第 100 次请求就带着前面 99 轮的全部内容出门。

我们的 mock 不烧钱，你感觉不到疼。真模型是按 token 计费的，而且每个模型都有上下文窗口上限——**请求超过窗口，直接报错，不是变慢，是根本不给你跑**。

本课处理这件事。

## 一条命令的两个对象

先厘清第 15 课留下的两个东西，它们的命运在本课开始分岔：

| | 日志（session log） | 模型请求（messages） |
|---|---|---|
| 怎么来的 | 每发生一件事 `append` 一条 | 每次请求前 `deriveMessages()` 现算 |
| 长度 | **只增不减** | **可以变短** |
| 谁说了算 | 历史本身 | 压缩策略 |
| 能不能改 | 永不改写已写的行 | 每次重新折，随便折 |

压缩只动右边。左边的日志，从第一个字到最后一个字，一行不改。

## 压缩就是 append 一条 replace

[main.ts](./main.ts) 里触发压缩的只有一行：

```ts
setTimeout(() => ctx.emit('agent/compact', 1, 6, '（摘要）用户问了北京天气……'), 200)
```

处理器 `compact()` 的关键是它调用的方法名：

```ts
const seq = ctx.session.append(
  { type: 'assistant/message', data: { text: summary } },
  { op: 'replace', startSeq: fromSeq, endSeq: toSeq },
)
```

**`append`。不是 delete，不是 update。** 往日志末尾加了一条 `#7`，然后告诉系统"这条顶掉 `#1` 到 `#6`"。

跑一遍，看这三行输出：

```
=== 压缩：#1~#6 折成一条摘要 ===
摘要落成 #7，它顶掉了 #1~#6
模型历史从 4 条变成 1 条
```

日志多了一条，模型历史少了一批。**两个数字朝相反方向走**，这就是压缩的全部机理。

## 被顶掉的行去哪了

回看 `replay()` 打出的两段：

```
=== 日志全量（9 条）===
#1 [user/message] 北京天气怎么样？
#2 [tool/call] get_weather({"city":"北京"})
#3 [tool/result] 北京：晴，12°C
#4 [assistant/message] 北京：晴，12°C。出门看情况带把伞。
#5 [user/message] 你好
#6 [assistant/message] 我不知道怎么回答"你好"，但我可以查天气。
#7 [assistant/message] （摘要）用户问了北京天气……　← replace #1~#6
#8 [user/message] 刚才我问了什么？
#9 [assistant/message] 我只记得一份摘要：你问了北京天气，别的细节被压掉了。

=== 模型看到的历史（折叠后 3 条）===
[assistant] （摘要）用户问了北京天气，模型调了 get_weather 拿到"北京：晴，12°C"，并提醒出门看情况带伞。
[user] 刚才我问了什么？
[assistant] 我只记得一份摘要：你问了北京天气，别的细节被压掉了。
```

日志 9 条，模型看得见 3 条。`#1~#6` 那六行**一条没少，还在文件里**，`#7` 后面清清楚楚标着 `← replace #1~#6`。它们只是从此不进模型请求。

这就是 harness 处理上下文爆炸的核心决定：

> **模型看得见的历史可以很短，日志永远完整。**

想要复盘"压缩前模型到底传了什么参数、工具回了什么"，翻日志，全在。模型只需要一份摘要，够它接着聊就行。两边的需求都满足了，且没有任何一行数据被毁掉。

harness 真身在 [packages/core/session/src/surface.ts](../../../deepseek-harness/packages/core/session/src/surface.ts) 里有句注释，说的是同一件事：

> The model-visible surface deliberately shadows replaced ranges, so it is the wrong source for a human transcript.

翻译：**模型看得见的那块，故意遮住了被替换掉的范围，所以拿它当人类看的对话记录是错的。**

## 模型的态度变了

压缩生效后，模型回答"刚才我问了什么"的措辞变了：

```
[模型回答] 我只记得一份摘要：你问了北京天气，别的细节被压掉了。
```

对比第 15 课同一位用户的同一个问题，那时它答的是"你问了我北京天气，我查完还提醒了你带伞"——因为它看得见 `tool/result` 里那句"北京：晴，12°C"。

现在它只看得见摘要。摘要里写了"拿到 12°C"，它就知道 12°C；摘要里没写"提醒带伞"，它就想不起这回事。

**这就是压缩的代价：精度换空间。** 摘要写多细，模型就记得多清楚。harness 的 compaction 插件（[packages/compaction](../../../deepseek-harness/packages/compaction)）用真模型来生成这份摘要，还会保留最近几轮不压——压太狠会把刚发生的事也糊掉。

我们的 mock 里这段判断写得很直白：

```ts
const sawRaw = history.some((message) => message.role === 'tool')
if (sawRaw) return textResponse('你没有历史记忆，每次请求只带当前这一句。')
const summary = history.find((message) => message.content.startsWith('（摘要）'))
if (summary) return textResponse('我只记得一份摘要：你问了北京天气，别的细节被压掉了。')
```

**看得见原始返回**和**只看得见摘要**，是两种不同的记忆状态，模型自己知道差别。

## 什么时候该压

本课的压缩是手动触发的——`setTimeout` 到点 emit 一下。真实系统里没人有空盯着，得让程序自己判断。判断依据只有一个：**请求有多长。**

harness 的做法是把长度做成配置项，超了就自动压。可以去看 [packages/compaction/compaction-basic/src/config.ts](../../../deepseek-harness/packages/compaction/compaction-basic/src/config.ts)，里面就是一组阈值：历史占窗口多少比例时开始压、压到多少停手、最近几条永远不压。

我们课里没有这套自动逻辑，但 `measure()` 那个函数留了位置——它就是"长度监控"的最小形态：

```ts
function measure(where: string, count: number) {
  before = Math.max(before, count)
  console.log(`[${where}] 本次请求 ${count} 条消息`)
}
```

真系统里，这个 `count` 换成 token 数，`console.log` 换成"触发 compaction 插件"。

## 动手改一改

**实验一：把压缩范围写错。** 把 `agent/compact` 的 `fromSeq` 从 1 改成 3，跑一遍。折叠时 `findIndex` 在模型历史里找不到 `#1`，`start === -1`，那一轮直接 `continue`——摘要照样落成，但什么都没顶掉，模型历史还是 4 条。**折叠不上的时候选择跳过，不是崩掉**：宁可多看一点，不能少看。

**实验二：压缩两次。** 在 `replay()` 之前再 emit 一次 `agent/compact`，这次顶掉 `#7~#9`。日志变成 12 条，模型看得见的只剩 1 条摘要。这就是长对话的样子——**日志线性增长，模型上下文反复折叠**。

**实验三：把摘要写得更细。** 改 `agent/compact` 的 summary 文本，加上"我提醒了出门带伞"，再跑一遍。模型的回答会跟着变。摘要的**详细程度就是压缩的唯一旋钮**——写多少，模型就记住多少。

## 小结

- 历史只增不减，请求却每次重带全量——长度必然撞墙，压缩是必需品不是优化项
- 压缩 = `append` 一条带 `replace` 标记的记录，**日志一行不少，只是不再进请求**
- 日志给人复盘，请求给模型用，两者的长度从此走上不同方向
- 压缩的代价是精度：摘要写多细，模型记得多清楚；harness 用真模型生成摘要并保留最近几轮
- 触发压缩看的是长度；`measure()` 就是长度监控的最小形态

下一篇：[17 · 断线重连：从磁盘恢复一个会话](17-resume-session/main.md)
