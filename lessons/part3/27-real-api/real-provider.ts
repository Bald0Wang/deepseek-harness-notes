/**
 * 真模型 provider：DeepSeek Messages 协议。
 *
 * 本课的主题。前 26 课一直用 mock-provider——一个假模型，
 * 用 if 把"什么时候该调工具"写死。它输出的 chunk 形状
 * 和真模型一模一样，所以 agent loop 一行都不用改。
 *
 * 现在把那个 if 换成一次真正的 HTTP 请求。**换掉的只有
 * 一个文件**：`mock-provider.ts` 和 `real-provider.ts`
 * 实现的是同一个 `Llm` 抽象类，`main.ts` 里的 `stream()`
 * 看不见任何差别。
 *
 * 这就是第 01 课那个 capability seam：Service Definition
 * （llm.ts）/ Service Provider（本文件 + mock）/ Consumer
 * （main.ts）三个角色。Provider 换了，Consumer 不动。
 */

import type { Context } from '@deepseek-ai/cordis'
import { Llm, type GenerateOptions, type StreamChunk, type ContentBlock } from './llm.ts'
import type { ChatMessage } from './session.ts'

export const name = 'llm-deepseek'
export const inject = ['llm']

/**
 * DeepSeek 的公开端点——**只是根**。
 *
 * 真身 [llm-deepseek/src/config.ts](../../../deepseek-harness/packages/llm/llm-deepseek/src/config.ts#L106)
 * 里这个常量叫 `PUBLIC_BASE_URL`，而且优先读 `$DEEPSEEK_BASE_URL`
 * ——**从可信的环境层读，不从进程随便读**。教学版简化：只有
 * 这一个常量，要换端点就改这里（或者自己 export 一个）。
 *
 * 注意它**不含路径**。真身
 * [adapter.ts:120](../../../deepseek-harness/packages/llm/llm-deepseek/src/adapter.ts#L120)
 * 是 `fetch(`${messagesApiRoot(connection.baseURL)}/messages`)`——
 * baseURL 只是根，`/messages` 要自己拼。POST 到根上会拿到 404，
 * 而且是个看起来像"端点不通"的 404。
 */
const BASE_URL = 'https://api.deepseek.com/anthropic'

/** 协议路径。真身拼在 baseURL 后面，教学版拼在同一个常量旁边。 */
const MESSAGES_PATH = '/messages'

/**
 * 模型 id。
 *
 * 真身这里有一整份模型目录（`models.ts`），默认两条：
 * `deepseek-flash`（DeepSeek-V41-Flash）和 `deepseek-v4-pro`。
 * 教学版只写死一个 id——但注意它出现在**两个地方**：请求体的
 * `model` 字段，和日志。真身把模型 id 记进 durable replay state，
 * 就是为了事后能查清"这一轮用的是谁"。
 *
 * 为什么不用 `deepseek-chat`？真身目录里没有这个 id。写一个
 * 服务端不认识的模型名，错误要等请求发出去才暴露——
 * 而这种错误在 mock 上永远看不见。
 */
const MODEL = 'deepseek-flash'

/**
 * 请求超时。
 *
 * 真身叫 `streamIdleTimeoutMs`（默认五分钟），而且量的是
 * **流空闲间隔**，不是整个请求的墙钟时间——一个流式请求可能
 * 挂几分钟，但每两片之间不能静默太久。教学版简化成总超时：
 * 一次请求超过这个数就断开。宁可少一个功能，不要少一个上限。
 */
const REQUEST_TIMEOUT_MS = 60_000

/** 读 API Key 的环境变量名。真身默认值也是这个名字。 */
const API_KEY_ENV = 'DEEPSEEK_API_KEY'

// ===== 请求：把我们的 ChatMessage 翻译成 WireMessage =====

/**
 * Messages 协议里的一个内容块。
 *
 * 真身 [wire-types.ts](../../../deepseek-harness/packages/llm/llm-deepseek/src/wire-types.ts)
 * 里这叫 `WireBlock`，有十几种（text / image / tool_use /
 * tool_result / thinking / tool_addition …）。教学版只支持两种：
 * 文本，和工具结果。
 */
type WireBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_result'; tool_use_id: string; content: WireBlock[]; is_error?: boolean }

