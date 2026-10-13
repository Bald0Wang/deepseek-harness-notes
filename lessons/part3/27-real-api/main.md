# 27 · 接真 API

> 源码：[main.ts](./main.ts) · [real-provider.ts](./real-provider.ts) · [llm.ts](./llm.ts) · [session.ts](./session.ts) · [mock-provider.ts](./mock-provider.ts) · [token-meter.ts](./token-meter.ts)　配置：[cordis.yml](./cordis.yml) · [manifest.ts](./manifest.ts)

本课要接一次真实的模型 API。先看第一行输出：

```
[provider] 没读到 DEEPSEEK_api_key，跳过真模型——本课剩下的部分照样跑（用 mock）
```

（这里故意把输出写小写了一处，是为了提醒你：**日志里的字符串是代码的一部分**，抄的时候别改它。你实际跑出来是全大写的 `DEEPSEEK_API_KEY`。）

这就是本课的运行形态：`DEEPSEEK_API_KEY` 不在环境里，`real-provider.ts` 的 `apply()` 什么都不注册，`mock-provider.ts` 照常顶上，26 课那套剧本一个字不改地跑完。**本课的主题不是「换掉 mock」，是「换得动」。**

看预算那一行：

```
[预算] 本次请求 ≈ 180 token（消息 10 + 工具清单 153 + 系统提示 17，窗口 320，阈值 256）
```

26 课这一行是 `（消息 10 + 工具清单 153，窗口 320，阈值 256）`——多出来的 `+ 系统提示 17` 就是本课第一件实事：**系统提示第一次真的出现了**。24 课起 `measureRequest()` 里就给它留了位置，但那是个恒 0 的空栏，因为从来没有任何东西填过它。

再看最后几行账单：

```
[对话账] 本次真实花费：输入 10 + 输出 19 = 29 token
[压缩账] 本次真实花费：输入 10 + 输出 151 = 161 token
```

`[对话账]` 和 `[压缩账]` 也是新的。25 课给 `GenerateOptions` 加了 `purpose` 字段，但只有本课才有人真的读它——因为**只有真模型的响应会给出账单**。

## 本文件几乎没改

把 26 课和 27 课的目录 diff 一下，`main.ts` 的改动少得可疑：`stream()` 里多了两行分账，`run()` 里每次构造 `GenerateOptions` 时多了 `system` 和 `tools` 两个字段，没了。

真正动过的是另外四个文件：

| 文件 | 改了什么 |
| --- | --- |
| [real-provider.ts](./real-provider.ts) | **新文件**。DeepSeek Messages 协议的 HTTP + SSE |
| [llm.ts](./llm.ts) | `GenerateOptions` 加 `system` / `tools`，新增导出的 `Usage` 类型 |
| [session.ts](./session.ts) | `ChatMessage` 加 `callId`，`toChatMessage()` 把它读出来 |
| [token-meter.ts](./token-meter.ts) | `ROLE_OVERHEAD` / `CHARS_PER_TOKEN` 改为导出，账本口径两处一致 |

`main.ts` 是这个 seam 的 Consumer，`real-provider.ts` 是 Provider，`llm.ts` 是 Service Definition。第 01 课那句话在这里兑现了：**Provider 从 if 换成 HTTP，Consumer 不知道。**

## Provider 那一侧：一个 URL，一个 Key，一个模型 id

打开 [real-provider.ts](./real-provider.ts)，先看三个常量：

```ts
const BASE_URL = 'https://api.deepseek.com/anthropic'
const MESSAGES_PATH = '/messages'
const MODEL = 'deepseek-flash'
```

