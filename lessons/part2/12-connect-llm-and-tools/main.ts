import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from './llm.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 用户说了一句话，agent 处理一轮。 */
    'agent/turn'(input: string): void
  }
}

export const name = 'agent'

// 两条接缝都要用：llm 拿模型输出，tools 执行工具
export const inject = ['llm', 'tools']

/** 一轮对话里模型给出的指令：要么说话，要么调工具。 */
type ModelTurn =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; id: string; name: string; args: Record<string, unknown> }

/**
 * Consumer：agent loop 的最小可用版本。
 *
 * 这是整个 harness 的心脏。今天它只有一圈：
 *   模型说话 → （如果是调工具）执行 → 把结果告诉用户
 * 第三篇我们会把这个圈跑很多遍，直到模型说"我说完了"。
 */
export function apply(ctx: Context) {
  ctx.on('agent/turn', (input) => { void run(input) })

  setTimeout(() => ctx.emit('agent/turn', '北京天气怎么样？'), 50)
  setTimeout(() => ctx.emit('agent/turn', '你好'), 100)

  async function run(input: string) {
    console.log(`\n=== 用户说：${input} ===`)

    const options: GenerateOptions = {
      messages: [{ role: 'user', content: input }],
    }
    const turn = await collect(ctx.llm.stream(options))

    // 判别联合的标准用法：switch on type
    switch (turn.kind) {
      case 'text':
        console.log(`[模型回答] ${turn.text}`)
        break

      case 'tool-call':
        console.log(`[模型决定] 调用 ${turn.name}，参数 ${JSON.stringify(turn.args)}`)
        await executeTool(turn)
        break
    }
  }

  async function executeTool(call: Extract<ModelTurn, { kind: 'tool-call' }>) {
    const result = await ctx.tools.call(call.name, call.args)
    if (result.ok) {
      console.log(`[工具返回] ${String(result.value)}`)
    } else {
      console.log(`[工具失败] ${result.error}`)
    }
  }
}

/**
 * 把流式 chunk 收成一个完整的 ModelTurn。
 *
 * 这是第 09 课 `for await` 循环的升级版：不再是打印，
 * 而是**按 index 把碎片拼回整块**。真模型的工具参数被切成很多片，
 * 必须拼起来才能 JSON.parse。
 */
async function collect(stream: AsyncIterable<StreamChunk>): Promise<ModelTurn> {
  // index → 已拼接的文本/参数
  const texts = new Map<number, string>()
  const calls = new Map<number, { id: string; name: string; arguments: string }>()

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text-delta':
        texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
        break
      case 'tool-call-delta': {
        const existing = calls.get(chunk.index) ?? { id: chunk.id, name: '', arguments: '' }
        // name 可能只在第一条 delta 上出现
        if (chunk.name !== undefined) existing.name = chunk.name
        existing.arguments += chunk.argumentsDelta
        calls.set(chunk.index, existing)
        break
      }
      case 'block-end':
        if (chunk.block.type === 'tool-call') {
          return { kind: 'tool-call', id: chunk.block.id, name: chunk.block.name, args: parseArgs(chunk.block.arguments) }
        }
        break
      case 'finish':
        break
      default:
        break
    }
  }

  const text = [...texts.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join('')
  return { kind: 'text', text }
}

/** 解析工具参数；解析失败时返回空对象——校验层会给出准确报错。 */
function parseArgs(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}