/** Messages 协议里的一轮对话。 */
interface WireMessage {
  role: 'user' | 'assistant' | 'system'
  content: WireBlock[]
}

/**
 * 递出去的请求体。
 *
 * 照抄真身 `WireRequest` 的一个子集。**`stream` 恒为 `true`**——
 * 我们的 agent loop 从第 09 课起就是流式消费的，没有非流式路径。
 */
interface WireRequest {
  model: string
  stream: true
  max_tokens: number
  messages: WireMessage[]
  system?: string
  tools?: {
    name: string
    description: string
    input_schema: Record<string, unknown>
  }[]
}

/**
 * 把内部消息翻成协议消息。
 *
 * **关键的一步，也是最容易出错的一步。** 我们的 `ChatMessage`
 * 只有 role + content 两个字段，协议的 tool_result 却要一个
 * `tool_use_id`——工具结果必须能对上当初那次调用。
 *
 * 27 课之前这里写死 `'unknown'`：日志里明明存了 callId
 * （`SessionRecordMap['tool/result'].callId`），却没有任何人
 * 读过它。本课把它读出来——`deriveMessages()` 现在会把这个
 * 字段带进 ChatMessage（见 session.ts）。
 *
 * 这就是"接真 API"最容易踩的坑：**你以为的字段一直都在，
 * 只是从来没有人真的读过它。**
 */
export function toWireMessages(messages: readonly ChatMessage[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    const role = message.role === 'tool' ? 'user' : message.role
    const block: WireBlock = message.role === 'tool'
      ? {
        type: 'tool_result',
        tool_use_id: message.callId ?? '',
        content: [{ type: 'text', text: message.content }],
      }
      : { type: 'text', text: message.content }
    const previous = wire.at(-1)
    // 协议要求同一角色的连续消息合并——两条 user 挨着会被拒。
    // 教学版的对话是 user/assistant/user/assistant 交替的，
    // 但压缩摘要之后可能连着两条 user，所以这一步省不掉。
    if (previous !== undefined && previous.role === role) {
      previous.content.push(block)
      continue
    }
    wire.push({ role, content: [block] })
  }
  return wire
}

// ===== SSE：把协议事件流翻译回 StreamChunk =====

/**
 * 从响应体里逐帧读 SSE。
 *
 * SSE 的帧格式：`data: {...}\n\n`。**注意是空行分帧**——
 * 单个换行不够。中间可能夹着 `: heartbeat` 注释行（真身用它
 * 唤醒空闲看门狗），和 `event: xxx` 行。
 *
 * 真身把这个活儿交给 `eventsource-parser` 库。教学版不引依赖：
 * 帧格式简单到不值得一个包，而且**自己写一遍才知道它长什么样**。
 */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 按空行切帧。最后一段可能不完整，留在 buffer 里等下一块。
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame.split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
        if (data.length > 0) yield JSON.parse(data) as Record<string, unknown>
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** 协议里 `message_start` 携带的初始 usage。 */
interface WireUsage {
  input_tokens?: number
  output_tokens?: number
}

/**
 * 真模型的流：一次 HTTP 请求，一路 SSE 回来。
 *
 * 翻译逻辑照抄真身
 * [translate.ts](../../../deepseek-harness/packages/llm/llm-deepseek/src/translate.ts)。
 * 那是个 166 行的状态机，逐事件校验；教学版保留**骨架和两条
 * 会真的咬人的红线**，砍掉大部分校验：
 *
 * 1. **`message_stop` 之前流不许结束**（真身 `STREAM_CLOSED`）。
 *    网络断了就是这样：半条回答，看起来像完整的。
 * 2. **tool_use 的参数是 JSON 增量拼出来的**（`input_json_delta`），
 *    不是一次性给全的。教学版必须自己拼——这是流式协议
 *    和 mock 之间最大的一处差别。
 *
 * 另外教学版必须自己攒三样东西，因为 `StreamChunk` 的
 * `block-end` 要的是**完整块**，而协议是分片给的：
 * 正文文本、工具的身份（id + name）、usage 两个数。
 */
