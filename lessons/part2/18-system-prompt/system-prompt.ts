import { Service, type Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { systemPrompt: SystemPrompt }
  interface Events {
    /**
     * 有段落注册进来或摘出去。
     *
     * harness 真身（packages/core/system-prompt/src/index.ts 第 19 行）也叫
     * `system-prompt/change`。为什么需要它？因为**写插件的人控制不了谁先加载**，
     * 想知道"提示词是不是变了"，只能等注册表通知。
     * @mode emit
     */
    'system-prompt/change'(): void
  }
}

/**
 * 段落顺序表：数字小的排在前面。
 *
 * harness 真身（packages/core/system-prompt/src/index.ts 第 125 行）有一张
 * 大得多的 `SECTION_ORDERS`，把全仓库所有段落都钉死在固定槽位上。
 * 我们只留三个，但机制是同一套：**顺序不靠注册先后，靠一张公开的表**。
 */
export const SECTION_ORDER = {
  /** 身份：你是谁。永远在最前面。 */
  identity: -1000,
  /** 人设：部署方给定的行为准则。 */
  persona: 0,
  /** 工具清单：由注册表现算。 */
  tools: 1000,
} as const

/** 一段提示词。 */
export interface Section {
  /** 段落的唯一名字，重复注册同名会 fail loud。 */
  readonly name: string
  /** 顺序，取自 `SECTION_ORDER` 之类的公开表。 */
  readonly order: number
  /**
   * 文本，或每次组装时现算文本的函数。
   *
   * 函数形式是给"内容取决于别的插件后来发生了什么"的段落用的——
   * 工具清单就是这种：注册它的 agent 早就 apply 完了，
   * 而工具是别的插件之后才注册进来的。
   */
  readonly text: string | (() => string)
  /** 为 true 时这一段就是全部提示词，别的段落和工具清单都不要了。 */
  readonly complete?: boolean
}

/**
 * Service Definition：系统提示词的组装台。
 *
 * 它不是一个字符串字段，而是一个**有序段落注册表**。
 * 任何人都能往里加一段，加的时候不用管别人加过什么。
 */
export abstract class SystemPrompt extends Service {
  constructor(ctx: Context) { super(ctx, 'systemPrompt') }

  /**
   * 注册一段提示词。
   * @param section - 段落内容。
   * @returns 摘除函数，随注册方插件的卸载自动执行。
   */
  abstract section(section: Section): () => void

  /**
   * 拼出当前完整提示词。
   *
   * 每次请求都重新算一遍——所以任何时候问它，拿到的都是"此刻的全部贡献"。
   * @returns 组装后的文本；一段都没有时是空串。
   */
  abstract assemble(): string

  /**
   * 把工具清单渲染成一段文本。
   *
   * 模型不会读我们的 TypeScript 接口，它只认文本。
   * @param schemas - 递给模型看的工具描述。
   * @returns 渲染结果；没有工具时是空串。
   */
  abstract renderTools(schemas: readonly ToolSchema[]): string
}

/**
 * Service Provider：基于数组的段落注册表。
 *
 * 排序发生在 `assemble()` 里，不在注册时——所以后注册的段落
 * 照样能排到前面去，只要它的 order 小。
 */
class ArraySystemPrompt extends SystemPrompt {
  private readonly sections: Section[] = []

  constructor(ctx: Context) {
    super(ctx)
  }

  section(section: Section): () => void {
    return this.ctx.effect(() => {
      this.sections.push(section)
      this.ctx.emit('system-prompt/change')
      return () => {
        const index = this.sections.indexOf(section)
        if (index >= 0) this.sections.splice(index, 1)
        this.ctx.emit('system-prompt/change')
      }
    }, `systemPrompt.section(${section.name})`)
  }

  assemble(): string {
    const complete = this.sections.filter((section) => section.complete)
    if (complete.length > 1) {
      throw new Error(
        `system prompt 有 ${complete.length} 段标记了 complete：${complete.map((s) => s.name).join('、')}`,
      )
    }
    // complete 段落一出现，它就是全部——别的段落连工具清单一起让位
    if (complete.length === 1) return resolveText(complete[0])

    const sorted = [...this.sections].sort((a, b) => a.order - b.order)
    const parts = sorted.map(resolveText).filter((text) => text.length > 0)
    return parts.join('\n\n')
  }

  renderTools(schemas: readonly ToolSchema[]): string {
    if (schemas.length === 0) return ''
    const lines = schemas.map((schema) => `- ${schema.name}：${schema.description}`)
    return ['你可以使用以下工具：', ...lines].join('\n')
  }
}

/**
 * 取一段的文本。函数形式现算——调用方拿到的永远是"此刻的内容"。
 * @param section - 要取文本的段落。
 * @returns 该段落此刻的文本。
 */
function resolveText(section: Section): string {
  return typeof section.text === 'function' ? section.text() : section.text
}

export function apply(ctx: Context) {
  ctx.plugin(ArraySystemPrompt)
}
