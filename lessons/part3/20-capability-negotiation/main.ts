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
 * 前三版跑完就忘（或者只记得自己那次）。本课补上**能力协商**：
 * 这个插件声明了自己要 `llm`、`tools`、`session` 三项能力，cordis 就
 * 替我们盯着它们。齐了才启动，缺了就 FAILED——而不是等第一次用的
 * 时候才炸。
 */
export function apply(ctx: Context) {
  ctx.on('agent/turn', (input) => { void run(input) })
  ctx.on('agent/compact', (fromSeq, toSeq, summary) => { compact(fromSeq, toSeq, summary) })

  // 启动第一件事：报告从磁盘恢复了什么
  const restored = ctx.session.restoredCount
  if (restored > 0) {
    console.log(`=== 从磁盘恢复了 ${restored} 条记录，seq 接着 #${ctx.session.list().at(-1)?.seq ?? 0} 往下编 ===`)
    console.log('=== 模型看到的历史 ===')
    for (const message of ctx.session.deriveMessages()) {
      console.log(`[${message.role}] ${message.content}`)
    }
    // 恢复之后直接问一个需要历史才能答的问题
    setTimeout(() => ctx.emit('agent/turn', '刚才我问了什么？'), 50)
  } else {
    console.log('=== 没有找到历史，开一个新会话 ===')
    setTimeout(() => ctx.emit('agent/turn', '北京天气怎么样？'), 50)
    setTimeout(() => ctx.emit('agent/turn', '帮我算 7*6'), 100)
    setTimeout(() => ctx.emit('agent/turn', '你好'), 150)
    // 三轮聊完，把 #1~#10 折成一条摘要。
    // endSeq 必须是**摘要之前最后一条记录**（#10）：摘要自己落在 #11，
    // 它还没进日志，写 11 会让"找终点"的那一步落空，压缩被静默跳过。
    setTimeout(() => ctx.emit('agent/compact', 1, 10, '（摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。'), 200)
  }
  setTimeout(() => replay(), 400)

  /**
   * 工具清单：等注册表通知，不自己猜时机。
   *
   * 为什么不能在 apply 函数体里直接 `ctx.tools.schemas()`？因为 cordis 按
   * **依赖拓扑**排插件的加载顺序：agent 声明了 `inject: ['llm','tools','session']`，
   * 它要的三个服务必须先把 provider 建好，所以 agent 的 apply 排在 provider
   * 之后、**但排在 weather-tool / calc-tool 之前**——后两者只 inject 了
   * `tools`，拓扑上没人催它们，就按 cordis.yml 的顺序落到最后。
   *
   * 也就是说：apply 函数体执行的那一刻，注册表**恰好是空的**。
   * 而这个顺序由依赖关系决定，写 yml 的人控制不了。
   * 所以"现在有哪些工具"这件事，只能等注册表通知，不能自己数。
   *
   * 那为什么还要 `setTimeout` 包一层？因为插件是一个个加载的，
   * weather-tool 注册时会响一次，calc-tool 注册时又响一次。
   * 每次响都打印，就会打出两份不完整的清单。
   * 所以：**每次变化只重新排一次打印，等本轮事件循环安静下来再打**。
   */
  let scheduled = false
  ctx.on('tools/change', () => {
    if (scheduled) return
    scheduled = true
    setTimeout(printTools, 0)
  })

  function printTools() {
    console.log('=== 模型能选的工具 ===')
    for (const schema of ctx.tools.schemas()) {
      console.log(`- ${schema.name}：${schema.description}`)
    }
  }

  /**
   * 对账：我声明要的能力，注册表现在真的都有了吗？
   *
   * 这就是本课的主题。`ctx.fiber.inject` 是本插件声明的那张需求表，
   * `ctx.reflect.props` 是全应用登记过的服务名册。
   * 两边一减，缺谁一目了然——而且是在**启动阶段**减，不是等
   * 某次调用踩空了才炸。
   *
   * 注意它读的是 `props`（登记册），不是 `store`（实例）。
   * 登记册里有名字，不代表现在有实例——第 19 课的工具就是
   * 先登记、后注册的。缺名字才是真缺。
   */
  function reportCapabilities() {
    console.log('\n=== 能力对账 ===')
    for (const service of Object.keys(ctx.fiber.inject)) {
      const registered = Object.hasOwn(ctx.reflect.props, service)
      const status = registered ? '齐' : '缺'
      console.log(`- ${service}：${status}`)
      if (!registered) {
        console.log(`  没人提供 ${service}——cordis.yml 里少了一个 provider，或者它自己加载失败了`)
      }
    }
  }

  setTimeout(reportCapabilities, 300)

  async function run(input: string) {
    console.log(`\n=== 用户说：${input} ===`)
    ctx.session.append({ type: 'user/message', data: { content: input } })

    // 关键一行：messages 不是手搓的，是从日志折出来的
    const options: GenerateOptions = { messages: ctx.session.deriveMessages() }
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
   */
  function compact(fromSeq: number, toSeq: number, summary: string) {
    console.log(`\n=== 压缩：#${fromSeq}~#${toSeq} 折成一条摘要 ===`)
    const seq = ctx.session.append(
      { type: 'assistant/message', data: { text: summary } },
      { op: 'replace', startSeq: fromSeq, endSeq: toSeq },
    )
    console.log(`摘要落成 #${seq}，它顶掉了 #${fromSeq}~#${toSeq}`)
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
