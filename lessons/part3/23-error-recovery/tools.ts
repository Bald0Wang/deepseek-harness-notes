import { Service, type Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolParameters, ToolResult } from './define-tool.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: Tools
  }
  interface Events {
    /**
     * 有工具注册进来或摘出去。
     *
     * harness 真身（packages/core/tools/src/index.ts 第 208 行）也叫
     * `tools/change`。为什么需要它？因为插件的加载顺序由依赖拓扑决定，
     * **不写插件的人控制不了谁先谁后**。想知道"现在有哪些工具"，
     * 只能等注册表通知，不能在启动时假设它已经满了。
     * @mode emit
     */
    'tools/change'(): void
  }
}

/**
 * Service Definition：工具注册表。
 *
 * 它只知道"工具长什么样、怎么被调用"，不知道任何一个工具的具体实现。
 */
export abstract class Tools extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  /** 注册一个工具定义，返回的摘除函数随注册方插件的卸载自动执行。 */
  abstract register(definition: ToolDefinition): () => void

  /** 按名字取定义，没有则 undefined。 */
  abstract get(name: string): ToolDefinition | undefined

  /** 当前全部定义，按注册顺序排列。 */
  abstract list(): ToolDefinition[]

  /**
   * 递给模型看的工具清单。
   *
   * 只保留 name / description / parameters 三个字段——
   * `execute` 是本地代码，发给模型没有意义，还可能泄露实现细节。
   * harness 真身 [packages/core/tools/src/index.ts 第 1260 行](../../../deepseek-harness/packages/core/tools/src/index.ts#L1260)
   * 的 `schemas()` 干的就是这件事，注释里那词叫 allowlist（白名单）。
   */
  abstract schemas(): ToolSchema[]

  /**
   * 执行一个工具；任何失败都收进 ToolResult，不往外抛。
   *
   * `signal` 是调用方给的上限：工具应该尽快收手并返回失败。
   * harness 真身（packages/core/tools）在这里是一条 waterfall
   * `tools/execute`，guard/timeout-policy 挂上去的包装器就是
   * 在 `next()` 前后把 signal 换成自己的期限——**注册表本身不认识超时，
   * 超时是别人挂上来的一层。** 教学版把 signal 直接传到底。
   */
  abstract call(name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult>
}

/** 递给模型看的工具描述：三个字段，缺一不可。 */
export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: ToolParameters
}
