import { Service, type Context } from '@deepseek-ai/cordis'
import type { ChatMessage } from './session.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tokenMeter: TokenMeter
  }
}

/**
 * 一条消息的估价，以及它在请求里的角色。
 *
 * 真身 [packages/llm/token-meter](../../../deepseek-harness/packages/llm/token-meter/src/estimate.ts)
 * 叫 `estimateMessage()`，收的是 typed Message；教学版收的是
 * 我们自己折出来的 ChatMessage——四字符/token 的启发式照抄。
 */
export interface TokenMeasurement {
  /** 这条消息值多少 token（估算）。 */
  readonly tokens: number
  /** 它在请求里的角色，用来在账本里分组。 */
  readonly role: ChatMessage['role']
}

/**
 * 一次请求的完整账本。
 *
 * 真身叫 `TokenMeasurement`，`totalTokens` 是压力、`surfaceTokens`
 * 是模型可见部分。教学版只有一层：**这一次请求要花多少 token。**
 */
export interface ContextBudget {
  /** 整次请求的估算 token 数。 */
  readonly totalTokens: number
  /** 每条消息的估价，顺序和请求一致。 */
  readonly nodes: readonly TokenMeasurement[]
  /** 系统提示占了多少（0 表示没有系统提示）。 */
  readonly systemTokens: number
  /** 工具清单（schema）占了多少，0 表示没带工具。 */
  readonly toolsTokens: number
}

/**
 * 计价器：一次请求到底有多贵。
 *
 * 这是本课的主题，也是 harness 里 `ctx.tokenMeter` 的教学版。
 * 它只做一件事：**把"模型能看到的历史"折算成 token。**
 *
 * 三个刻意的简化，真身都在这里更讲究：
 *
 * 1. **不联网、不调模型**。真身支持 provider 回报的精确用量，
 *    但只在"同一个请求信封"上复用；教学版纯启发式。
 * 2. **不认 surfaceOp**。它只看 `deriveMessages()` 的结果——
 *    这正是"模型能看到什么就计什么"的意思，被压缩掉的行
 *    天然不在账里。
 * 3. **不知道模型的上下文窗口**。窗口是 adapter 的能力
 *    （真身 `ctx.llm.resolveModelInfo().context`），计价器
 *    只负责数数，不负责裁决。
 */
export abstract class TokenMeter extends Service {
  constructor(ctx: Context) { super(ctx, 'tokenMeter') }

  /**
   * 给一条消息估价。
   * @param message - 模型请求里的一条消息。
   * @returns 估算 token 数。
   */
  abstract estimateMessage(message: ChatMessage): number

  /**
   * 把一次完整请求折成账本。
   * @param messages - `deriveMessages()` 的结果。
   * @param toolsTokens - 工具清单的 token 数，0 表示没带工具。
   * @param systemTokens - 系统提示的 token 数，0 表示没有。
   * @returns 这次请求的估算总账。
   */
  abstract measure(
    messages: readonly ChatMessage[],
    toolsTokens?: number,
    systemTokens?: number,
  ): ContextBudget
}

/**
 * 每条消息的结构开销：JSON 框架、type 标签。
 *
 * 真身叫 BLOCK_OVERHEAD。教学版的消息只有一个 content 字符串，
 * 所以"块"就是消息本身——这个开销平摊到每条消息上。
 */
const BLOCK_OVERHEAD = 4

/**
 * 每条消息的角色框架开销：role 字段、消息边界。
 *
 * 导出理由同上：系统提示的估价也要按这个开销算，
 * 见 main.ts 的 `systemTokens()`。
 */
export const ROLE_OVERHEAD = 4

/**
 * 固定密度启发式：4 字符 1 token。
 *
 * 真身 [estimate.ts](../../../deepseek-harness/packages/llm/token-meter/src/estimate.ts)
 * 的 `CHARS_PER_TOKEN = 4`。这是**已知会低估**的近似：
 * 中文和 JSON Schema 在这个密度下能差一倍以上（README 的
 * Dev Note 自己承认）。教学版照抄这个数，因为它带来的
 * 偏差本身就是本课要讨论的话题。
 *
 * 导出是为了让 main.ts 量系统提示时用**同一个数**——两处各写一个
 * 4，口径就悄悄分叉了，而账本的意义全在口径一致。
 */
export const CHARS_PER_TOKEN = 4

/**
 * Service Provider：四字符/token 的估算器。
 *
 * 实现刻意保持无状态——每次 measure 都重算一遍。
 * 真身有 replay fold、shadow price、provider anchor 一整套，
 * 为的是"同一个 session 的任何消费者读到同一个数"；
 * 教学版的消费者只有 main.ts 一个，重算就够。
 */
export class FixedTokenMeter extends TokenMeter {
  /**
   * 给一条消息估价。
   *
   * 真身 `estimate.ts` 在这里给 system 开了一条**不带 BLOCK_OVERHEAD**
   * 的岔路——adapter 把系统提示序列化成一个纯字符串字段，不是带 type
   * 标签的内容块。教学版的 `ChatMessage` 没有 system 角色
   * （`deriveMessages()` 从不产出它），岔路走不到，`measureRequest()`
   * 里的 systemTokens 因此恒 0。
   */
  estimateMessage(message: ChatMessage): number {
    return Math.ceil(message.content.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD + ROLE_OVERHEAD
  }

  measure(
    messages: readonly ChatMessage[],
    toolsTokens = 0,
    systemTokens = 0,
  ): ContextBudget {
    const nodes: TokenMeasurement[] = []
    let totalTokens = 0
    for (const message of messages) {
      const tokens = this.estimateMessage(message)
      totalTokens += tokens
      nodes.push({ tokens, role: message.role })
    }
    // 工具清单和系统提示也是请求的一部分，不进 messages，但要花钱
    totalTokens += toolsTokens + systemTokens
    return { totalTokens, nodes, systemTokens, toolsTokens }
  }
}

export function apply(ctx: Context) {
  ctx.plugin(FixedTokenMeter)
}
