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

/**
 * 每片之间的间隔，毫秒。
 *
 * 不设成 0 的原因：生成器的 `yield` 之间如果没有 await，
 * 整个流会在**同一个 tick 里全部吐完**，消费方的 `for await`
 * 一次都等不到——那就不叫流式，叫批量。
 * 一个 `await sleep(0)` 就足以把控制权交回事件循环，
 * 但那样眼睛看不出来。这里故意放慢，让你在终端里看见字一个个来。
 */
const CHUNK_DELAY_MS = 60

/** 让出事件循环，等 `ms` 毫秒。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
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
    for (const chunk of chunks) {
      // 每片之前等一等。真模型的延迟来自网络和推理，
      // 我们没法真等，但**必须等**——否则流式协议是假的。
      await sleep(CHUNK_DELAY_MS)
      yield chunk
    }
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
  const input = options.messages.at(-1)?.content ?? ''
  // 摘要请求：最后一条是压缩指令。先认它——指令里也可能出现
  // "天气""算"这些词，被下面的分支截走就永远拿不到摘要了。
  if (input.includes('compaction engine')) {
    return textResponse(buildSummary(options.messages))
  }
  // 工具结果又喂回来了：这次该说人话了
  if (input.includes('°C')) {
    return textResponse(`${input}。出门看情况带把伞。`)
  }
  // 恢复路径：模型看见了**失败**的工具结果（isError: true）。
  // 上一课走到这里就只剩 default 分支——模型压根不知道刚才失败了，
  // 只会顺着自己的思路说下一句。本课它能看见失败，于是补上漏掉的参数重试。
  if (input.includes('必填项')) {
    return toolCallResponse('call-3-fix', 'calc', { a: 7, b: 6, op: '*' })
  }
  if (input.includes('刚才')) {
    // 只有模型能看见摘要时才答得上来；原始记录被 replace 顶掉之后就看不到了
    const summary = options.messages.find((message) => message.content.includes('## Primary Request'))
    if (summary) return textResponse('你问了我北京天气、让我算 7*6，还打了个招呼。')
    return textResponse('我没有历史记忆，每次请求只带当前这一句。')
  }
  if (input.includes('北京')) {
    return toolCallResponse('call-1', 'get_weather', { city: '北京' })
  }
  if (input.includes('天气')) {
    return toolCallResponse('call-2', 'get_weather', { city: '北京' })
  }
  // 新增：模型"选"了另一个工具。它不需要认识 calc 的实现，
  // 只要注册表里有这个名字，loop 就能把它调起来。
  if (input.includes('算') || input.includes('+')) {
    // 注意这里**故意漏了 op**：模型不是永远正确的，漏参数是最常见的错。
    // 漏掉的参数会被第 11 课的校验器拦住，错误信息原样喂回给模型。
    return toolCallResponse('call-3', 'calc', { a: 7, b: 6 })
  }
  // 工具结果又喂回来了：算数结果是 "7 * 6 = 42" 这种形状。
  // 注意上面那句不能写成 includes('*')——那会把结果也当成"要算数"。
  if (/^[\d.]+\s*[-+*/]\s*[\d.]+\s*=/.test(input)) {
    return textResponse(`算好了：${input}`)
  }
  return textResponse(`我不知道怎么回答"${input}"，但我可以查天气、也会算数。`)
}

export function apply(ctx: Context) {
  ctx.plugin(MockAdapter, [decide])
}

/**
 * 假模型的"摘要大脑"：读重放的那段历史，产出带 `<summary>` 标签的
 * 结构化摘要。
 *
 * 真模型是靠指令里的七段式模板学会分门别类的；我们没法训练，
 * 就用 if 把同样的结构写死。重点不在这段拼字符串的逻辑，而在
 * **它输出的形状和真模型一模一样**：开标签、Markdown 小节、
 * 闭标签——消费方的 `extractSummary()` 感知不到差别。
 *
 * 注意它读的是整个 messages（含最后那条压缩指令），不是最后一句：
 * 摘要的内容必须来自被折掉的那段对话，这是"压缩"和"瞎编"的分界线。
 */
function buildSummary(messages: readonly { readonly role: string; readonly content: string }[]): string {
  const history = messages.slice(0, -1)
  const asked = history.filter((message) => message.role === 'user').map((message) => message.content)
  const results = history.filter((message) => message.role === 'tool').map((message) => message.content)
  const failed = results.filter((result) => result.includes('必填项'))

  const lines = [
    '<summary>',
    '## Primary Request and Intent',
    ...asked.map((question) => `- 用户问了：${question}`),
    '',
    '## Current Work',
    ...results.map((result) => `- 工具返回：${result}`),
    failed.length > 0 ? '- 一次 calc 调用漏了 op 参数，被校验器拦下，补上后成功' : '',
    '',
    '## Next Step',
    '- 回答用户"刚才我问了什么"，依据上面的摘要',
    '</summary>',
  ]
  return lines.filter((line) => line !== '').join('\n')
}
