# 25 · 真正的压缩：让模型自己写摘要

> 源码：[main.ts](./main.ts) · [mock-provider.ts](./mock-provider.ts) · [llm.ts](./llm.ts) · [session.ts](./session.ts) · [token-meter.ts](./token-meter.ts)　配置：[cordis.yml](./cordis.yml)

上一课结尾，压缩已经会自动触发了：271 token 超了 256，`#1~#9` 自动被折掉，历史从 12 条降到 9 条。**该折的时候折、折哪一段、留多少**——三个决定全部交给了数字，不再是人手写。

但折完之后换上去的那句话，还是我们写死的：

```ts
function buildSummary(fromSeq: number, toSeq: number): string {
  return `（摘要）#${fromSeq}~#${toSeq} 被折掉了：用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。`
}
```

这句话只对本课的剧本成立。换一段真实对话——用户改了三次需求、模型试了五种方案、其中一个失败了——它就什么都不知道了。**写死的摘要只能概括写死的剧本。**

本课把它换成一次真实的模型请求。

**先记住本课最重要的一句话：摘要不是我们替模型写的笔录，而是模型自己做的一次压缩。**

## 摘要也是一次请求

真身 [summarizer.ts](../../../deepseek-harness/packages/compaction/compaction-basic/src/summarizer.ts) 的思路很直接：**把要被折掉的那段对话重新发给模型，让它自己写一份"能接着干"的摘要。**

于是 `compactIfNeeded()` 里那句写死的调用，换成：

```ts
const summary = await summarize(from.seq, to.seq)
compact(from.seq, to.seq, summary)
```

而 `summarize()` 做的事，和主循环的 `run()` 是同一种事：

```ts
async function summarize(fromSeq: number, toSeq: number): Promise<string> {
  const replayed = ctx.session.list()
    .filter((line) => line.seq >= fromSeq && line.seq <= toSeq && line.surfaceOp !== undefined)
    .map(toMessage)

  const options: GenerateOptions = {
    messages: [
      ...replayed,
      { role: 'user', content: COMPACTION_INSTRUCTION },
    ],
    maxTokens: SUMMARY_MAX_TOKENS,
    purpose: 'compaction',
  }

  console.log('\n=== 摘要请求：让模型自己写 ===')
  const turn = await stream(ctx, options)
  if (turn.kind !== 'text') {
    throw new Error('摘要请求返回了工具调用——摘要只能是一段文字')
  }

  const summary = extractSummary(turn.text)
  if (summary.length === 0) {
    throw new Error('摘要为空：模型没有在 <summary> 标签里给出内容')
  }
  return summary
}
```

三件事值得停下来看。

**第一，它走的是同一个 `stream()`。** 不是另一套协议、另一条管子，就是第 22 课那个流式循环：`block-start`、`text-delta`、`block-end`、`finish`。摘要请求要过流式协议、要拼装、要判 finish——**和主对话那次请求用的是同一条管子，一个字都没改。**

这就是"模型可见 ⟺ 可记录"那条规矩的代价，也是它的好处：摘要的产出过程天然就在日志里，因为它本来就得过一次 loop。

**第二，重放的是日志行，不是 `deriveMessages()` 的产物。** `deriveMessages()` 折的是"当前模型看得见的历史"，而 `#1~#9` 可能已经被之前的 replace 动过。我们要折的是**它们当前的样子**，所以直接 `list()` 出来自己筛。

**第三，这次请求不过压力阈值。** 阈值检查是为了避免无限压缩——压完还超、再压、再超。而摘要请求只发一次、发完就完了，没有"递归摘要"的问题。

### 压缩指令是消息，不是 system prompt

真身把 `COMPACTION_INSTRUCTION` 作为**最后一条 user 消息**追加在被折历史后面，而不是单独开一个 system prompt：

```ts
const COMPACTION_INSTRUCTION = [
  'You are a compaction engine. Condense the conversation ABOVE into a checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the structure below, and wrap it in <summary> ... </summary> tags:',
  '',
  '## Primary Request and Intent',
  '- [用户最初的目标，以及它有没有变过]',
  '',
  '## Current Work',
  '- [此刻进行到哪一步，最近一次交互是什么]',
  '',
  '## Next Step',
  '- [接下来该做的那一件事]',
  '',
  'Rules: 用中文写要点，不要写段落。保留确切的文件路径、命令、错误字符串和数字。不要提"这是一次压缩"，也不要调用任何工具。',
].join('\n')
```

为什么不当 system prompt？因为**system prompt 在最前面**。把它放最前，等于把一大段指令插在被折历史和"请摘要"之间，provider 的 KV cache 前缀就断了——每一轮重放，缓存全部作废。

