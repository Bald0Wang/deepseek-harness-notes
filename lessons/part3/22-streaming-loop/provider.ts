import type { Context } from '@deepseek-ai/cordis'
import { Tools, type ToolSchema } from './tools.ts'
import type { ToolArgs, ToolDefinition, ToolResult } from './define-tool.ts'

export const name = 'tools-registry'

/**
 * Service Provider：一个基于 Map 的工具注册表。
 *
 * register() 是第 02 课的"注册即效果"：注册方插件一卸载，
 * 这个工具定义自动从表里消失。
 */
class MapTools extends Tools {
  private readonly definitions = new Map<string, ToolDefinition>()
  private counter = 0

  register(definition: ToolDefinition): () => void {
    // ctx.effect 是"本插件卸载时自动执行"的注册点
    return this.ctx.effect(() => {
      this.definitions.set(definition.name, definition)
      // 注册即广播：谁想知道"现在有哪些工具"，挂这个事件就行
      this.ctx.emit('tools/change')
      return () => {
        this.definitions.delete(definition.name)
        this.ctx.emit('tools/change')
      }
    }, `tools.register(${definition.name})`)
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name)
  }

  list(): ToolDefinition[] {
    return [...this.definitions.values()]
  }

  schemas(): ToolSchema[] {
    // 只挑三个字段——execute 留在本地，不随请求出门
    return [...this.definitions.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }))
  }

  async call(name: string, args: unknown): Promise<ToolResult> {
    const definition = this.definitions.get(name)
    const callId = `call-${++this.counter}`
    if (!definition) {
      return { ok: false, callId, name, error: `工具不存在：${name}` }
    }
    try {
      const value = await definition.execute((args ?? {}) as ToolArgs, { callId })
      return { ok: true, callId, name, value }
    } catch (error) {
      return { ok: false, callId, name, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export function apply(ctx: Context) {
  ctx.plugin(MapTools)
}
