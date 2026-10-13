# 22 · 流式 loop：让字一个个蹦出来

> 源码：[main.ts](./main.ts) · [mock-provider.ts](./mock-provider.ts) · [llm.ts](./llm.ts)　配置：[cordis.yml](./cordis.yml)

上一课结束时，三轮对话跑起来是这样的：

```
=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。出门看情况带把伞。
```

一句话，整块出现。等模型"说完"才显示，中间那段时间屏幕是死的。

本课改掉它。同一句话，改成：

```
[模型回答] 北京：晴，12°C。出门看情况带把伞。
```

字一个个蹦出来，每片之间隔着 60ms。

**先记住本课最重要的一句话：协议一个字没改，改的是"什么时候用"。**

## 协议一个字没改

看 [llm.ts](./llm.ts) 里的 `StreamChunk`，和上一课、和 [第 09 课](../part1/09-agent-loop/llm.ts) 完全一样：

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

`Llm` 抽象类的签名也没改：

```ts
export abstract class Llm extends Service {
  constructor(ctx: Context) { super(ctx, 'llm') }
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

它返回的是 `AsyncIterable<StreamChunk>`——一个可以 `for await` 的流。这个返回类型从第 09 课就是它了。

所以流式从来不是"换了个 API"。`for await` 每一圈都拿到一片 `text-delta`，上一课的选择是**攒着，什么都不做，等循环结束**；本课的选择是**来一片打一片**。

差别只在消费时机：

```ts
// 上一课：攒完才用
async function collect(stream: AsyncIterable<StreamChunk>): Promise<ModelTurn> {
  for await (const chunk of stream) { texts.set(chunk.index, ...) }   // 只拼，不打
  return { kind: 'text', text }
}

