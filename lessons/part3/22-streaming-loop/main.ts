import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from './llm.ts'
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
 * Consumer：agent loop 的第五版。
 *
 * 前三版跑完就忘（或者只记得自己那次）。第四版补上**能力协商**：
 * 这个插件声明了自己要 `llm`、`tools`、`session` 三项能力，cordis 就
 * 替我们盯着它们。齐了才启动，缺了就 FAILED——而不是等第一次用的
 * 时候才炸。
 *
 * 本版（第五版）的主题是**流式**：不再等模型把整句话说完，
 * 每收到一片 text-delta 就立刻打到屏幕上。协议一个字没改，
 * 改的是"什么时候用"。
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
  } else {
    console.log('=== 没有找到历史，开一个新会话 ===')
  }

  /**
   * 三轮对话，串行不并行。
   *
   * 上一课这里是三个 setTimeout，间隔 50ms——因为那一轮的
   * 模型是"瞬间吐完"的，50ms 足够跑完一整轮。
   * 本课不行了：**一轮现在要花几百毫秒**（几十片 × 60ms），
   * 50ms 后第二轮就会插进来，屏幕上三行字互相穿插，
   * 日志的 seq 也会因为两个 run 同时 append 而错乱。
   *
   * 所以改成 await 一个、再 await 下一个。
   * 这不是"流式特有的麻烦"，而是**任何异步流水线的通用纪律**：
   * 只要一步变慢了，原本靠"猜时间"排的队就会撞车。
   * 真正的排队方式是等前一个真的做完。
   */
  void (async () => {
    if (restored > 0) {
      await run('刚才我问了什么？')
    } else {
      await run('北京天气怎么样？')
      await run('帮我算 7*6')
      await run('你好')
      // 三轮聊完，把 #1~#10 折成一条摘要。
      // endSeq 必须是**摘要之前最后一条记录**（#10）：摘要自己落在 #11，
      // 它还没进日志，写 11 会让"找终点"的那一步落空，压缩被静默跳过。
      compact(1, 10, '（摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。')
    }
    reportCapabilities()
    replay()
  })()

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

  async function run(input: string) {
    console.log(`\n=== 用户说：${input} ===`)
    ctx.session.append({ type: 'user/message', data: { content: input } })

    // 关键一行：messages 不是手搓的，是从日志折出来的
    const options: GenerateOptions = { messages: ctx.session.deriveMessages() }
    const turn = await stream(ctx, options)

    switch (turn.kind) {
      case 'text':
        // 正文连标签一起在 stream() 里打完了，这里只写日志。
        // 上一课是 `console.log('[模型回答] ' + turn.text)` 整句一次打完；
        // 流式之后**不能再打一遍正文**——用户会看到同一个句子出现两次。
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
      const follow = await stream(ctx, { messages: ctx.session.deriveMessages() })
      if (follow.kind === 'text') {
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
 * 流式消费：每收到一片就打印，同时把碎片拼回整块。
 *
 * 和第 09 课的 `for await` 打印相比，这里多了一件事：
 * **打印和拼装同时进行。** 用户看到字一个个蹦出来（体验），
 * 日志拿到的是拼好的完整块（正确性）——两者不冲突，
 * 因为 text-delta 的拼接就是字符串相加，来一片加一片。
 *
 * 注意 `process.stdout.write` 而不是 `console.log`：
 * log 每次调用都自带换行，会把一行字拆成很多行。
 * 流式的要点就是**不换行**，直到块结束。
 *
 * `[模型回答]` 这个标签也在本函数里打，而且只在第一片正文到来时
 * 打一次。标签是"事前"的：它得和正文出现在同一行，事后再补
 * 就只能另起一行贴在后面，读起来像是另一个句子。
 */
async function stream(ctx: Context, options: GenerateOptions): Promise<ModelTurn> {
  // index → 已拼接的文本/参数
  const texts = new Map<number, string>()
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  // 这一轮有没有往屏幕上写过正文？工具调用那一轮一个字都不写，
  // 结尾就不能补换行——否则会多出一个空行。
  // reasoning-delta 不算正文：它没有标签，也不参与换行判断。
  let wroteText = false

  for await (const chunk of ctx.llm.stream(options)) {
    switch (chunk.type) {
      case 'text-delta':
        texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
        // 第一片正文先亮标签，正文跟在它后面一个字一个字蹦出来
        if (!wroteText) {
          process.stdout.write('[模型回答] ')
          wroteText = true
        }
        process.stdout.write(chunk.text)
        break
      case 'reasoning-delta':
        // 思考过程：本课的假模型不产出它，但真模型会。
        // 打印出来让"流式"这件事更明显——它是先于正文出现的。
        process.stdout.write(chunk.text)
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
          // 工具参数拼完了，这里就是"模型说完话了"的时刻
          process.stdout.write('\n')
          return { kind: 'tool-call', id: chunk.block.id, name: chunk.block.name, args: parseArgs(chunk.block.arguments) }
        }
        break
      case 'usage':
        break
      case 'finish':
        break
      default:
        break
    }
  }

  const text = [...texts.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join('')
  // 正文逐字打完，补一个换行，让后面的 === 用户说 === 从新行开始
  if (wroteText) process.stdout.write('\n')
  return { kind: 'text', text }
}

/**
 * 上一课的 `collect(stream)` 长这样：
 *
 * ```ts
 * async function collect(stream: AsyncIterable<StreamChunk>): Promise<ModelTurn> {
 *   for await (const chunk of stream) { texts.set(chunk.index, ...) }
 *   return { kind: 'text', text: ... }
 * }
 * ```
 *
 * 它和上面这个函数的唯一区别：收完所有 chunk 才返回，
 * 所以手里没有任何东西可打——只能等整句话到齐再显示。
 * 流式和非流式的分界线**不在协议，在消费时机**：
 * 协议两边一模一样（都是 StreamChunk），差别只在
 * "我是在 yield 的那一刻用它，还是在流结束之后用它"。
 */

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