async function* translateSse(events: AsyncIterable<Record<string, unknown>>): AsyncGenerator<StreamChunk> {
  /** index → 块的完整内容。block-end 要的"完整块"就存在这儿。 */
  const blocks = new Map<number, ContentBlock>()
  /** index → 工具调用的 id 和 name。分两批来：block-start 给身份，delta 给参数。 */
  const identities = new Map<number, { id: string; name: string }>()
  /** index → 已拼接的参数 JSON。 */
  const toolJson = new Map<number, string>()
  const usage = { inputTokens: 0, outputTokens: 0 }
  let sawStop = false

  for await (const event of events) {
    switch (event.type) {
      case 'message_start': {
        // message_start 里就带 usage——**请求还没吐字，
        // 输入的钱已经定了**。真身 updateUsage() 在这儿收
        // input_tokens；output_tokens 要到 message_delta 才有。
        const message = (event.message ?? {}) as Record<string, unknown>
        const initial = (message.usage ?? {}) as WireUsage
        usage.inputTokens = initial.input_tokens ?? 0
        usage.outputTokens = initial.output_tokens ?? 0
        break
      }

      case 'content_block_start': {
        const index = Number(event.index ?? 0)
        const block = (event.content_block ?? {}) as Record<string, unknown>
        if (block.type === 'text') {
          blocks.set(index, { type: 'text', text: String(block.text ?? '') })
          yield { type: 'block-start', index, blockType: 'text' }
          // 有的实现会在 block-start 里就给一段初始正文，转发出去。
          const initial = String(block.text ?? '')
          if (initial.length > 0) yield { type: 'text-delta', index, text: initial }
        } else if (block.type === 'tool_use') {
          const id = String(block.id ?? '')
          const name = String(block.name ?? '')
          identities.set(index, { id, name })
          toolJson.set(index, '')
          yield { type: 'block-start', index, blockType: 'tool-call' }
          // 真身在 block-start 时就吐出 id 和 name：调用方要靠
          // 这两个字段把日志写下来（callId 要对得上 tool_result），
          // 不能等参数拼完。**这里 id 是真的**——协议直接给了。
          yield { type: 'tool-call-delta', index, id, name, argumentsDelta: '' }
        }
        break
      }

      case 'content_block_delta': {
        const index = Number(event.index ?? 0)
        const delta = (event.delta ?? {}) as Record<string, unknown>
        if (delta.type === 'text_delta') {
          const text = String(delta.text ?? '')
          const block = blocks.get(index)
          if (block?.type === 'text') block.text += text
          yield { type: 'text-delta', index, text }
        } else if (delta.type === 'input_json_delta') {
          const argumentsDelta = String(delta.partial_json ?? '')
          toolJson.set(index, (toolJson.get(index) ?? '') + argumentsDelta)
          // id 从 block-start 记下的身份里取，**不是空串**。真身
          // translate.ts:85 在每片增量里都带上 `id: content.id`——
          // 调用方靠它把日志写对，不能等参数拼完才认得出这次调用。
          const identity = identities.get(index)
          yield { type: 'tool-call-delta', index, id: identity?.id ?? '', argumentsDelta }
        }
        break
      }

      case 'content_block_stop': {
        const index = Number(event.index ?? 0)
        const block = blocks.get(index)
        if (block !== undefined) {
          yield { type: 'block-end', index, block }
        } else {
          const identity = identities.get(index)
          yield {
            type: 'block-end',
            index,
            block: {
              type: 'tool-call',
              id: identity?.id ?? '',
              name: identity?.name ?? '',
              arguments: toolJson.get(index) ?? '',
            },
          }
        }
        break
      }

      case 'message_delta': {
        const delta = (event.delta ?? {}) as Record<string, unknown>
        // stop_reason 映射成我们的 finish kind。
        // 真身 stopReason() 是个判别联合 switch，四种已知值，
        // 其余一律 malformed——**协议加新值时不猜**。
        const reason = String(delta.stop_reason ?? '')
        if (reason === 'end_turn' || reason === 'stop_sequence') {
          yield { type: 'finish', reason: { kind: 'stop' } }
        } else if (reason === 'tool_use') {
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else if (reason === 'max_tokens') {
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        }
        // output_tokens 到这一刻才定：吐了多少字，是吐完才知道的。
        const deltaUsage = (event.usage ?? {}) as WireUsage
        usage.outputTokens = deltaUsage.output_tokens ?? usage.outputTokens
        sawStop = true
        break
      }

      case 'message_stop':
        sawStop = true
        break

      case 'error': {
        const error = (event.error ?? {}) as Record<string, unknown>
        throw new Error(`DeepSeek 报错：${String(error.message ?? JSON.stringify(event))}`)
      }
    }
  }

  // 红线：流断了，但没有 message_stop。
  // 半条回答比没有回答更危险——它看起来是完整的。
  if (!sawStop) throw new Error('流在 message_stop 之前就断了')

  // usage 最后统一吐一次。真身在 message_stop 前吐，而且含
  // cache 读写四类 token——教学版只有输入输出两个数。
  yield { type: 'usage', usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } }
}

