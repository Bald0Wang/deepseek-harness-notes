/**
 * 简化版 defineTool。
 *
 * harness 真身（packages/core/tools/src/schema.ts 第 554 行）在这里做三件事：
 * 1. 把手写的 JSON Schema DSL 编译成标准 JSON Schema，并用它校验模型传来的参数；
 * 2. 从 DSL 反推出 TypeScript 类型，让 execute 里的 args 有补全；
 * 3. 把校验包在 execute 外层，任何违规都以 ToolArgsError 的形式抛出。
 *
 * 第 10 课只做了"组装"。本课补上第 1 和第 3 件事——**校验**。
 */

import { compileNode, ToolArgsError, validateValue, type JsonSchemaNode, type SchemaSpec } from './json-schema.ts'

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

/** 一次工具调用的结果。成功失败都走这个壳，不抛异常。 */
export type ToolResult =
  | { ok: true; callId: string; name: string; value: unknown }
  | { ok: false; callId: string; name: string; error: string }

/** 一个工具的完整定义。 */
export interface ToolDefinition {
  readonly name: string
  /** 写给模型看的说明，模型据此决定要不要调用它。 */
  readonly description: string
  /** 编译后的参数 schema，既校验也进模型请求。 */
  readonly parameters: ToolParameters
  /** 具体干活的部分。参数已通过校验。 */
  execute(args: ToolArgs, exec: ToolRunContext): Promise<unknown> | unknown
}
export interface DefineToolOptions {
  name: string
  description: string
  /** 手写的参数 schema（第 11 课细讲）。 */
  parameters?: Record<string, SchemaSpec>
  execute(args: ToolArgs, exec: ToolRunContext): Promise<unknown> | unknown
}

/**
 * 定义工具。
 * @param options - 工具的名称、说明、参数 schema 和执行体。
 * @returns 一个 registry-ready 的定义，execute 已自带参数校验。
 */
export function defineTool(options: DefineToolOptions): ToolDefinition {
  const compiled = compileParameters(options.parameters)

  return {
    name: options.name,
    description: options.description,
    parameters: compiled,
    async execute(args: ToolArgs, exec: ToolRunContext): Promise<unknown> {
      // 校验发生在用户的 execute 之前：不合规的参数根本到不了业务代码
      const violations = validateValue(compiled, args)
      if (violations.length > 0) {
        throw new ToolArgsError(options.name, violations)
      }
      return options.execute(args, exec)
    },
  }
}

/** 把"每个参数一条声明"的手写 DSL 编译成一个对象根的 JSON Schema。 */
function compileParameters(spec: Record<string, SchemaSpec> | undefined): JsonSchemaNode {
  if (spec === undefined) return { type: 'object', additionalProperties: true }
  const node = compileNode({ type: 'object', properties: spec })
  // 顶层参数对象是"开放"的：模型可以额外带字段，不像 output schema 那样严苛
  node.additionalProperties = true
  return node
}
