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
}

export abstract class Llm extends Service {
  constructor(ctx: Context) { super(ctx, 'llm') }
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
