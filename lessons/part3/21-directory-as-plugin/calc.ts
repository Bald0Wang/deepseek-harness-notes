import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from './define-tool.ts'

export const name = 'calc-tool'

export const inject = ['tools']

/**
 * 第二个工具插件。
 *
 * 它和 weather.ts 长得一模一样，唯一的差别是干的事不同。
 * 这就是"注册表"的全部意义：**加工具不用碰 loop 一行代码**，
 * 只要新写一个插件、在 cordis.yml 里加一行。
 */
export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'calc',
    description: '算一道四则运算。支持加减乘除。',
    parameters: {
      a: { type: 'number', required: true, description: '左操作数' },
      b: { type: 'number', required: true, description: '右操作数' },
      op: { type: 'string', enum: ['+', '-', '*', '/'], description: '运算符' },
    },
    execute(args) {
      const a = Number(args.a)
      const b = Number(args.b)
      switch (args.op) {
        case '+': return `${a} + ${b} = ${a + b}`
        case '-': return `${a} - ${b} = ${a - b}`
        case '*': return `${a} * ${b} = ${a * b}`
        case '/': return `${a} / ${b} = ${b === 0 ? '除数不能为 0' : a / b}`
        default:
          return `不支持的运算符：${String(args.op)}`
      }
    },
  }))
}
