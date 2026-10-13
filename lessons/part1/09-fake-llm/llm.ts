import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: Llm
  }
  interface Events {
    /** 消费方向 llm 服务发出一次请求，由提供方处理。 */
    'llm/generate'(input: string): void
  }
}

/**
 * 模型输出被切成一块一块的"流式碎片"（chunk），每条都是下面联合类型的一员。
 * 用 TS 的判别联合：每种 chunk 用 `type` 区分，`type` 叫"判别标签"。
 */
export type StreamChunk =
  /** 一个内容块开始：`blockType` 是 'text'（文字）或 'tool-call'（工具调用）。 */
  | { type: 'block-start'; index: number; blockType: 'text' | 'tool-call' }
  /** 文字流进来一小段。 */
  | { type: 'text-delta'; index: number; text: string }
  /** 模型"思考过程"流进来一小段。 */
  | { type: 'reasoning-delta'; index: number; text: string }
  /** 一次工具调用的参数（JSON 字符串）流进来一小段。 */
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  /** 一个内容块结束，`block` 是拼装好的完整内容。 */
  | { type: 'block-end'; index: number; block: ContentBlock }
  /** 本次调用的 token 用量。 */
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number } }
  /** 本次调用结束，`reason.kind` 说明为什么结束。 */
  | { type: 'finish'; reason: { kind: 'stop' | 'tool-calls' | 'max-tokens' | 'error' } }

/** 拼装完成的内容块：要么是一段文字，要么是一次工具调用。 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }

/** 一次模型请求里，消费方真正关心的部分。 */
export interface GenerateOptions {
  /** 对话历史，最后一条是 user。工具返回的结果也会以一条历史的形式进来。 */
  messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }[]
  /** 希望模型别超过多少输出 token。 */
  maxTokens?: number
  /** 取消信号：上层想中断这次请求时 abort 它。 */
  signal?: AbortSignal
}

/**
 * Service Definition：定义"调用模型"这个能力的词汇。
 * 和上一课的 Notifier 一样：只定义，不实现。
 * `ctx.llm` 拿到的就是这个类型，所以提供方必须继承它。
 */
export abstract class Llm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /**
   * 唯一必须实现的方法：把请求变成一个"异步可迭代"的碎片流。
   * `async function*`（异步生成器）写起来最省事，它天然就是 AsyncIterable。
   * 约定：先 yield `usage`，最后 yield `finish`。
   */
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