// 本课：来一片用一片
async function stream(ctx: Context, options: GenerateOptions): Promise<ModelTurn> {
  for await (const chunk of ctx.llm.stream(options)) {
    case 'text-delta':
      texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
      process.stdout.write(chunk.text)     // 同一圈里，顺手打了
  }
}
```

**打印和拼装是同一个循环里的两件事。** 用户看到字蹦出来（体验），日志拿到拼好的完整块（正确性）。两者不冲突——`text-delta` 的拼接就是字符串相加，来一片加一片，顺序天然保真。

这也解释了真身为什么敢这么做。[llm/src/types.ts 第 452 行](../../../deepseek-harness/packages/llm/llm/src/types.ts#L452) 的注释写着：

> Block indexes correlate interleaved deltas, and `block-end` carries the assembled block.

翻译过来：delta 可以交错（多个 block 同时吐），但每个 block 有 index，而且 `block-end` 会把拼好的完整块再送一次。**协议自己就同时服务了两种消费方式**——想快，追 delta；想省事，等 block-end。我们的 `stream()` 两种都要：追 delta 是为了屏幕，收 block-end 是为了日志。

## 假模型必须真的"慢"

改 `main.ts` 之前，先得让假模型吐得慢。

上一课的 [mock-provider.ts](./mock-provider.ts) 里，`stream()` 是这样：

```ts
async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
  ...
  for (const chunk of chunks) {
    yield chunk
  }
}
```

一个 `yield` 接着一个 `yield`，中间**没有任何 `await`**。这意味着整个流在同一个 tick 里全部吐完——`for await` 的循环一圈接一圈跑完，中间一次都没把控制权交回事件循环。

这种流式是假的。消费方确实"分片"收到了，但所有片同时到达，`for await` 一次都等不到。用户看到的还是一整块。

改法只有一行，但它是本课的地基：

```ts
const CHUNK_DELAY_MS = 60

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
  ...
  for (const chunk of chunks) {
    // 每片之前等一等。真模型的延迟来自网络和推理，
    // 我们没法真等，但**必须等**——否则流式协议是假的。
    await sleep(CHUNK_DELAY_MS)
    yield chunk
  }
}
```

`await sleep()` 把控制权交回事件循环，事件循环再在 60ms 后把这个生成器叫醒，吐下一片。**流式的节奏是 await 让出来的，不是 yield 让出来的。**

60ms 这个数字是故意放慢的。真模型的首字延迟通常几百毫秒，一片片的节奏也远慢于此；我们这里是为了让"字在蹦"这件事在终端里肉眼可见。`await sleep(0)` 同样能把流拆开，但那样你盯着屏幕什么也看不出来——调试的时候分不清"它在流式"和"它只是跑得快"。

顺带说一句 `sleep(0)` 和"不 await"的区别，这是个容易混的点：**`await` 一个已 resolve 的 Promise 也会让出事件循环**（微任务队列），所以技术上 `sleep(0)` 足够。但微任务不等待时钟，肉眼不可见；我们要的是看得见的节奏。

## main.ts：边收边打

现在改消费方。[main.ts](./main.ts) 里 `collect()` 换成 `stream()`：

```ts
async function stream(ctx: Context, options: GenerateOptions): Promise<ModelTurn> {
  const texts = new Map<number, string>()
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  let wroteText = false

  for await (const chunk of ctx.llm.stream(options)) {
    switch (chunk.type) {
      case 'text-delta':
        texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
        if (!wroteText) {
          process.stdout.write('[模型回答] ')
          wroteText = true
        }
        process.stdout.write(chunk.text)
        break
      case 'reasoning-delta':
        process.stdout.write(chunk.text)
        break
      case 'tool-call-delta': { ... }
      case 'block-end':
        if (chunk.block.type === 'tool-call') {
          process.stdout.write('\n')
          return { kind: 'tool-call', ... }
        }
        break
      case 'usage': break
      case 'finish': break
    }
  }

  const text = [...texts.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join('')
  if (wroteText) process.stdout.write('\n')
  return { kind: 'text', text }
}
```

### write 不是 log

注意满屏的 `process.stdout.write`，没有一处 `console.log`。

`console.log` 每次调用**自带换行**。用它打流式，一句话会被拆成几十行——每个字一行。流式的全部要点就是"不换行，直到块结束"，所以换行这个动作必须由我们自己决定：

- 第一片正文之前，打标签 `[模型回答] `（不带换行）
- 每片正文，`write(chunk.text)`（不带换行）
- 整个流结束，如果写过正文，补一个 `\n`

### 标签为什么在函数里打

`[模型回答] ` 这个标签，第一反应是放在 `run()` 里——那里才是"模型说完话了"的地方：

```ts
case 'text':
  console.log(`[模型回答] ${turn.text}`)   // 上一课就是这样
```

但流式之后不行。标签和正文必须同一行，而 `run()` 拿到 `turn` 的时候，正文早就打完了。事后再补标签，只能另起一行：

```
北京：晴，12°C。出门看情况带把伞。
[模型回答] （19 字，逐字打印）
```

读起来像两个句子。所以标签挪进 `stream()`，在**第一片正文到来时**打——那时正文还没开始，标签和正文自然连成一行。`wroteText` 这个标志一物二用：它同时回答"标签打过了吗"和"结尾该补换行吗"。

标签的位置从这里可以看出一点门道：**流式把"报告进度"这件事从事后挪到了事前。** 谁先知道，谁负责打招呼。

### reasoning-delta 不置标志

思考过程也是逐字打的，但它**不置 `wroteText`**。原因有两个：它没有标签，也不参与结尾换行的判断。更重要的是——本课的假模型不产出 `reasoning-delta`，但真模型会，而且真模型的思考过程**不保证出现**（有的模型只在特定模式下才吐）。一个可能不出现的东西，不该影响"要不要补换行"这种必然执行的决定。

### 工具调用那一轮，一个字都不打

看 `block-end` 分支：

```ts
case 'block-end':
  if (chunk.block.type === 'tool-call') {
    process.stdout.write('\n')
    return { kind: 'tool-call', ... }
  }
```

工具调用的参数是 JSON 字符串，一片片拼出来的（`argumentsDelta`）。**这些片不打。** 它们不是给人看的——给 model 看的是拼好的整块，给人看的是 `[模型决定] 调用 get_weather，参数 {...}` 这一行摘要，由 `run()` 打印。

所以工具调用那一轮，`wroteText` 始终是 `false`，结尾那个 `\n` 不会打。这个判断是必要的：不判断就会在工具调用轮多出一个空行。

```ts
// 这一轮有没有往屏幕上写过正文？工具调用那一轮一个字都不写，
// 结尾就不能补换行——否则会多出一个空行。
let wroteText = false
```

## 一轮变慢，撞了车

跑一下。`rm -rf .sessions && node --import tsx/esm ../../../launcher.ts`

第一版跑出来是这样的——**字是蹦出来了，但三句话互相穿插**：

```
=== 用户说：北京天气怎么样？ ===

[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
北京：晴，12°C。出门看情况带把伞。
=== 用户说：帮我算 7*6 ===

[模型决定] 调用 calc，参数 {"a":7,"b":6,"op":"*"}
[工具返回] 7 * 6 = 42
算好了：7 * 6 = 42
=== 用户说：你好 ===
我不知道怎么回答"你好"，但我可以查天气、也会算数。

=== 压缩：#1~#10 折成一条摘要 ===
摘要落成 #4，它顶掉了 #1~#10
```

日志只有 8 条，摘要落在 `#4`。日志里还出现了字符交错：

```
知北道算京怎好：么了晴回：，答71" 2你*°好 C"6。
```

这是 `北京天气怎么样？`、`帮我算 7*6`、`你好` 三句**同时**在写同一条记录，`seq` 分配撞车、内容互相覆盖的结果。

### 原因：三个 setTimeout

上一课的启动调度长这样：

```ts
setTimeout(() => { void run('北京天气怎么样？') }, 50)
setTimeout(() => { void run('帮我算 7*6') }, 100)
setTimeout(() => { void run('你好') }, 150)
setTimeout(() => { compact(1, 10, '（摘要）...') }, 200)
```

50ms 的间隔，在上一课是够的——那一轮的模型瞬间吐完，50ms 足够跑完一整。

本课不行了。**一轮现在要花几百毫秒**：几十片 × 60ms。100ms 时第二轮开跑，第一轮还在吐字；150ms 时第三轮插进来。三个 `run()` 并发执行，屏幕上三行字互相穿插，`ctx.session.append` 同时写同一条记录，`compact(1, 10)` 去找终点的时候，终点还没写出来——压缩被静默跳过，于是摘要落到了 `#4`。

这不是"流式特有的麻烦"，而是**任何异步流水线的通用纪律**：只要一步变慢了，原本靠"猜时间"排的队就会撞车。

### 修法：await 一个，再 await 下一个

```ts
void (async () => {
  if (restored > 0) {
    await run('刚才我问了什么？')
  } else {
    await run('北京天气怎么样？')
    await run('帮我算 7*6')
    await run('你好')
    // 三轮聊完，把 #1~#10 折成一条摘要。
    // endSeq 必须是**摘要之前最后一条记录**（#10）：摘要自己落在 #11，
    // 它还没进日志，写 11 会让"找终点"的那一步落空，压缩被静默跳过。
    compact(1, 10, '（摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。')
  }
  reportCapabilities()
  replay()
})()
```

真正的排队方式是**等前一个真的做完**，不是猜它多久做完。第 21 课那个 `setTimeout(printTools, 0)` 是另一个活例子——它等的不是"某个固定时长"，而是"本轮事件循环安静下来"，那才是真正的时机。

改完之后，输出恢复正常：

```
=== 没有找到历史，开一个新会话 ===

=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。出门看情况带把伞。

=== 用户说：帮我算 7*6 ===
[模型决定] 调用 calc，参数 {"a":7,"b":6,"op":"*"}
[工具返回] 7 * 6 = 42
[模型回答] 算好了：7 * 6 = 42

=== 用户说：你好 ===
[模型回答] 我不知道怎么回答"你好"，但我可以查天气、也会算数。

=== 压缩：#1~#10 折成一条摘要 ===
摘要落成 #11，它顶掉了 #1~#10

=== 能力对账 ===
- llm：齐
- tools：齐
- session：齐

=== 日志全量（11 条）===
#1 [user/message] 北京天气怎么样？
#2 [tool/call] get_weather({"city":"北京"})
#3 [tool/result] 北京：晴，12°C
#4 [assistant/message] 北京：晴，12°C。出门看情况带把伞。
...
#11 [assistant/message] （摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。　← replace #1~#10
```

11 条、seq 有序、压缩落成 #11、对账一次。和上一课结构完全一致。

## 动手改一改

**实验一：把 sleep 删掉。** 把 [mock-provider.ts](./mock-provider.ts) 里的 `await sleep(CHUNK_DELAY_MS)` 注释掉，跑。

输出**完全正常**——三轮对话、11 条日志、压缩落成 #11、能力对账三项全齐，退出码 0。和带着 sleep 跑出来的东西逐字一样。

这就是本课最容易被骗过的地方：**删掉 sleep，程序的所有正确性指标一个都没变。** 日志还是 11 条，`for await` 还是一圈圈跑，`text-delta` 还是一片片收。唯一变的是节奏——而节奏这东西，看输出看不出来，只有盯着终端才能发现。

能量出来的是总耗时。三轮对话，带着 sleep 跑 8.6 秒，删掉之后 5.2 秒——**差出来的 3.4 秒全是 sleep 在等**。一个纯粹的等待，一个正确的程序，一个不变的结果。

流式是**体验**，不是功能。体验变了，功能一个没动。

**实验二：把标签挪回 run()。** 把 `stream()` 里那三行标签删掉，回到上一课的写法，在 `run()` 的 text 分支里补一行 `console.log('[模型回答] ' + turn.text)`。

跑。第三轮的输出是这样：

```
我不知道怎么回答"你好"，但我可以查天气、也会算数。[模型回答] 我不知道怎么回答"你好"，但我可以查天气、也会算数。
```

**同一个句子，在同一行出现了两次**——一次是逐字蹦出来的，一次是事后整块补的。这正是改造过程中我实际踩过的坑：**流式之后，"事后补报告"的每一行都得重新审。** 屏幕上的输出有了新的生产者，旧的打印代码不会自动知道这件事。

**实验三：第二次跑，走恢复路径。** 先跑一次（生成 `.sessions`），再跑一次：

```
=== 从磁盘恢复了 11 条记录，seq 接着 #11 往下编 ===
=== 模型看到的历史 ===
[assistant] （摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。

=== 用户说：刚才我问了什么？ ===
[模型回答] 你问了我北京天气，我查完还提醒了你带伞。
```

这一句答案是真话——模型**看得见**摘要，所以答得出来。`deriveMessages()` 从日志折历史这条路，第 09 课到现在一直没变；变的是折完之后怎么用。恢复路径下的日志长到 13 条（#12 用户提问、#13 模型回答），seq 接着 #11 往下编，没撞。

## 对照真身

我们的 `stream()` 只做了两件事：打印、拼装。真身的流式消费远比这重——[llm/src/assistant-stream.ts 第 20 行](../../../deepseek-harness/packages/llm/llm/src/assistant-stream.ts#L20)：

```ts
export type AssistantStreamRecord =
  | { readonly type: 'text-chunks'; readonly time0: number; readonly index: number;
      readonly dt: readonly number[]; readonly texts: readonly string[] }
  | { readonly type: 'reasoning-chunks'; ... }
  | { readonly type: 'tool-call-chunks'; ... }
  | { readonly type: 'chunk'; readonly time: number; readonly chunk: StreamChunk }
```

真身把每一片 delta **连同时间戳**存进 durable 事件。注意 `time0` 和 `dt`：首片的时间 + 每片相对于首片的间隔。存下来之后，"模型想了多久才开口""哪个字吐得慢"都是可回放的事实。

这是"模型可见 ⟺ 可记入日志"那条规则推到极端的样子：**流式的时间线本身也是日志的一部分。** 我们的 `stream()` 把时间花在了屏幕上，花完就没了；真身把时间也记了下来。

第 24 课讲上下文预算时会再见到 `dt`——"模型在这里卡了 8 秒"是判断要不要压缩的重要信号。本课先记住这个反差：**同样的流，教学版只顾眼前，真身连节奏都要存档。**

## 小结

- **协议一个字没改**：`StreamChunk` 七种类型、`stream()` 的签名，从第 09 课就是这样。改的是消费时机——攒完才用 vs 来一片用一片
- 打印和拼装在同一个循环里：`texts.set()` 负责日志，`process.stdout.write()` 负责屏幕
- 假模型必须**真的慢**：`await sleep()` 把控制权交回事件循环，否则整个流在一个 tick 里吐完，`for await` 一次都等不到
- `write` 不是 `log`：log 自带换行，会把一句话拆成几十行；换行必须自己决定
- 标签在**第一片正文到来时**打，不在事后补——流式把"报告进度"从事后挪到了事前
- `wroteText` 一物二用：标签打过了吗、结尾该补换行吗
- 删掉 sleep，所有正确性指标都不变——**流式是体验，不是功能**
- 一轮变慢，三个 `setTimeout` 撞了车；改成串行 `await`。**排队靠等前一个做完，不靠猜时间**

下一篇：23 · 错误恢复
