# 24 · 上下文预算：每一次 `deriveMessages()` 都是一次花钱的决定

> 源码：[main.ts](./main.ts) · [token-meter.ts](./token-meter.ts) · [session.ts](./session.ts) · [mock-provider.ts](./mock-provider.ts)　配置：[cordis.yml](./cordis.yml)

先看上一课跑完时打出来的一段：

```
[预算] 本次请求 ≈ 163 token（消息 10 + 工具清单 153，窗口 320，阈值 256）
[预算] 本次请求 ≈ 197 token（消息 44 + 工具清单 153，窗口 320，阈值 256）
[预算] 本次请求 ≈ 246 token（消息 93 + 工具清单 153，窗口 320，阈值 256）
```

这些数字不是上一课打出来的——上一课根本没有"预算"这个概念。它们是本课新加的。

而且注意第三行：246，离阈值 256 只差 10。第四轮再开口，就会越界。**越界之后呢？** 上一课的答案是什么都不做：`deriveMessages()` 原样返回全部历史，模型该拒收就拒收，该截断就截断——我们连它为什么拒收都不知道。

本课补上这个"之后"。

**先记住本课最重要的一句话：不是所有日志都进请求——每一次 `deriveMessages()` 都是一次花钱的决定。**

## 为什么"日志只增不减"和"窗口有限"必须一起看

第 12 课立下一条规矩：日志 append-only，写出去的行永不改写。第 23 课的结尾把它推到了极致——恢复路径越走越长，日志从 11 条涨到 13 条。

这条规矩是对的，但它有个代价一直没人付：**日志会一直长下去，而模型的窗口不会。**

`deriveMessages()` 每次被调用，都把整个可见历史折成请求发出去。日志 100 条，请求就带 100 条；1000 条，就带 1000 条。日志是诚实的，请求是诚实的，**但模型那头是有上限的**——真身里这个上限由 adapter 声明（`ctx.llm.resolveModelInfo().context.contextWindow`），DeepSeek 是 128k，GPT 是 128k，小模型可能只有 4k。

所以"诚实"本身成了问题：一个只会照单全收的 loop，迟早会把窗口塞爆。

两种死法都很难看：

- **被拒**。provider 直接返回 `CONTEXT_WINDOW_EXCEEDED`，这一轮作废。日志里多一行失败，对话里什么都没有——和上一课"失败没回到对话里"是同一种丑陋。
- **被截断**。有些 provider 不报错，悄悄砍掉开头的消息。你以为是"模型忘了"，其实是"你的请求被削过"。

所以本课的判断很朴素：**与其让模型拒绝，不如自己先决定带什么。**

而"自己先决定"的前提，是知道自己带了什么。于是有了 [token-meter.ts](./token-meter.ts)。

## 算账：一次请求到底有多贵

新建一个插件，一个方法就够——把一次请求折算成 token：

```ts
// token-meter.ts
export class FixedTokenMeter extends TokenMeter {
  estimateMessage(message: ChatMessage): number {
    return Math.ceil(message.content.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD + ROLE_OVERHEAD
  }

  measure(messages, toolsTokens = 0, systemTokens = 0): ContextBudget { ... }
}
```

三个常数照抄真身 [packages/llm/token-meter/src/estimate.ts](../../../deepseek-harness/packages/llm/token-meter/src/estimate.ts)：

```ts
const CHARS_PER_TOKEN = 4    // 固定密度启发式
const BLOCK_OVERHEAD = 4     // 每个内容块的 JSON 框架
const ROLE_OVERHEAD = 4      // 每条消息的 role 字段
```

**4 字符 1 token。** 这是个已知会低估的近似——中文和 JSON Schema 在这个密度下能差一倍以上，真身 README 的 Dev Note 自己承认。教学版照抄，因为它带来的偏差本身就是本课要讨论的话题（见下面"对照真身"）。

它是个**无状态**服务：每次 `measure()` 都重算一遍。真身为此有一套 replay fold、shadow price、provider anchor——为的是"同一个 session 的任何消费者读到同一个数"。教学版的消费者只有 main.ts 一个，重算就够。

### 工具清单是最容易忘的一块

第一次跑，输出里有一行值得停下来看：

```
[预算] 本次请求 ≈ 163 token（消息 10 + 工具清单 153，窗口 320，阈值 256）
```