追加成最后一条 user 消息，前面那段历史纹丝不动，**缓存照旧命中**。

### 七段式模板，教学版缩成四段

真身的指令是一份七段式 Markdown 模板：Primary Request and Intent / Key Technical Concepts / Files and Code / Errors and Fixes / Pending Jobs / Current Work / Next Step / Critical Context。

教学版缩成四段。**缩的是数量，不是那个决定——结构本身才是重点。**

不分段的指令会得到什么？一段流水账。而流水账里"用户最初要什么"和"刚才在试什么"是混在一起的，下一轮模型读到它，分不清哪句还能信。

分段逼模型**分门别类地回忆**。它写不出"Files and Code"那一节，就会意识到自己不知道改了哪些文件——这个"意识到"比摘要本身更值钱。

## 为什么要一个开闭标签

模型的输出不保证干净。它可能在摘要前客套两句（"好的，我来为您总结："），也可能在后面补一句"如需帮助请告诉我"。

这些字进了摘要，就是历史里的一颗钉子——**下一轮模型会把它当成事实的一部分读。**

所以真身用 `<compacted-summary>` 开闭标签，教学版用 `<summary>`，然后只取标签里的正文：

```ts
function extractSummary(text: string): string {
  const open = text.indexOf(SUMMARY_OPEN_TAG)
  const close = text.indexOf(SUMMARY_CLOSE_TAG)
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`摘要缺少闭合的 ${SUMMARY_OPEN_TAG} 标签：${text}`)
  }
  return text.slice(open + SUMMARY_OPEN_TAG.length, close).trim()
}
```

**标签没闭合就抛错，不做宽容兜底。** 兜底（比如"没有闭标签就取开标签之后的全部内容"）看起来更稳健，实际上会把客套话、复述的指令、模型的自言自语一起塞进摘要——那正是标签要防的东西。

真身在这里还有一层 `CHECKPOINT_PREAMBLE`：把抽出来的摘要包成"已成事实的背景"，再加一句"不要复述、不要承认这次压缩"。教学版只保留抽标签这一步。

## 假模型怎么写摘要

真模型靠指令里的七段式模板学会分门别类。我们没法训练，就用 if 把同样的结构写死在 [mock-provider.ts](./mock-provider.ts)：

```ts
function buildSummary(messages: readonly { readonly role: string; readonly content: string }[]): string {
  const history = messages.slice(0, -1)
  const asked = history.filter((message) => message.role === 'user').map((message) => message.content)
  const results = history.filter((message) => message.role === 'tool').map((message) => message.content)
  const failed = results.filter((result) => result.includes('必填项'))
  ...
}
```

**重点不在这段拼字符串的逻辑，而在它输出的形状和真模型一模一样**：开标签、Markdown 小节、闭标签。消费方的 `extractSummary()` 感知不到差别。

注意它读的是**整个 messages**（含最后那条压缩指令），不是最后一句。摘要的内容必须来自被折掉的那段对话——**这是"压缩"和"瞎编"的分界线**。

`decide()` 里认它的那行，必须放在最前面：

```ts
export function decide(options: GenerateOptions): StreamChunk[] {
  const input = options.messages.at(-1)?.content ?? ''
  // 摘要请求：最后一条是压缩指令。先认它——指令里也可能出现
  // "天气""算"这些词，被下面的分支截走就永远拿不到摘要了。
  if (input.includes('compaction engine')) {
    return textResponse(buildSummary(options.messages))
  }
  ...
}
```

压缩指令里写着"Condense the conversation ABOVE"——它自己就带"天气""算"这些词。放在下面任何分支之后，都会被截走。

## 账单要分得开：`purpose`

摘要请求和主对话请求走同一根管子，但**账单上要分得开**。真身在 [llm.ts](./llm.ts) 的 `GenerateOptions` 上加了一个字段：

```ts
export interface GenerateOptions {
  messages: ChatMessage[]
  maxTokens?: number
  signal?: AbortSignal
  /**
   * 这次请求是干什么的。
   *
   * 真身 `GenerateOptions.purpose`：主对话是 `'generate'`，压缩摘要是
   * `'compaction'`。同一根管子、同一套协议，但**账单上要分得开**——
   * 否则一次压缩花的 token 会混进主对话，事后说不清是谁花的。
   */
  purpose?: 'generate' | 'compaction'
}
```

还有 `maxTokens: SUMMARY_MAX_TOKENS`：

```ts
/**
 * 摘要请求自己的输出上限，token。
 *
 * 真身 compaction-basic 的 `summarizationMaxTokens`。注意它是
 * **单独一项配置**，不跟着主请求的 maxTokens 走——摘要要的是
 * "够用就好"，写长了反而压不下预算。
 */
const SUMMARY_MAX_TOKENS = 128
```

