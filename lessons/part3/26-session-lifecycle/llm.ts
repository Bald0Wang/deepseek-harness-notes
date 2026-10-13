import { Service, type Context } from '@deepseek-ai/cordis'
import type { ChatMessage } from './session.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { llm: Llm }
  interface Events {
    /** 消费方向 llm 服务发出一次请求，由提供方处理。 */
    'llm/generate'(input: string): void
  }
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
