import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from './llm.ts'
import type { SessionLine } from './session.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 用户说了一句话，agent 处理一轮。 */
    'agent/turn'(input: string): void
    /** 把前面的轮次折叠成一条摘要。 */
    'agent/compact'(fromSeq: number, toSeq: number, summary: string): void
  }
}

export const name = 'agent'
export const inject = ['llm', 'tools', 'session']

/** 一轮对话里模型给出的指令：要么说话，要么调工具。 */
type ModelTurn =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; id: string; name: string; args: Record<string, unknown> }

/**
 * Consumer：agent loop 的第四版。
 *
 * 第 12 课只跑一圈，第 14 课给每个动作都留一份**书面记录**，
 * 第 15 课把日志折成模型看得见的请求——到这儿为止，历史只会越来越长。
 *
 * 本课解决它的副作用：**让历史变短，日志不变**。
 */
export function apply(ctx: Context) {
  ctx.on('agent/turn', (input) => { void run(input) })
  ctx.on('agent/compact', (fromSeq, toSeq, summary) => { compact(fromSeq, toSeq, summary) })

  /** 见过的最长请求，用来在压缩前后对比。 */
  let before = 0

  setTimeout(() => ctx.emit('agent/turn', '北京天气怎么样？'), 50)
  setTimeout(() => ctx.emit('agent/turn', '你好'), 100)
  // 两轮聊完，把 #1~#6 折成一条摘要
  setTimeout(() => ctx.emit('agent/compact', 1, 6, '（摘要）用户问了北京天气，模型调了 get_weather 拿到"北京：晴，12°C"，并提醒出门看情况带伞。'), 200)
  // 压缩之后再来一轮：模型只能看见摘要，看不见原始的调用和返回了
  setTimeout(() => ctx.emit('agent/turn', '刚才我问了什么？'), 250)
  setTimeout(() => replay(), 400)

  async function run(input: string) {
    console.log(`\n=== 用户说：${input} ===`)
    ctx.session.append({ type: 'user/message', data: { content: input } })

    // 关键一行：messages 不是手搓的，是从日志折出来的
    const options: GenerateOptions = { messages: ctx.session.deriveMessages() }
    const turn = await collect(ctx.llm.stream(options))
    // 折叠是第 15 课的事；本课多走一步——折完之后，历史可能还是太长
    void measure('run()', ctx.session.deriveMessages().length)

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

      // 工具结果有了，再问模型一次，让它说人话——这次它看得见刚才的调用和返回
      const follow = await collect(ctx.llm.stream({ messages: ctx.session.deriveMessages() }))
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

  /**
   * 压缩：往日志里**追加**一条摘要，标记它顶掉 [fromSeq, toSeq]。
   *
   * 注意是追加，不是删除。旧的行一条不少地还在文件里，
   * 只是从此不进模型请求——这就是 harness 的 compaction 路子。
   *
   * harness 真身里这一步不是谁手动 emit 的：compaction 插件盯着请求长度，
   * 超了就自己生成摘要、自己 append 一条 replace。我们把手动的那一下露出来，
   * 是为了看清它到底往日志里写了什么。
   */
  function compact(fromSeq: number, toSeq: number, summary: string) {
    console.log(`\n=== 压缩：#${fromSeq}~#${toSeq} 折成一条摘要 ===`)
    const seq = ctx.session.append(
      { type: 'assistant/message', data: { text: summary } },
      { op: 'replace', startSeq: fromSeq, endSeq: toSeq },
    )
    console.log(`摘要落成 #${seq}，它顶掉了 #${fromSeq}~#${toSeq}`)
    const after = ctx.session.deriveMessages()
    console.log(`模型历史从 ${before} 条变成 ${after.length} 条`)
  }

  /**
   * 量一下请求有多长。
   *
   * 真模型按 token 计费、有上下文窗口上限；我们的 mock 不烧钱，
   * 但**条数**就是同一个问题的缩影：条数只增不减，迟早撞墙。
   */
  function measure(where: string, count: number) {
    before = Math.max(before, count)
    console.log(`[${where}] 本次请求 ${count} 条消息`)
  }

  /** 重放：日志是唯一事实来源，屏幕上的字早没了，日志还在。 */
  function replay() {
    const lines = ctx.session.list()
    console.log(`\n=== 日志全量（${lines.length} 条）===`)
    for (const line of lines) {
      console.log(`#${line.seq} [${line.type}] ${describe(line)}${opNote(line)}`)
    }

    const messages = ctx.session.deriveMessages()
    console.log(`\n=== 模型看到的历史（折叠后 ${messages.length} 条）===`)
    for (const message of messages) {
      console.log(`[${message.role}] ${message.content}`)
    }
  }

  /** 压缩标记只在日志里可见，模型那一侧看不到。 */
  function opNote(line: SessionLine): string {
    const op = line.surfaceOp
    if (op === undefined || op === 'append') return ''
    return `　← replace #${op.startSeq}~#${op.endSeq}`
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