摘要要"够用就好"。给它和主对话一样大的输出额度，它会把七段全写满——那样折完比不折还贵。

## 跑一遍

`rm -rf .sessions && node --import tsx/esm ../../../launcher.ts`，第一遍和上一课逐字一致：三轮 163 / 197 / 246，12 条日志。摘要代码一次都没被碰到——**没超阈值，就没有摘要请求。**

不删 `.sessions` 再跑一遍。恢复 12 条历史，第四轮"刚才我问了什么？"一开口，271 超了 256：

```
=== 用户说：刚才我问了什么？ ===

[预算告急] 历史 ≈ 271 token 超过阈值 256，折掉 #1~#9，保留最近 46 token

=== 摘要请求：让模型自己写 ===
[模型回答] <summary>
## Primary Request and Intent
- 用户问了：北京天气怎么样？
- 用户问了：帮我算 7*6
## Current Work
- 工具返回：北京：晴，12°C
- 工具返回：invalid arguments: $.op 是必填项，但没有提供
- 工具返回：7 * 6 = 42
- 一次 calc 调用漏了 op 参数，被校验器拦下，补上后成功
## Next Step
- 回答用户"刚才我问了什么"，依据上面的摘要
</summary>

=== 压缩：#1~#9 折成一条摘要 ===
摘要落成 #14，它顶掉了 #1~#9
[预算] 折完降到 ≈ 263 token，省了约 8
[预算] 本次请求 ≈ 263 token（消息 110 + 工具清单 153，窗口 320，阈值 256）
[模型回答] 你问了我北京天气、让我算 7*6，还打了个招呼。
```

`<summary>` 标签一个字不差地闭合了，`extractSummary()` 抽出正文，`#14` 顶掉 `#1~#9`。日志全量：

```
#13 [user/message] 刚才我问了什么？
#14 [assistant/message] ## Primary Request and Intent
- 用户问了：北京天气怎么样？
...
## Next Step
- 回答用户"刚才我问了什么"，依据上面的摘要　← replace #1~#9
#15 [assistant/message] 你问了我北京天气、让我算 7*6，还打了个招呼。
```

最后那行是**本课真正的验收**：模型答"你问了我北京天气、让我算 7*6，还打了个招呼"。`#1~#9` 已经被 replace 顶掉了，它看不见原始记录——**它答得出来，只因为它在摘要里读过。**

把摘要请求的输出单独看一眼，有一处比上一课的写死版本强得多：

```
- 工具返回：invalid arguments: $.op 是必填项，但没有提供
- 一次 calc 调用漏了 op 参数，被校验器拦下，补上后成功
```

**失败本身被记住了。** 上一课那句写死的摘要完全没提 `#7` 的失败。而"模型漏了 op、被拦下、补上后成功"这件事，对下一轮判断该不该继续用 calc 是有用的——它是唯一一条关于工具怎么用才对的记录。

### 省了 8 个 token

注意这一行：`[预算] 折完降到 ≈ 263 token，省了约 8`。

上一课同样的路径省了约 50。为什么少了这么多？因为**摘要长了**。写死的摘要是一句话；模型写的是四段 Markdown，还带着所有工具返回值的原文。

这正是真身 `region.ts:417-420` 那道闸要防的事：

```ts
const framedSummaryTokenCount = dependencies.meter.estimateMessage(checkpointMessage)
if (framedSummaryTokenCount >= prepared.shadowedRouteTokenCount) {
  throw new Error(
    `summary is not smaller than the shadowed content (${framedSummaryTokenCount} estimated framed tokens >= ${prepared.shadowedRouteTokenCount})`,
  )
}
```

**压缩是为了省 token，越压越贵就是逻辑错误。** 本课的"省了约 8"还没越界，但它已经贴着脸在提醒：摘要不是越长越安全。真身会在这一步直接抛错，教学版只把数字打给你看。

## 动手改一改

**实验一：把 `SUMMARY_MAX_TOKENS` 改成 1024。** 跑第二遍。

摘要请求这次拿到的额度大得多，但假模型的 `buildSummary()` 不看这个参数——输出一模一样。这是教学版和真身的一处诚实差距：**我们没有真的模型，改这个数看不到内容变化。** 但它提醒你一件事：真身上这个数是**单独一项配置**，它决定摘要的详细程度，也就决定了压缩到底是省还是亏。

**实验二：删掉 `decide()` 里 `compaction engine` 那一行。** 跑第二遍。

摘要请求发出去，最后一条是压缩指令——里面有"condense""conversation"这些词，还有"天气"（被折历史里带着）。分支往下走，`input.includes('天气')` 命中，模型返回 `toolCallResponse('call-2', 'get_weather', ...)`。