第一轮对话，用户只说了一句"北京天气怎么样？"——消息部分 10 个 token。可总账是 163。**差出来的 153 全在工具清单上。**

`ctx.tools.schemas()` 序列化后的 JSON Schema，两个工具就吃掉 153 token，而它们**每一轮都在、一个字都不变**。真实 harness 里这个数字更吓人：十几个工具的 schema 动辄几千 token，占 128k 窗口的百分之几——不多，但它是**每轮都要重付的固定成本**。

```ts
/** 工具清单占多少 token。它每一轮都一样，但每一轮都要重新付。 */
function toolsTokens(): number {
  const schemas = JSON.stringify(ctx.tools.schemas())
  return schemas.length === 0 ? 0 : Math.ceil(schemas.length / 4) + 4
}
```

注意最后那个 `+ 4`——它是 `estimateToolsTokens` 里的 `BLOCK_OVERHEAD`，工具清单在请求信封里也是一个内容块。

### 系统提示为什么是 0

`measure()` 的第三个参数是 `systemTokens`，本课恒传 0。原因在 [session.ts](./session.ts)：教学版的 `ChatMessage` 只有 `user`/`assistant`/`tool` 三种角色，`deriveMessages()` 从不产出 system 消息——第 16 课那个可改写的提示词还在 later part 的清单上。

真身在这里有条岔路：[estimate.ts](../../../deepseek-harness/packages/llm/token-meter/src/estimate.ts) 给 system 消息**免掉 BLOCK_OVERHEAD**，因为 adapter 把它序列化成一个纯字符串字段，不是带 type 标签的内容块。教学版走不到这条岔路，`estimateMessage()` 里只剩一条路——岔路本身留在 [token-meter.ts](./token-meter.ts) 的 JSDoc 里。

## 预算的三段公式

有了账本，就能定规矩。真身 [compaction-basic/src/config.ts](../../../deepseek-harness/packages/compaction/compaction-basic/src/config.ts) 的 `resolveCompactSpec()`，教学版折成三个常量：

```ts
const CONTEXT_WINDOW = 320      // 模型窗口
const THRESHOLD_RATIO = 0.8     // 压力阈值比例
const RETAIN_TOKENS = 40        // 压缩时保留的尾部
```

对应的三道算式：

```
thresholdTokens = floor(contextWindow × thresholdRatio)   // 320 × 0.8 = 256
```

**为什么不是塞满才动手？** 因为 `thresholdRatio` 默认 0.8——不等到 320，256 就报警。留出来的 20% 是给回答和抖动的：模型写一句回复要占输出额度，估算是近似值，压线触发等于拿误差赌博。真身还更细一档，从窗口里先扣掉 `reservedCompletionTokens`（留给回答的那份）再算阈值；教学版把这一步并进了 0.8。

`RETAIN_TOKENS` 是**保底线**：压缩时原样留下最近这么多 token。为什么必须留？因为最近几句几乎必然和当前这轮有关，折成摘要反而丢细节。真身按 `retainRatio`（默认 0.16）折算，窗口的 16%。

### 320 这个数字是摆出来的，不是算出来的

真身里 `contextWindow` 是 adapter 声明的能力。教学版的假模型没有这个字段，于是摆一个常量——**关键是它是配置，不是算式里的魔法数。**

这里摆 320 而不是 131072，是因为本课的剧本只有四轮：按真实窗口算，四轮加起来不到 300 token，压不了一次，"预算告急"这条路在输出里根本看不见。缩小 400 倍，阈值 256 正好落在第四轮头上（前三轮 163 / 197 / 246）。

这是本课唯一一处为了"看得见"而调的数字。它不是近似，是**舞台缩放**。

## 预算驱动的自动压缩

核心在 `compactIfNeeded()`。上一课压缩靠一句手写的 `compact(1, 12, '（摘要）…')`——**人肉决定什么时候折、折哪一段**。本课换成：量一下，超阈值就自动选一段折掉。

