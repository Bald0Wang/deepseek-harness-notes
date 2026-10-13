import type { Context } from '@deepseek-ai/cordis'
import { Llm, type GenerateOptions, type StreamChunk } from './llm.ts'

export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

export function toolCallResponse(id: string, name: string, args: object): StreamChunk[] {
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 0, id, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

export const name = 'llm-mock'

export class MockAdapter extends Llm {
  private cursor = 0

  constructor(
    ctx: Context,
    private script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]))[],
  ) {
    super(ctx)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script[this.cursor]
    if (!entry) throw new Error('MockAdapter: 剧本用完了')

    // 两种条目的寿命不同，这是本课的关键设计：
    // 函数条目是"常驻大脑"——每一轮都重新问它一次，像真模型那样只看当前请求做决策；
    // 静态条目是一次性剧本——读过就翻页，第二次 stream 就取不到了。
    if (typeof entry !== 'function') this.cursor += 1

    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) { yield chunk }
  }
}

/**
 * 假模型的"大脑"：看用户输入决定这一轮说什么。
 *
 * 真模型是靠训练数据学会"什么时候该调工具"的；我们没法训练，
 * 就用 if 把同样的决策写死。重点不在这段逻辑，而在于
 * **它输出的形状和真模型一模一样**——消费方完全感知不到差别。
 *
 * 注意签名收的是 GenerateOptions（整个请求），不是一句字符串：
 * 真模型看的是全部 messages，我们只看最后一条——至于是谁说的，
 * 在"请求即历史"之后已经不重要了，压缩摘要也是一条历史。
 */
export function decide(options: GenerateOptions): StreamChunk[] {
  // 本课的关键：假模型只看**请求里真的带了几条消息**。
  // 第 14 课每条请求只有 1 条 user 消息，所以下面这个分支永远进不去——
  // 不是模型记性差，是我们压根没把历史递给它。
  const history = options.messages
  const input = history.at(-1)?.content ?? ''

  // 工具结果又喂回来了：这次该说人话了
  if (input.includes('°C')) {
    return textResponse(`${input}。出门看情况带把伞。`)
  }
  if (input.includes('刚才')) {
    // 只有请求里真的带着历史消息时才答得上来。
    // 历史从日志折出来（deriveMessages），折出来几条，这里就能看见几条。
    const sawWeather = history.some((message) => message.content.includes('北京'))
    if (sawWeather) return textResponse('你问了我北京天气，我查完还提醒了你带伞。')
    return textResponse('我没有历史记忆，每次请求只带当前这一句。')
  }
  if (input.includes('北京')) {
    return toolCallResponse('call-1', 'get_weather', { city: '北京' })
  }
  if (input.includes('天气')) {
    return toolCallResponse('call-2', 'get_weather', { city: '北京' })
  }
  return textResponse(`我不知道怎么回答"${input}"，但我可以查天气。`)
}

export function apply(ctx: Context) {
  ctx.plugin(MockAdapter, [decide])
}