然后 `summarize()` 第一道校验炸：

```
摘要请求返回了工具调用——摘要只能是一段文字
```

**这一课最该记住的事故形态：摘要请求发出去，回来的却是工具调用。** 真实模型也会这样——它看见一堆对话，本能地想去查天气。而摘要不能是工具调用，因为**摘要要在模型请求里占一条 assistant 消息**，工具调用占不了这个位置。

**实验三：把 `extractSummary()` 的 `open === -1` 改成宽容兜底。** 比如：没有开标签就取全文。跑一遍。

什么都没变——因为假模型总是规规矩矩闭合标签。**宽容兜底的代价，只有模型不规矩的那天才看得见。** 到那天，兜底会把客套话、复述的指令一起塞进历史，而你根本不知道是哪一轮开始的。

这就是"不做宽容兜底"的意思：**宁可炸，不要脏。**

## 对照真身

**摘要的包装。** 真身抽出标签后还有一层 `CHECKPOINT_PREAMBLE`——把摘要包成"已成事实的背景"，附一句"这是之前工作的摘要，不要向用户提起这次压缩"。目的是让下一轮模型**不承认压缩发生过**：用户不会想听到"根据我的摘要，你之前问过……"，他想听到答案。

教学版跳过了这一层，所以我们的模型会老实地说"你问了我北京天气、让我算 7*6，还打了个招呼"——听起来确实像在读小抄。真身那层 preamble 治的就是这个。

**只留 text。** 真身 [summarizer.ts](../../../deepseek-harness/packages/compaction/compaction-basic/src/summarizer.ts) 的 `summaryText()` 只从响应块里取 text，看见图片直接抛 `UNSUPPORTED_CONTENT`——摘要里塞不下一张图，硬塞就是个坏块。

**半截摘要比没有更危险。** 真身的 `finishError()` 把 `max-tokens` 映射成 `MAX_TOKENS` 错误。我们的 `SUMMARY_MAX_TOKENS = 128` 就是那条线：写超了，摘要断在某一节中间，`extractSummary()` 找不到闭标签，抛错。

这不是过度谨慎。**一段断在"## Current Work"中间的 Markdown，比一句"（摘要）#1~#9 被折掉了"危险得多**——它读起来像个完整的摘要，只是少了一节。

**审计。** 真身的 `SummaryResult` 是个判别联合：

```ts
type SummaryResult =
  | { llmStreamCall: true; ... }
  | { llmStreamCall: never; ... }
```

`llmStreamCall: true` 标识"恰好一次通过本 context 的 `ctx.llm.stream()`"，否则 `never`。为的是**事后审计那次调用**——压缩花了多少 token、什么时候花的、触发了哪段历史，事后必须说得清。教学版只把 `purpose: 'compaction'` 带在请求上，同样的目的，轻得多的实现。

**区间锁。** 真身的摘要生成包在 `compaction/start` / `compaction/end` 之间，中间夹 `assertSelectedSpanStable`（选中的区间没被别人动过）和 `assertWholeSurfaceUnchanged`（区间外的行一个都没变）。摘要要跑几百毫秒到几秒，这段时间里完全可能有别的轮次往日志里追加东西——**不锁，折的就不是当初选中的那段了。**

教学版的 `agent/compact-begin` / `agent/compact-end` 两条事件已经声明在 [main.ts](./main.ts) 的事件表里（第 12~15 行），但还没接线。因为教学版的剧本是串行的——`run()` 一个一个 await，没有并发轮次，锁用不上。**它在那儿，是为了让你看见真身为什么需要它。**

## 小结

- **摘要不是我们替模型写的笔录，而是模型自己做的一次压缩**：写死的 `buildSummary()` 换成一次真实的 `stream()`
- 摘要请求走同一条管子：过流式协议、要拼装、要判 finish——和主对话那次请求一字不差
- 重放的是**日志行**（它们当前的样子），不是 `deriveMessages()` 的产物
- 压缩指令是**最后一条 user 消息**，不是 system prompt：不挡 KV cache 的前缀
- 七段式模板缩成四段，**结构才是重点**：分段逼模型分门别类地回忆
- 开闭标签 + 抛错，**不做宽容兜底**：兜底会把客套话一起塞进历史
- `purpose: 'compaction'` 和独立的 `maxTokens`：同一根管子，账单分得开
- 摘要必须小于被折内容——真身 `region.ts` 直接抛错，教学版把"省了约 8"打给你看
- 失败本身会被记住，这是模型摘要比写死摘要强的地方

下一篇：26 · Session 生命周期
