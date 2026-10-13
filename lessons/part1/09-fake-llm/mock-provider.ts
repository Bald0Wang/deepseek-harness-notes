import type { Context } from '@deepseek-ai/cordis'
import { Llm, type GenerateOptions, type StreamChunk } from './llm.ts'

/** 把一段文字切成"标准流式回复"，照着 harness 测试里的 textResponse 写的。 */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    // 一个字符一条 delta，模拟真实模型逐字吐字
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** 把一次工具调用切成"标准流式回复"，参数按 JSON 字符串分两段流出。 */
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

/**
 * Service Provider：一个脚本化的假模型。
 * 每被调用一次，就从剧本（script）里取下一段剧本吐出去——像复读机，但复读的是你写好的内容。
 */
export class MockAdapter extends Llm {
  constructor(
    ctx: Context,
    private script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]))[],
  ) {
    super(ctx)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (!entry) throw new Error('MockAdapter: 剧本用完了')
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) {
      yield chunk
    }
  }
}

export function apply(ctx: Context) {
  // 三段剧本：先纯文字，再工具调用，再根据输入动态决定
  ctx.plugin(MockAdapter, [
    textResponse('你好，我是假模型。'),
    toolCallResponse('call-1', 'get_weather', { city: '北京' }),
    (options) => {
      const last = options.messages.at(-1)?.content ?? ''
      return textResponse(`你刚才说：${last}`)
    },
  ])
}