```ts
async function compactIfNeeded(options: GenerateOptions) {
  // 口径和 measureRequest 完全一致：含工具清单。
  const budget = ctx.tokenMeter.measure(options.messages, toolsTokens())
  if (budget.totalTokens < thresholdTokens()) return

  const lines = ctx.session.list()
  // 只考虑"进过请求"的行——notice 旁白和 tool/call 从没进过，
  // 折它们没有意义，而且 endSeq 会落空。
  const surface = lines.filter((line) => line.surfaceOp !== undefined)

  // 从尾部往前累加，保留最近 retainTokens 个 token。
  let accumulated = 0
  let keepFromIdx = surface.length
  for (let index = surface.length - 1; index >= 0; index -= 1) {
    const line = surface[index]
    if (line === undefined) break
    accumulated += ctx.tokenMeter.estimateMessage(toMessage(line))
    keepFromIdx = index
    if (accumulated >= RETAIN_TOKENS) break
  }

  // 红线一：保留的部分已经顶到开头，没什么可折的
  if (keepFromIdx <= 1) return

  const from = surface[0]
  const to = surface[keepFromIdx - 1]
  if (from === undefined || to === undefined) return

  console.log(...)
  compact(from.seq, to.seq, buildSummary(from.seq, to.seq))
}
```

四条规则，照抄真身 [selectCompactableRange](../../../deepseek-harness/packages/compaction/compaction-basic/src/region.ts)：

1. **从尾部往前累加，够 `RETAIN_TOKENS` 就停。** 最近的对话原样留着。
2. **从 `#1` 起折。** 真身的 surface 节点 0 是系统提示，`firstIdx` 恒为 1——系统提示永不进压缩区间。教学版没有系统提示，但这条边界留着：真要加，它必须是第一条。
3. **只折进过请求的行。** `surfaceOp !== undefined` 这个过滤器把 `notice/message`（旁白）和 `tool/call` 排在外面。折它们不止没意义——`compact()` 的 `endSeq` 会在 `deriveMessages()` 里找不到落点，压缩被静默跳过。
4. **红线一：保不住就整个收手。** `keepFromIdx <= 1` 说明连最近的几句都保不住，此时折掉一切等于清空历史，比不折更糟。

注意 `compactIfNeeded` 里那个 `toMessage(line)`——它把日志行翻译成计价器认识的 `ChatMessage`。第 23 课的 `deriveMessages()` 已经做了同一件事（`toChatMessage`），但那是为了**产出请求**；这里是为了**估价**。两处翻译，同一套数据，这就是"同源"的意思。

### 摘要还是写死的

`buildSummary()` 返回一句固定的话：

```ts
function buildSummary(fromSeq: number, toSeq: number): string {
  return `（摘要）#${fromSeq}~#${toSeq} 被折掉了：用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。`
}
```

**这句话写死了。** 让模型自己写摘要是第 25 课的主题，真身 [summarizer.ts](../../../deepseek-harness/packages/compaction/compaction-basic/src/summarizer.ts) 用七段式 Markdown 指令 + checkpoint preamble 逼模型产出结构化摘要。

但本课的要点不在这句话的内容，而在**触发它的那个数字是算出来的**：什么时候折、折哪一段，已经从"人写 `compact(1, 12, …)`"变成了"超了 256 就折 #1~#9"。

### 顺序：先折、再量、后问

`run()` 里的三行值得背下来：

```ts
const options: GenerateOptions = { messages: ctx.session.deriveMessages() }
await compactIfNeeded(options)
measureRequest(options)
const turn = await stream(ctx, options)
```

**预算永远基于这一轮真正要发出去的那个 `messages`。** 所以 `deriveMessages()` 在最前，`compactIfNeeded()` 会原地改写 `options.messages`（它收到的是引用），`measureRequest()` 量的是折完之后的结果，最后才 `stream()`。

顺序错了会怎样？先量再折，屏幕上打一个数、实际发另一个数——账本和现实脱钩，比没有账本更糟。

同样的三行在 `executeTool()` 里出现了两次：工具成功后的追问、失败后的恢复追问。**模型每被问一次，就是一次请求**——这一课起，每一次追问都过预算。

### 一处口径修正

`compactIfNeeded()` 里的 `measure()` 带 `toolsTokens()`，和 `measureRequest()` 完全一致。这不是废话：真身 token-meter 的 `totalTokens = estimateToolsTokens(header) + surfaceTokens`——**工具清单是请求的一部分，压不掉也得算钱。**

如果预算只数消息、账单只数消息，那"工具清单 153 token 接近窗口一半"这件事就永远看不见。而它恰恰是最该被看见的：那是**每轮都要重付、且压不掉**的成本。

## 跑一遍

`rm -rf .sessions && node --import tsx/esm ../../../launcher.ts`：

```
=== 用户说：北京天气怎么样？ ===
[预算] 本次请求 ≈ 163 token（消息 10 + 工具清单 153，窗口 320，阈值 256）

