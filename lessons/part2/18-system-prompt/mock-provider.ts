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
 * 假模型的"大脑"：看整个请求决定这一轮说什么。
 *
 * 真模型是靠训练数据学会"什么时候该调工具"的；我们没法训练，
 * 就用 if 把同样的决策写死。重点不在这段逻辑，而在于
 * **它输出的形状和真模型一模一样**——消费方完全感知不到差别。
 *
 * 注意签名收的是 GenerateOptions（整个请求），不是一句字符串。
 * 本课起它开始读 `role: 'system'` 那条消息——**系统提示词生效的唯一证据，
 * 就是模型的决策真的被它改变了**。读不到（比如第 17 课）时走默认行为。
 */
export function decide(options: GenerateOptions): StreamChunk[] {
  // 取**最后一条** system：历史里可能还留着被换掉的旧提示词，
  // 而真正生效的永远是最新写入的那一份。
  const system = options.messages.filter((message) => message.role === 'system').at(-1)?.content ?? ''
  const persona = system.includes('语气') ? '礼貌' : '随意'
  const hasTools = system.includes('get_weather')
  const history = options.messages
  const input = history.at(-1)?.content ?? ''

  // 工具结果又喂回来了：这次该说人话了
  if (input.includes('°C')) {
    const tail = persona === '礼貌' ? '。另外提醒您，出门请酌情携带雨具。' : '。出门看情况带把伞。'
    return textResponse(`${input}${tail}`)
  }
  if (input.includes('刚才')) {
    // 只有模型能看见摘要时才答得上来；原始记录被 replace 顶掉之后就看不到了
    const summary = options.messages.find((message) => message.content.startsWith('（摘要）'))
    if (summary) return textResponse('你问了我北京天气，我查完还提醒了你带伞。')
    return textResponse('我没有历史记忆，每次请求只带当前这一句。')
  }
  if (input.includes('北京')) {
    return toolCallResponse('call-1', 'get_weather', { city: '北京' })
  }
  // 系统提示词说了"只回答天气"，别的请求一律谢绝；
  // 身份段被改写成"也能闲聊"之后，同一句话就答得上了
  if (system.includes('只回答天气')) {
    if (persona === '礼貌') {
      return textResponse('抱歉，我是一个天气助手，只能回答天气相关的问题。')
    }
    return textResponse('我只管天气，别的问不了。')
  }
  if (input.includes('诗')) {
    // 清单里有 get_weather 才证明工具描述真的进了请求——
    // 没有它，模型连"有工具可用"都不知道
    if (!hasTools) return textResponse('我没有工具可用。')
    return textResponse('晴空一字一行诗，云落枝头化作雨。')
  }
  if (input.includes('天气')) {
    return toolCallResponse('call-2', 'get_weather', { city: '北京' })
  }
  return textResponse(`我不知道怎么回答"${input}"，但我可以查天气。`)
}

export function apply(ctx: Context) {
  ctx.plugin(MockAdapter, [decide])
}
