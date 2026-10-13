import { Service, type Context } from '@deepseek-ai/cordis'
import type { ChatMessage } from './session.ts'
import type { ToolSchema } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { llm: Llm }
  interface Events {
    /** 消费方向 llm 服务发出一次请求，由提供方处理。 */
    'llm/generate'(input: string): void
  }
}

/**
 * 一次请求真实花掉的 token。
 *
 * 前 26 课没有这个类型——`StreamChunk` 的 usage 一直是
 * **给教学版凑形状**的：mock 写死 `inputTokens: 10`。
 * 本课它第一次是真的：真模型的 `message_start` /
 * `message_delta` 带这两个数（见 real-provider.ts 的
 * `translateSse`），main.ts 靠它分账。
 */
export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: 'text' | 'tool-call' }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'finish'; reason: { kind: 'stop' | 'tool-calls' | 'max-tokens' | 'error' } }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }

export interface GenerateOptions {
  /** 模型看得见的历史。形状和 `deriveMessages()` 的产物一致——同一套类型，不用再翻译。 */
  messages: ChatMessage[]
  /**
   * 系统提示。
   *
   * 真身 `GenerateOptions.system`：**不在 messages 里**，是请求体
   * 上一个独立的顶层字段。教学版从第 24 课起就在账本里给它留了
   * 位置（`systemTokens`），但一直没有值——直到本课接真 API，
   * 这个字段才第一次真的被填。
   */
  system?: string
  /**
   * 递给模型的工具清单。
   *
   * 真身 `GenerateOptions.tools?: ToolSchema[]`。**清单不进
   * messages**——它是请求上的另一组顶层字段。前 26 课的假模型
   * 用 if 决定调不调工具，从来不看这个字段，所以它一直是空的；
   * 真模型只认清单，清单空着就只能说话。
   */
  tools?: ToolSchema[]
  maxTokens?: number
  signal?: AbortSignal
  /**
   * 这次请求是干什么的。
   *
   * 真身 `GenerateOptions.purpose`：主对话是 `'generate'`，压缩摘要是
   * `'compaction'`。同一根管子、同一套协议，但**账单上要分得开**——
   * 否则一次压缩花的 token 会混进主对话，事后说不清是谁花的。
   * 本课的假模型不看它，但摘要请求会带上，方便在日志里认出来。
   */
  purpose?: 'generate' | 'compaction'
}

export abstract class Llm extends Service {
  constructor(ctx: Context) { super(ctx, 'llm') }
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