第一个是**根**，不含路径。真身 [adapter.ts:120](../../../deepseek-harness/packages/llm/llm-deepseek/src/adapter.ts#L120) 是 `fetch(`${messagesApiRoot(connection.baseURL)}/messages`)`——baseURL 只是根，`/messages` 要自己拼。**POST 到根上会拿到 404，而且是个看起来像「端点不通」的 404**，这种错能让人查半天网络。

第二个常量在真身那里是一整份模型目录（`models.ts`，默认 `deepseek-flash` 和 `deepseek-v4-pro`）。教学版只写死一个 id，但它出现在两个地方：请求体的 `model` 字段，和注册成功时那行日志：

```
[provider] 真模型已注册：deepseek-flash @ https://api.deepseek.com/anthropic
```

真身把模型 id 记进 durable replay state，为的就是事后能查清「这一轮用的是谁」。

请求头只有一个真东西：

```ts
headers: {
  'content-type': 'application/json',
  'x-api-key': apiKey,
}
```

**是 `x-api-key`，不是 OpenAI 那套 `Authorization: Bearer`。** 这两个鉴权方案不通用，抄错一个就是一个 401。真身 [llm-deepseek-api-key/src/index.ts:41](../../../deepseek-harness/packages/llm/llm-deepseek-api-key/src/index.ts#L41) 就是 `{ 'x-api-key': await resolveApiKey(connection) }`。

Key 从哪读？教学版最直接：

```ts
const apiKey = process.env[API_KEY_ENV]
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error(`没读到 ${API_KEY_ENV}——export 之后再跑，或者回到 mock-provider`)
}
```

真身不读 `process.env`。它从 `launchEnvironmentOf(ctx).get(ref)` 拿，走的是**可信的环境层**；而且拿不到时抛的是 `MISSING_CREDENTIAL`——fail loud。教学版没有 credentials 服务，就用 `process.env`，但**读不到就抛错**这条照抄：走到这里说明有人想要真模型，静默回落等于骗他。

### 没有 Key 时为什么静默

那 `apply()` 里为什么又是静默的？

```ts
export function apply(ctx: Context) {
  if (process.env[API_KEY_ENV] === undefined || process.env[API_KEY_ENV] === '') {
    console.log(`[provider] 没读到 ${API_KEY_ENV}，跳过真模型——本课剩下的部分照样跑（用 mock）`)
    return
  }
  ctx.plugin(DeepSeekAdapter)
}
```

因为本课的验收标准就是「不需要 Key 也能跑完」。这是**同一个 seam 上的两种失败策略**：缺 Key 时抛错（真身，用户是想要真模型的人）vs 缺 Key 时静默不注册（教学版，用户是学生）。第 20 课的能力对账会在最后告诉你 `llm：齐`——齐，因为 mock 提供了它。

## 请求体：两个「空清单就不发」的字段

`stream()` 里拼请求体，有两处写法值得停下来看：

```ts
...options.tools === undefined || options.tools.length === 0 ? {} : {
  tools: options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  })),
},
...options.system === undefined || options.system.length === 0 ? {} : { system: options.system },
```

**清单为空时整个字段都不发。** 真身 [serialize.ts:159](../../../deepseek-harness/packages/llm/llm-deepseek/src/serialize.ts#L159) 就是这个写法。为什么？因为**空数组和「没有这个字段」在协议里不是一个意思**：`tools: []` 是「我有工具清单，它是空的」，`tools` 缺失才是「别调工具」。前者有些服务端会当成格式错误，后者是明确的语义。

`system` 同理。而且真身这里还多做一步：`options.system` 和历史里已有的系统提示用空行拼起来（`serialize.ts:150`）——教学版一次请求只有一个来源，拼不起来。

顺带一句：**摘要请求不带工具清单**。25 课的 `summarize()` 里 `options` 没有 `tools` 字段，于是 `real-provider.ts` 这边整个字段消失。真身一样——摘要要的是一段文字，给工具只会诱导它去调用，还白付几百 token 的 schema。

## 翻译：最难的一步在 tool_use_id

`toWireMessages()` 是这个文件里最该细读的函数。我们的 `ChatMessage` 只有 role + content，协议的 `tool_result` 却要一个 `tool_use_id`：

```ts
const block: WireBlock = message.role === 'tool'
  ? {
    type: 'tool_result',
    tool_use_id: message.callId ?? '',
    content: [{ type: 'text', text: message.content }],
  }
  : { type: 'text', text: message.content }
```

27 课之前这里写死 `'unknown'`。而 `callId` **一直都在日志里存着**——`SessionRecordMap['tool/result'].callId`，从第 11 课起每一条工具结果都带。只是从来没有人读过它。

这就是「接真 API」最容易踩的坑：**你以为的字段一直都在，只是从来没有人真的读过它。** 教学版让这个坑现形的方式很直接——日志里明明有 `call-1`，发出去的请求里是 `'unknown'`，协议那头对不上，报的错还像是别的问题。

本课的修补在 [session.ts](./session.ts)：`ChatMessage` 加 `callId`，`toChatMessage()` 把它带出来：

```ts
case 'tool/result':
  // callId 从日志里读出来，原样带进请求。
  return { role: 'tool', content: String(line.data.value), callId: line.data.callId }
```

同一个函数里还有一步：**同一角色的连续消息要合并**。

```ts
const previous = wire.at(-1)
if (previous !== undefined && previous.role === role) {
  previous.content.push(block)
  continue
}
```

协议要求一轮对话是一条消息带一个 content 数组，两条 user 挨着会被拒。我们的对话是 user/assistant 交替的，正常路径撞不上；但**压缩摘要之后可能连着两条 user**（摘要是一条 assistant，后面紧跟用户新的一句，再往后接一个 tool_result 翻成的 user）。所以这一步省不掉。

## SSE：协议分片给的东西，要自己攒回整块

真模型的流不是我们 `yield` 出来的 `StreamChunk`，是一路 SSE。帧格式是 `data: {...}\n\n`——**空行分帧**，单个换行不够。中间可能夹着 `: heartbeat` 注释行和 `event: xxx` 行。真身把这事交给 `eventsource-parser` 库；教学版自己写，因为帧格式简单到不值得一个包，而且**自己写一遍才知道它长什么样**。

`translateSse()` 是照抄真身 [translate.ts](../../../deepseek-harness/packages/llm/llm-deepseek/src/translate.ts) 的状态机，166 行的东西砍成教学版之后，还留着两条会真的咬人的红线：

**红线一：`message_stop` 之前流不许结束。**

```ts
if (!sawStop) throw new Error('流在 message_stop 之前就断了')
```

真身这里是 `STREAM_CLOSED`。网络断了就是这样：半条回答，**看起来是完整的**。这种失败比 crash 危险——crash 你知道它坏了，半条回答你不知道。

**红线二：工具参数是 JSON 增量拼出来的。**

```ts
} else if (delta.type === 'input_json_delta') {
  const argumentsDelta = String(delta.partial_json ?? '')
  toolJson.set(index, (toolJson.get(index) ?? '') + argumentsDelta)
```

协议分很多片给 `{"ci`、`ty":"北`、`京"}`，`block-end` 要的是完整块。**这是流式协议和 mock 之间最大的一处差别**——mock 一次就给全（`mock-provider.ts` 的 `toolCallResponse` 里两片拼完）。自己拼过一遍才知道为什么 `block-end` 携带的是「完整块」而不是「最后一片增量」。

同一个函数里还得自己攒三样东西：正文文本、工具的身份（id + name）、usage 两个数。因为 `StreamChunk` 的 `block-end` 要的是完整块，而协议是分片给的。

### 超时：量的不是墙钟

```ts
const timer = setTimeout(() => { abort.abort() }, REQUEST_TIMEOUT_MS)
```

真身叫 `streamIdleTimeoutMs`，默认五分钟，而且量的是**流空闲间隔**，不是整个请求的墙钟时间——一个流式请求可能挂几分钟，但每两片之间不能静默太久。教学版简化成总超时：**宁可少一个功能，不要少一个上限。**

另外这里还 honor 了调用方传来的 signal：

```ts
if (options.signal !== undefined) {
  if (options.signal.aborted) abort.abort()
  else options.signal.addEventListener('abort', () => { abort.abort() }, { once: true })
}
```

27 课之前这里只有自己的超时，外面想取消只能干等。

## 账单：mock 给不了的东西

现在看本课真正的主题。`llm.ts` 新增了一个导出的类型：

```ts
export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}
```

`StreamChunk` 的 usage 分支、`stream()` 里的 `spent` 变量、`reportUsage()` 的参数，三处共用这一个形状。它从第 09 课就在，但那时候是**给教学版凑形状**的：mock 写死 `inputTokens: 10`。

本课它第一次是真的。`main.ts` 里：

```ts
case 'usage':
  spent = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens }
  break
```

然后在 `stream()` 的结尾，分账：

```ts
function reportUsage(purpose: GenerateOptions['purpose'], spent: Usage): void {
  const label = purpose === 'compaction' ? '压缩' : '对话'
  console.log(`[${label}账] 本次真实花费：输入 ${spent.inputTokens} + 输出 ${spent.outputTokens} = ${...} token`)
}
```

为什么要按 `purpose` 分？因为两种请求付的是同一份钱，记的却是两本账：`generate` 是用户看得见的交互成本，`compaction` 是用户看不见的维护开销。混在一起，「压缩一次多少钱」这个问题永远答不出来。

真身在这里走得更远：`purpose` 变成请求头 `x-deepseek-harness-compact: 1`（[adapter.ts:130](../../../deepseek-harness/packages/llm/llm-deepseek/src/adapter.ts#L130)），服务端据此分账。教学版只在日志里分——但分账这件事从第一课起就是刚需。

### 一个反直觉的输出：工具调用那一轮，账单是 0

跑一遍，你会看到这个：

```
[对话账] 本次真实花费：输入 0 + 输出 0 = 0 token
[模型决定] 调用 get_weather，参数 {"city":"北京"}
```

模型明明「决定」了调工具，账单却是 0。不是 bug，是 **mock 剧本的形状**：`toolCallResponse()` 里 chunk 的次序是 `block-end` → `usage` → `finish`，而 `stream()` 在 `block-end` 就 `return` 了——usage 那一片根本没被消费到。

```ts
case 'block-end':
  if (chunk.block.type === 'tool-call') {
    process.stdout.write('\n')
    reportUsage(options.purpose, spent)   // ← 此刻 spent 还是初始值 { 0, 0 }
    return { kind: 'tool-call', ... }
  }
```

真模型不会这样。协议的次序是 `content_block_stop` → `message_delta`（带 usage）→ `message_stop`，usage 在流末尾**之前**到，`translateSse` 会在最后统一吐一片 `usage`。所以真模型上每一轮都拿得到账单，包括工具调用轮。

这一行 0 正好是「账单要靠 response 的 usage 分」的反面教材：**mock 给不出真数，你看到的每个数字都得先问一句它从哪来。**

## 跑一遍

`rm -rf .sessions && node --import tsx/esm ../../../launcher.ts`。

第一行照旧是「没读到 Key」。然后三轮对话，日志 13 条，压缩在第三轮触发一次。和 26 课逐行对比，多出来的只有：每行预算多一个 `+ 系统提示 17`，每次请求多一行 `[对话账]` 或 `[压缩账]`，摘要那次多一行 `[压缩账]`。

注意第三轮的压缩：

```
[预算告急] 历史 ≈ 263 token 超过阈值 256，折掉 #1~#5，保留最近 49 token
```

263 而不是 26 课的 246——**多出来的就是系统提示那 17 token**。同一个剧本，同一套阈值，加一行系统提示就把第三轮推过了线。这就是「系统提示也是请求的一部分」最直接的证据：它不在 messages 里，但一样花钱、一样压阈值。

不删 `.sessions` 再跑一遍。恢复 13 条，第四轮一开口 285 超阈值，再折一次：

```
[预算告急] 历史 ≈ 285 token 超过阈值 256，折掉 #1~#11，保留最近 66 token
```

注意这次折的是 `#1~#11`，包含了上一轮刚生成的摘要 `#12` 之外的全部历史——**压缩出来的摘要也是历史，下一轮照样可能被折掉**。

最后 `[session 一生] 入土（一生共 3 条记录）`。这个 3 是本进程写的（#14~#16），和 26 课一样：日志的一生比进程的一生长。

## 动手改一改

**实验一：把 `MODEL` 改成一个不存在的 id**，比如 `'deepseek-nope'`。有 Key 的情况下跑。

请求发得出去，回来的是 4xx：`DeepSeek HTTP 404：...`。**写一个服务端不认识的模型名，错误要等请求发出去才暴露**——而这种错误在 mock 上永远看不见，因为 mock 的「模型」就是你自己的 if。

**实验二：把 `MESSAGES_PATH` 拼错**，比如直接在 `BASE_URL` 后面去掉 `/anthropic`，或者把路径写成 `/message`（少个 s）。

同样是 4xx。区别在于报错文案可能完全不像「路径错了」——它会说模型不存在或者方法不允许。这就是 `BASE_URL` 注释里那句「POST 到根上会拿到 404，而且是个看起来像端点不通的 404」的意思：**URL 拼错的症状和网络故障长得一样。**

**实验三：把 `toWireMessages` 的 `tool_use_id` 改回 `'unknown'`。** 有 Key 的情况下问一句天气。

协议那头会拒：tool_result 对不上任何 tool_use。而这个字段在日志里明明存了 27 课——`#2 [tool/call] get_weather({"city":"北京"})` 上面的 callId 好好在那儿。**日志里有的东西，请求里没有，这就是最大的那类 bug。**

**实验四：把 `apply()` 里那个「没读到 Key 就 return」改成抛错。**

没 Key 也跑一遍。这一次不是「跳过真模型」，是整个应用加载失败。然后想想：什么时候该抛，什么时候该静默？**标准不是「哪个更礼貌」，是「我的用户是谁」。**

## 对照真身

**模型目录。** 教学版一个写死的 id；真身 `models.ts` 是一份目录，每条带 contextWindow、maxTokens、图片预算。教学版的 `CONTEXT_WINDOW = 320` 是个拍脑袋的舞台缩放，真身那里这是 adapter 报告的能力——`ctx.llm.resolveModelInfo().context.contextWindow`。

**Key 的来源。** 教学版 `process.env`；真身走 credentials 服务，拿不到抛 `MISSING_CREDENTIAL`。

**SSE 解析。** 教学版手写分帧；真身用 `eventsource-parser`，还靠心跳注释唤醒空闲看门狗。

**事件校验。** 教学版只保留两条红线；真身 `translate.ts` 逐事件校验：重复的 `message_start`、`message_start` 之前的事件、stop 之后又开始块、未闭合的块遇到 `message_stop`、截断的工具 JSON——一律 `malformed()`。

**usage 的四个数。** 教学版只有输入输出；真身还有 `cacheReadTokens` / `cacheWriteTokens`，总数是四者之和（[translate.ts:159](../../../deepseek-harness/packages/llm/llm-deepseek/src/translate.ts#L159)）。缓存命中不花输入的钱——**这个区别在长会话里能省掉大半账单。**

**请求扩展。** 真身在 fetch 之前有一层 `prepareRequestExtensions`，可以往请求体里加字段，失败时把字段降级摘掉并通知（`onExtensionsOmitted`）。教学版没有这层。

**失败重试。** 真身有 `retryPolicy` 和文件上传重试；教学版失败就抛给 loop。

## 小结

- **本课 main.ts 几乎没改**：改的是 Provider（新文件）、Service Definition（两个字段）、Session（callId 透传）、计价器（导出两个常量）。第 01 课的 capability seam 在这里兑现
- `/messages` 要自己拼在 baseURL 后面；鉴权头是 `x-api-key` 不是 `Bearer`；`BASE_URL` 只是根，POST 到根上会拿到一个像「端点不通」的 404
- **`tool_use_id` 用的是日志里存了 27 课的 `callId`**——字段一直都在，只是从来没有人读过它。这是接真 API 最容易踩的坑
- 空清单**整个字段都不发**：空数组和「没有这个字段」在协议里不是一个意思
- **系统提示第一次真的出现**：`systemTokens` 从 24 课起恒 0，本课 = 17 token，同一套剧本第三轮从 246 被推到 263、压过阈值
- 流式协议要自己攒回整块：工具参数是 JSON 增量拼的，`block-end` 要的是完整块——**这是 mock 和真模型之间最大的一处差别**
- 两条红线：`message_stop` 之前流不许结束（半条回答比没有回答危险），工具参数增量拼接
- **账单靠 response 的 usage 分**：`[对话账]` vs `[压缩账]`。mock 的 tool-call 轮账单是 0（usage chunk 排在 `block-end` 之后，而 `stream()` 在 `block-end` 就 return）——真模型拿得到，mock 给不出
- 同一个 seam，两种失败策略：缺 Key 抛 `MISSING_CREDENTIAL`（真身）vs 静默不注册（教学版）。**标准不是礼貌，是你的用户是谁**

---

**到这里，27 课全部完结。** 从第 01 课那个 7 行的 `hello from my first plugin`，到此刻这个会查天气、会算数、会自己压缩历史、会在进程重启后接着聊、还能接真 API 的 Agent——你把它一行一行攒出来了。

想回头看哪条线，从这里进：

- 插件怎么工作 → [第一篇](../part1/README.md)
- 工具和记忆 → [第二篇](../part2/README.md)
- 完整 Agent 与真身对照 → [第三篇](README.md)

