/**
 * 简化版 defineTool。
 *
 * harness 真身（packages/core/tools/src/schema.ts）在这里做了三层事：
 * 1. 把手写的 JSON Schema DSL 编译成标准 JSON Schema，并用它校验模型传来的参数；
 * 2. 从 DSL 反推出 TypeScript 类型，让 execute 里的 args 有补全；
 * 3. 用 ctx.effect 管理注册，插件卸载时工具自动消失。
 *
 * 本课先做第 3 件事，把"注册"这条链路跑通。校验和类型推导留到第 11 课。
 */

/** 模型传来的参数：一个 JSON 对象。 */
export type ToolArgs = Record<string, unknown>

/** 参数 schema：一棵 JSON Schema 树。 */
export type ToolParameters = Record<string, unknown>

/** 执行上下文：harness 真身叫 ToolRunContext，这里只保留两个字段。 */
export interface ToolRunContext {
  /** 本次调用的 id，由注册表分配。 */
  readonly callId: string
  /** 取消信号：调用方 abort 时，工具应当尽快收手。 */
  readonly signal?: AbortSignal
}

/** 一个工具的完整定义。 */
export interface ToolDefinition {
  readonly name: string
  /** 写给模型看的说明，模型据此决定要不要调用它。 */
  readonly description: string
  /** 参数结构说明（第 11 课细讲）。 */
  readonly parameters: ToolParameters
  /** 具体干活的部分。 */
  execute(args: ToolArgs, exec: ToolRunContext): Promise<unknown> | unknown
}

/** 一次工具调用的结果。成功失败都走这个壳，不抛异常。 */
export type ToolResult =
  | { ok: true; callId: string; name: string; value: unknown }
  | { ok: false; callId: string; name: string; error: string }

export interface DefineToolOptions {
  name: string
  description: string
  parameters?: Record<string, unknown>
  execute(args: ToolArgs, exec: ToolRunContext): Promise<unknown> | unknown
}

/** 定义工具。真身在 harness 里还会做校验和类型推导，这里只做组装。 */
export function defineTool(options: DefineToolOptions): ToolDefinition {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters ?? {},
    execute: options.execute,
  }
}
