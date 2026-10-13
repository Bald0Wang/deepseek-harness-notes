import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from './llm.ts'
import type { SessionLine } from './session.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 用户说了一句话，agent 处理一轮。 */
    'agent/turn'(input: string): void
  }
}

export const name = 'agent'
export const inject = ['llm', 'tools', 'session']

/** 一轮对话里模型给出的指令：要么说话，要么调工具。 */
type ModelTurn =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; id: string; name: string; args: Record<string, unknown> }

/**
 * Consumer：agent loop 的第二版。
 *
 * 第 12 课只跑一圈，本课给每个动作都留一份**书面记录**。
 * 流程：
 *   用户说话 → 记 user/message → 问模型 → 记 tool/call → 执行 → 记 tool/result
 *   → 模型拿到结果说出人话 → 记 assistant/message
 */
export function apply(ctx: Context) {
  ctx.on('agent/turn', (input) => { void run(input) })

  setTimeout(() => ctx.emit('agent/turn', '北京天气怎么样？'), 50)
  setTimeout(() => ctx.emit('agent/turn', '你好'), 100)
  // 前面两轮跑完后，把日志读出来重放一遍
  setTimeout(() => replay(), 300)

  async function run(input: string) {
    console.log(`\n=== 用户说：${input} ===`)
    ctx.session.append({ type: 'user/message', data: { content: input } })

    const options: GenerateOptions = { messages: [{ role: 'user', content: input }] }
    const turn = await collect(ctx.llm.stream(options))

    switch (turn.kind) {
      case 'text':
        console.log(`[模型回答] ${turn.text}`)
        ctx.session.append({ type: 'assistant/message', data: { text: turn.text } })
        break

      case 'tool-call': {
        console.log(`[模型决定] 调用 ${turn.name}，参数 ${JSON.stringify(turn.args)}`)
        // 注意：arguments 存的是模型吐出的**原始字符串**，不是我们 parse 后的对象
        ctx.session.append({
          type: 'tool/call',
          data: { callId: turn.id, name: turn.name, arguments: JSON.stringify(turn.args) },
        })
        await executeTool(turn)
        break
      }
    }
  }

  async function executeTool(call: Extract<ModelTurn, { kind: 'tool-call' }>) {
    const result = await ctx.tools.call(call.name, call.args)
    if (result.ok) {
      console.log(`[工具返回] ${String(result.value)}`)
      ctx.session.append({
        type: 'tool/result',
        data: { callId: call.id, name: call.name, value: result.value, isError: false },
      })

      // 工具结果有了，再问模型一次，让它说人话
      const follow = await collect(ctx.llm.stream({
        messages: [{ role: 'user', content: String(result.value) }],
      }))
      if (follow.kind === 'text') {
        console.log(`[模型回答] ${follow.text}`)
        ctx.session.append({ type: 'assistant/message', data: { text: follow.text } })
      }
    } else {
      console.log(`[工具失败] ${result.error}`)
      ctx.session.append({
        type: 'tool/result',
        data: { callId: call.id, name: call.name, value: result.error, isError: true },
      })
    }
  }

  /** 重放：日志是唯一事实来源，屏幕上的字早没了，日志还在。 */
  function replay() {
    console.log('\n=== 从日志重放 ===')
    for (const line of ctx.session.list()) {
      console.log(`#${line.seq} [${line.type}] ${describe(line)}`)
    }
    console.log(`共 ${ctx.session.list().length} 条记录`)
  }

  function describe(line: SessionLine): string {
    switch (line.type) {
      case 'user/message':
        return line.data.content
      case 'assistant/message':
        return line.data.text
      case 'tool/call':
        return `${line.data.name}(${line.data.arguments})`
      case 'tool/result':
        return line.data.isError ? `失败：${String(line.data.value)}` : String(line.data.value)
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
