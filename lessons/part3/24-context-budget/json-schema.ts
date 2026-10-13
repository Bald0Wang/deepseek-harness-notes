/**
 * 简化版 JSON Schema 校验器。
 *
 * harness 真身在 packages/core/tools/src/json-schema.ts，它只接受一个
 * 受限的 JSON Schema 子集：一个标量 type、对象 properties/required、
 * 布尔 additionalProperties、数组 items、标量 enum/const。任何子集之外的
 * 关键字直接拒绝，而不是"接受但不校验"——因为那会给作者一种虚假的安全感。
 *
 * 本课实现同款子集的教学版。
 */

/** 校验错误：模型传来的参数不符合声明。 */
export class ToolArgsError extends Error {
  constructor(
    readonly toolName: string,
    readonly violations: string[],
  ) {
    super(`invalid arguments: ${violations.join('; ')}`)
    this.name = 'ToolArgsError'
  }
}

/** 手写 DSL 里的一个节点。 */
export type SchemaSpec =
  | { type: 'string'; required?: true; description?: string; enum?: readonly string[] }
  | { type: 'number'; required?: true; description?: string }
  | { type: 'boolean'; required?: true; description?: string }
  | { type: 'array'; required?: true; description?: string; items?: SchemaSpec }
  | { type: 'object'; required?: true; description?: string; additionalProperties?: boolean; properties?: Record<string, SchemaSpec> }

/** 编译后的 JSON Schema 节点（只保留校验需要的字段）。 */
export interface JsonSchemaNode {
  type: string
  description?: string
  enum?: readonly (string | number | boolean | null)[]
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  /** 允许作为普通 JSON 对象在工具之间传递。 */
  [key: string]: unknown
}

/**
 * 把手写 DSL 的一个节点编译成 JSON Schema。
 * @param spec - 手写 DSL 节点。
 * @returns 编译后的 JSON Schema 节点。
 */
export function compileNode(spec: SchemaSpec): JsonSchemaNode {
  const node: JsonSchemaNode = { type: spec.type }
  if (spec.description !== undefined) node.description = spec.description
  if ('enum' in spec && spec.enum !== undefined) node.enum = spec.enum
  if (spec.type === 'array' && spec.items !== undefined) {
    node.items = compileNode(spec.items)
  }
  if (spec.type === 'object') {
    node.additionalProperties = spec.additionalProperties ?? false
    if (spec.properties !== undefined) {
      node.properties = {}
      node.required = []
      for (const [key, child] of Object.entries(spec.properties)) {
        node.properties[key] = compileNode(child)
        if (child.required === true) node.required.push(key)
      }
      if (node.required.length === 0) delete node.required
    }
  }
  return node
}

/**
 * 校验一个值是否符合编译后的 schema。
 * @param schema - 编译后的 schema。
 * @param value - 待校验的值，任意来源。
 * @param path - 当前路径，用于错误信息定位。
 * @returns 违规列表；空数组表示通过。
 */
export function validateValue(schema: JsonSchemaNode, value: unknown, path = '$'): string[] {
  const violations: string[] = []
  const at = (suffix: string) => suffix === '' ? path : `${path}.${suffix}`

  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        violations.push(`${at('')} 必须是字符串，收到 ${describe(value)}`)
        break
      }
      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        violations.push(`${at('')} 必须是 ${schema.enum.map((entry) => JSON.stringify(entry)).join(' / ')} 之一`)
      }
      break

    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        violations.push(`${at('')} 必须是数字，收到 ${describe(value)}`)
      }
      break

    case 'boolean':
      if (typeof value !== 'boolean') {
        violations.push(`${at('')} 必须是布尔值，收到 ${describe(value)}`)
      }
      break

    case 'array': {
      if (!Array.isArray(value)) {
        violations.push(`${at('')} 必须是数组，收到 ${describe(value)}`)
        break
      }
      if (schema.items === undefined) break
      value.forEach((entry, index) => {
        violations.push(...validateValue(schema.items!, entry, `${path}[${index}]`))
      })
      break
    }

    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        violations.push(`${at('')} 必须是对象，收到 ${describe(value)}`)
        break
      }
      const record = value as Record<string, unknown>
      for (const key of schema.required ?? []) {
        if (record[key] === undefined) {
          violations.push(`${at(key)} 是必填项，但没有提供`)
        }
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (record[key] === undefined) continue
        violations.push(...validateValue(child, record[key], at(key)))
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (schema.properties === undefined || !(key in schema.properties)) {
            violations.push(`${at(key)} 不是声明过的字段（additionalProperties: false）`)
          }
        }
      }
      break
    }

    default:
      throw new Error(`不支持的 schema 类型：${schema.type}`)
  }

  return violations
}

/** 把一个未知值描述成一句人能看懂的话，用于错误信息。 */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '数组'
  if (typeof value === 'object') return '对象'
  return JSON.stringify(value) ?? String(value)
}