[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。出门看情况带把伞。

=== 用户说：帮我算 7*6 ===
[预算] 本次请求 ≈ 197 token（消息 44 + 工具清单 153，窗口 320，阈值 256）
[模型回答] 算好了：7 * 6 = 42

=== 用户说：你好 ===
[预算] 本次请求 ≈ 246 token（消息 93 + 工具清单 153，窗口 320，阈值 256）
[模型回答] 我不知道怎么回答"你好"，但我可以查天气、也会算数。
```

三轮，163 / 197 / 246，一路涨但都没到 256。**第一遍跑是看不见压缩的**——剧本就到这儿。

不删 `.sessions`，再跑一遍，让它恢复 12 条历史：

```
=== 从磁盘恢复了 12 条记录，seq 接着 #12 往下编 ===
=== 模型看到的历史 ===
[user] 北京天气怎么样？
...

=== 用户说：刚才我问了什么？ ===

[预算告急] 历史 ≈ 271 token 超过阈值 256，折掉 #1~#9，保留最近 46 token

=== 压缩：#1~#9 折成一条摘要 ===
摘要落成 #14，它顶掉了 #1~#9
[预算] 折完降到 ≈ 221 token，省了约 50
[预算] 本次请求 ≈ 221 token（消息 68 + 工具清单 153，窗口 320，阈值 256）
[模型回答] 你问了我北京天气、让我算 7*6，还打了个招呼。
```

271 > 256，压缩触发。日志全量：

```
#13 [user/message] 刚才我问了什么？
#14 [assistant/message] （摘要）#1~#9 被折掉了：…　← replace #1~#9
#15 [assistant/message] 你问了我北京天气、让我算 7*6，还打了个招呼。
```

三件事同时成立：

- **#1~#9 还在文件里。** append-only 一个字没破——压缩是"追加一条 replace 标记"，不是删除。
- **模型只看得见 6 条。** #14 顶掉了 #1~#9，剩下 #10~#13 加它自己。
- **摘要自己也要花钱。** 折完 221 token，比折前的 271 少 50——但如果摘要写得比被折的内容还长，这次压缩就是负优化。真身对此有条硬规矩：`framedSummaryTokenCount >= shadowedRouteTokenCount` 直接抛错。教学版没校验，但那个"省了约 50"的算式替我们盯着。

## 动手改一改

**实验一：把 `CONTEXT_WINDOW` 调回 2048。** 跑两遍。

第一遍一切如常。第二遍恢复 12 条历史后，`[预算告急]` 再也不出现——历史 271 token，阈值 1638，差得远。**同一个 loop，同一份日志，只改一个常量，"自动压缩"这条路就消失了。** 这不是 bug，是提醒你：阈值不是算出来的真理，是配置出来的策略。

**实验二：把 `RETAIN_TOKENS` 改成 0。** 跑第二遍。

`[预算告急]` 照旧触发，但保留数变成 0：`keepFromIdx` 一路退到 surface 末尾，`from`/`to` 覆盖全部 10 条可见历史，**包括"刚才我问了什么？"这一轮本身**。折完历史只剩一条摘要，模型答"你问了我北京天气"——它把自己刚问的问题也忘了。

保底线不是保守，是**自我保存**：当前这一轮必须留在上下文里。

**实验三：删掉 `surfaceOp !== undefined` 那个过滤器。** 跑第二遍。

压缩照旧触发，但 `compact()` 的 `endSeq` 指向了一条没有 `surfaceOp` 的行（`notice/message` 或 `tool/call`）。`deriveMessages()` 的 replace 分支靠 `findIndex` 找起点和终点——找不到就 `continue`，**压缩被静默跳过**。屏幕上还打着"摘要落成 #14"，模型看到的历史却一条没少。

这是本课最阴的一个坑：**没有任何报错，只是没生效。** 真身用 `assertSelectedSpanStable` / `assertWholeSurfaceUnchanged` 两种校验把它堵死；教学版靠的是"只折进过请求的行"这条规则本身。

## 对照真身

本课的两块，真身都比我们重：

**计价。** [packages/llm/token-meter](../../../deepseek-harness/packages/llm/token-meter) 不只是"4 字符 1 token"。它有一条 provider anchor 通路：请求发出去后，拿 provider 回报的精确 `usage` 当锚点，之后同 session 的估价改成"锚点 + 有符号增量"，**用真实数据校正启发式**。它还有 replay fold，保证任何消费者读到同一个数。

我们的假模型在 [mock-provider.ts](./mock-provider.ts) 里回报 `usage: { inputTokens: 10 }`——**这个 10 是个假数字，别信它**。它连一条消息的估价都对不上。这里正好说清一件事：真身只用 provider 回报的用量做**校验和锚定**，从来不用它替代估算——因为请求发出去之前，你得先知道它有多贵。

**触发。** 真身有两个触发器，本课只有第一个：

| | pressure | context-overflow |
|---|---|---|
| 挂在哪 | `agent/pre-step` | `agent/request-error` |
| 判据 | 超阈值 | provider 回报 `CONTEXT_WINDOW_EXCEEDED` |
| 保留 | `retainTokens` | **0**（最大平衡削减） |
| 次数 | 反复压到阈值以下 | `maxOverflowRetries` 默认 1 次 |

第二个触发器的存在本身是个信号：**估算再准也可能失手**，provider 那一头才是最终裁判。所以真身在 `request-error` 上还挂了一条恢复线——被拒了，绕过阈值，用 `retainTokens = 0` 做一次最大削减，再问一次。这一课我们走不到那儿（假模型不报这个错），但 `compactIfNeeded()` 的形状已经留好了：同一个函数，换一个触发条件就能接上。

**裁剪。** 真身还有个 [compaction-tool-result-pruner](../../../deepseek-harness/packages/compaction/compaction-tool-result-pruner)，本课完全没碰。它不调模型、不产摘要，只是**把超长的 tool/result 裁掉头尾**（默认 `thresholdChars 8192 / headChars 4096 / tailChars 1024`），裁剪处插一个 `PRUNE_MARKER` 占位。

为什么它值得单独存在？因为**裁剪不花模型调用**。一次摘要要发一次请求、等一次生成、还要处理"摘要不够小"的失败；一次裁剪是纯字符串操作。能靠裁剪解决的，别动摘要——这正是 `compactIfNeeded()` 里 prune 先于摘要的原因（真身 `prune.pruneSession(agent.session)` 在选段之前）。

**摘要必须更小。** 真身 [region.ts](../../../deepseek-harness/packages/compaction/compaction-basic/src/region.ts) 的 `compactSurfaceRegion()` 是个事务：`compaction/start` 是锁，`compaction/end` 收尾，中间夹着 `assertSelectedSpanStable`（选中的区间没被别人动过）和 `assertWholeSurfaceUnchanged`（区间外的行一个都没变）。最后一道闸：**摘要必须小于被折掉的内容**，否则抛错。压缩是为了省 token，越压越贵就是逻辑错误。

## 小结

- **日志 append-only 和窗口有限必须一起看**：`deriveMessages()` 每轮重付全部历史，不会自己停
- 计价器照抄真身三个常数（4 字符/token、块 4、角色 4）；**工具清单是最容易忘的一块**，两个 schema 就 153 token，每轮重付
- 预算三段公式：`threshold = floor(window × 0.8)`、`retain = 40`、窗口 320 是**舞台缩放**，不是近似
- 选区四条规则照抄 `selectCompactableRange`：尾部累加到保底线、从 `#1` 起折、只折进过请求的行、保不住就收手
- 顺序是**先折、再量、后问**；`compactIfNeeded` 原地改写 `options.messages`
- 摘要仍写死（第 25 课让模型自己写），但**触发它的数字已经是算出来的**
- 口径要和真身一致：`totalTokens` 含工具清单——压不掉的固定成本也得算钱
- 假模型的 `usage: { inputTokens: 10 }` 是假数字：真身只用真实用量做锚定，不用它替代估算

下一篇：25 · 真正的压缩
