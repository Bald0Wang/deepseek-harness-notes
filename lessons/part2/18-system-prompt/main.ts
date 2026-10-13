import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from './llm.ts'
import type { SessionEventLine } from './session.ts'
import { SECTION_ORDER } from './system-prompt.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 用户说了一句话，agent 处理一轮。 */
    'agent/turn'(input: string): void
  }
}

export const name = 'agent'
export const inject = ['llm', 'tools', 'sessionLog', 'systemPrompt']

/** 一轮对话里模型给出的指令：要么说话，要么调工具。 */
type ModelTurn =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; id: string; name: string; args: Record<string, unknown> }

/** 上一轮递出去的提示词，用来判断"变没变"。 */
let lastSystem = ''
/** 上一版提示词落在日志的哪一行，换新版时把它顶掉。 */
let lastSystemSeq: number | undefined
/** 身份段的销毁器：换提示词时先撤掉旧的那一段。 */
let disposeIdentity: (() => void) | undefined

/**
 * Consumer：agent loop 的第六版。
 *
 * 前面五版一直在解决"模型知道什么"：工具（12）、失败（13）、
 * 历史（14~15）、长度（16）、跨进程（17）。
 * 本课补上另一半：**谁在告诉模型它该是谁。**
 */
export function apply(ctx: Context) {
  ctx.on('agent/turn', (input) => { void run(input) })

  // 身份：这段话不随对话变化，每一轮请求都带上
  disposeIdentity = ctx.systemPrompt.section({
    name: 'agent:identity',
    order: SECTION_ORDER.identity,
    text: '你是一个天气助手，只回答天气相关的问题。',
  })
  // 人设：部署方给定的行为准则。真身里这来自 cordis.yml 的 personaPrefix
  ctx.systemPrompt.section({
    name: 'agent:persona',
    order: SECTION_ORDER.persona,
    text: '回答时语气礼貌，不确定就明说。',
  })
  // 工具清单：**函数形式**，每轮请求现算。
  // 它注册时天气工具还没注册进来（cordis.yml 里 weather.ts 排在前面的错觉：
  // 真正决定顺序的是依赖拓扑，写插件的人控制不了）。
  // 所以这里给的不是一串文本，是一个"被问到才去 ctx.tools 拿"的函数。
  ctx.systemPrompt.section({
    name: 'agent:tools',
    order: SECTION_ORDER.tools,
    text: () => ctx.systemPrompt.renderTools(ctx.tools.schemas()),
  })
  // 每次提示词变了都报一声——注册表通知，不是启动时假设
  ctx.on('system-prompt/change', () => {
    console.log(`[提示词变更] 现在共 ${ctx.systemPrompt.assemble().length} 字`)
  })
  ctx.on('tools/change', () => {
    console.log(`[工具清单变更] 现在共 ${ctx.tools.schemas().length} 个工具`)
  })

  setTimeout(() => ctx.emit('agent/turn', '北京天气怎么样？'), 50)
  setTimeout(() => ctx.emit('agent/turn', '帮我写一首诗'), 150)
  // 第三轮之前临时给助手扩权：提示词是注册表，能中途改写
  setTimeout(() => { widenScope() }, 300)
  setTimeout(() => ctx.emit('agent/turn', '帮我写一首诗'), 400)
  setTimeout(() => replay(), 500)

  /**
   * 把身份段换掉：从"只回答天气"改成"天气助手，也能闲聊"。
   *
   * 用的是 `ctx.effect()` 的返回——上一段注册的销毁器。
   * 提示词从此刻起变成新算出来的那份，不需要重启进程。
   */
  function widenScope() {
    console.log('\n=== 改写身份段：允许闲聊 ===')
    disposeIdentity?.()
    disposeIdentity = ctx.systemPrompt.section({
      name: 'agent:identity',
      order: SECTION_ORDER.identity,
      text: '你是一个天气助手，主要回答天气，但也能闲聊几句。',
    })
  }

  async function run(input: string) {
    console.log(`\n=== 用户说：${input} ===`)
    ctx.sessionLog.append({ type: 'user/message', data: { content: input } })

    // 关键一行：提示词不是谁写死的一个常量，是从注册表现算的
    const system = ctx.systemPrompt.assemble()
    // 提示词变了：新起一条 system 行，并且**顶掉上一版**。
    // 它不随对话变化，每轮都写一份会把日志灌满；而变化本身是重要事件，必须留痕。
    // 顶掉用 op: 'replace'（第 16 课那套）——日志里旧版还在，模型只看得见最新版。
    if (system !== lastSystem) {
      ctx.sessionLog.append(
        { type: 'system/message', data: { content: system } },
        lastSystemSeq === undefined ? 'append' : { op: 'replace', startSeq: lastSystemSeq, endSeq: lastSystemSeq },
      )
      lastSystem = system
      lastSystemSeq = ctx.sessionLog.list().at(-1)?.seq
    }

    // 再关键一行：messages 不是手搓的，是从日志折出来的——连同 system 一起
    const options: GenerateOptions = { messages: ctx.sessionLog.deriveMessages() }
    const turn = await collect(ctx.llm.stream(options))

    switch (turn.kind) {
      case 'text':
        console.log(`[模型回答] ${turn.text}`)
        ctx.sessionLog.append({ type: 'assistant/message', data: { text: turn.text } })
        break

      case 'tool-call': {
        console.log(`[模型决定] 调用 ${turn.name}，参数 ${JSON.stringify(turn.args)}`)
        // 注意：arguments 存的是模型吐出的**原始字符串**，不是我们 parse 后的对象
        ctx.sessionLog.append({
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
      ctx.sessionLog.append({
        type: 'tool/result',
        data: { callId: call.id, name: call.name, value: result.value, isError: false },
      })

      // 工具结果有了，再问模型一次，让它说人话——这次它看得见刚才的调用和返回
      const follow = await collect(ctx.llm.stream({ messages: ctx.sessionLog.deriveMessages() }))
      if (follow.kind === 'text') {
        console.log(`[模型回答] ${follow.text}`)
        ctx.sessionLog.append({ type: 'assistant/message', data: { text: follow.text } })
      }
    } else {
      console.log(`[工具失败] ${result.error}`)
      ctx.sessionLog.append({
        type: 'tool/result',
        data: { callId: call.id, name: call.name, value: result.error, isError: true },
      })
    }
  }

  /** 重放：日志是唯一事实来源，屏幕上的字早没了，日志还在。 */
  function replay() {
    const lines = ctx.sessionLog.list()
    console.log(`\n=== 日志全量（${lines.length} 条）===`)
    for (const line of lines) {
      console.log(`#${line.seq} [${line.type}] ${describe(line)}`)
    }

    const messages = ctx.sessionLog.deriveMessages()
    console.log(`\n=== 第二轮请求时模型看到的历史（${messages.length} 条）===`)
    for (const message of messages) {
      console.log(`[${message.role}] ${message.content}`)
    }
  }

  function describe(line: SessionEventLine): string {
    switch (line.type) {
      case 'user/message':
        return line.data.content
      case 'assistant/message':
        return line.data.text
      case 'tool/call':
        return `${line.data.name}(${line.data.arguments})`
      case 'tool/result':
        return line.data.isError ? `失败：${String(line.data.value)}` : String(line.data.value)
      case 'system/message':
        return line.data.content
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