export class DeepSeekAdapter extends Llm {
  constructor(ctx: Context) { super(ctx) }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const apiKey = process.env[API_KEY_ENV]
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error(`没读到 ${API_KEY_ENV}——export 之后再跑，或者回到 mock-provider`)
    }

    const request: WireRequest = {
      model: MODEL,
      stream: true,
      max_tokens: options.maxTokens ?? 1024,
      messages: toWireMessages(options.messages),
      // 清单为空时**整个字段都不发**。真身
      // serialize.ts:156 就是这个写法：`...options.tools === undefined ? {} : {...}`。
      // 空数组和"没有这个字段"在协议里不是一个意思——后者才是"别调工具"。
      ...options.tools === undefined || options.tools.length === 0 ? {} : {
        tools: options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      },
      // 系统提示同理：没有就不发这个字段。真身把 options.system
      // 和历史里的系统提示用空行拼起来，教学版只有一次请求一个来源。
      ...options.system === undefined || options.system.length === 0 ? {} : { system: options.system },
    }

    const abort = new AbortController()
    // 调用方给的 signal 也要 honor：27 课之前这里只有自己的超时，
    // 外面想取消只能干等。真身把 signal 一路传进 fetch。
    const timer = setTimeout(() => { abort.abort() }, REQUEST_TIMEOUT_MS)
    if (options.signal !== undefined) {
      if (options.signal.aborted) abort.abort()
      else options.signal.addEventListener('abort', () => { abort.abort() }, { once: true })
    }
    try {
      const response = await fetch(`${BASE_URL}${MESSAGES_PATH}`, {
        method: 'POST',
        headers: {
          // Messages 协议的鉴权头。真身叫 x-api-key，不是
          // OpenAI 那套 Authorization: Bearer。
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(request),
        signal: abort.signal,
      })

      // HTTP 层就失败了：4xx 多半是 key 不对或余额不足，
      // 5xx 是对方的事。两种情况都不能当"模型说了句怪话"，
      // 要抛出来，让 loop 的失败路径接手。
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`DeepSeek HTTP ${response.status}：${text.slice(0, 200)}`)
      }
      if (response.body === null) throw new Error('DeepSeek 响应没有 body')

      yield* translateSse(readSse(response.body))
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Provider：有 Key 就注册真模型，没有就**什么都不做**。
 *
 * 为什么不在没有 Key 时抛错？因为本课的课目要能在没有 Key 的
 * 机器上跑完（教学验收就是这个状态）。真身
 * [llm-deepseek-api-key](../../../deepseek-harness/packages/llm/llm-deepseek-api-key/src/index.ts)
 * 的做法是**缺 Key 抛 `MISSING_CREDENTIAL`**——fail loud，因为它
 * 的用户是想要真模型的人。
 *
 * 教学版的折中：缺 Key 时静默不注册，`main.ts` 那边靠
 * **能力对账**（第 20 课那个 reportCapabilities）发现 `llm`
 * 缺了 provider，并打印说明。**同一个 seam，两种失败策略，
 * 差别只在你面对的是学生还是用户。**
 */
export function apply(ctx: Context) {
  if (process.env[API_KEY_ENV] === undefined || process.env[API_KEY_ENV] === '') {
    console.log(`[provider] 没读到 ${API_KEY_ENV}，跳过真模型——本课剩下的部分照样跑（用 mock）`)
    return
  }
  ctx.plugin(DeepSeekAdapter)
  console.log(`[provider] 真模型已注册：${MODEL} @ ${BASE_URL}`)
}
