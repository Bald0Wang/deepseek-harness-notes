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
 * Consumer：agent loop 的第三版。
 *
 * 第 12 课的 `executeTool` 只有四行：调一下，打印结果。
 * 但那四行把**三种完全不同的失败**混成了同一行 `[工具失败] xxx`：
 *
 *   1. 工具不存在——模型编了个名字，或者工具插件被卸载了
 *   2. 参数不合法——模型漏传了必填字段
 *   3. 工具自己炸了——网络超时、空指针，什么都可能
 *
 * 本课把这三件事分开。分开不是为了好看，是因为**处理方式完全不同**：
 * 参数不合法该把报错喂回模型让它重写，工具自己炸了才该重试。
 */
export function apply(ctx: Context) {
  ctx.on('agent/turn', (input) => { void run(input) })

  setTimeout(() => ctx.emit('agent/turn', '北京天气怎么样？'), 50)
  setTimeout(() => ctx.emit('agent/turn', '上海天气怎么样？'), 150)
  setTimeout(() => ctx.emit('agent/turn', '火星天气如何？'), 400)
  setTimeout(() => ctx.emit('agent/turn', '帮我搜索上海天气'), 700)

  async function run(input: string) {
    console.log(`\n=== 用户说：${input} ===`)

    const options: GenerateOptions = {
      messages: [{ role: 'user', content: input }],
    }
    const turn = await collect(ctx.llm.stream(options))

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

  /**
   * 执行工具：分失败类型，各自走各自的路。
   *
   * 注意这里没有 try/catch——`ctx.tools.call` 承诺**不往外抛**，
   * 任何失败都收进 `{ ok: false, error }` 里（见 [tools.ts](./tools.ts) 的
   * 抽象方法注释）。失败是返回值，不是异常，所以才能被 switch。
   */
  async function executeTool(call: Extract<ModelTurn, { kind: 'tool-call' }>) {
    const result = await ctx.tools.call(call.name, call.args)

    if (result.ok) {
      console.log(`[工具返回] ${String(result.value)}`)
      return
    }

    // 走到这儿就是失败了。失败也分三种，先看是哪一种。
    const kind = classifyFailure(result.error)

    switch (kind) {
      case 'unknown-tool':
        // 模型编了个名字。这不是工具的错，是模型的错——
        // 要把名册递过去，让它重新挑一个。
        console.log(`[工具不存在] ${call.name}`)
        reportToModel(`工具 ${call.name} 不存在。可用的工具：${ctx.tools.list().map((t) => t.name).join('、')}`)
        break

      case 'invalid-args':
        // 模型参数写错了。同样该它自己改。
        console.log(`[参数不合法] ${result.error}`)
        reportToModel(result.error)
        break

      case 'crashed':
        // 工具自己炸了。这可能只是暂时的——重试一次。
        console.log(`[工具异常] ${result.error}`)
        await retry(call)
        break
    }
  }

  /**
   * 从错误文本判断失败类型。
   *
   * 教学简化：harness 真身不看字符串，而是让每种失败带一个**结构化的**
   * `info: { name, code, reason }`（[packages/core/tools/src/index.ts 第 489 行]
   * (../../../deepseek-harness/packages/core/tools/src/index.ts#L489)），
   * 重试、沙箱、重放代码据此分流。字符串匹配只是我们的便宜替代——
   * 真实项目里请用结构化错误码，别学这段。
   *
   * 我们这三条错误文本分别来自：
   *   "工具不存在：x"   ← provider.ts 的 MapTools.call
   *   "invalid arguments: ..." ← json-schema.ts 的 ToolArgsError
   *   其余              ← 工具 execute 自己 throw 的，被 provider.ts 接住
   */
  function classifyFailure(error: string): 'unknown-tool' | 'invalid-args' | 'crashed' {
    if (error.startsWith('工具不存在')) return 'unknown-tool'
    if (error.startsWith('invalid arguments')) return 'invalid-args'
    return 'crashed'
  }

  /**
   * 把失败原因告诉模型，让它自己决定下一步。
   *
   * 真模型收到这段会重新组织一次工具调用；我们的假模型只会复读。
   * 但**接口是对的**——错误信息要回到模型面前，而不是只打在屏幕上。
   */
  function reportToModel(message: string) {
    const follow = collect(ctx.llm.stream({
      messages: [
        { role: 'user', content: '（系统提示）' },
        { role: 'assistant', content: `工具调用失败：${message}` },
        { role: 'user', content: '请根据失败原因重新尝试。' },
      ],
    }))
    void follow.then((turn) => {
      if (turn.kind === 'text') console.log(`[模型回应] ${turn.text}`)
    })
  }

  /** 工具自己炸了：等一下再试一次。 */
  async function retry(call: Extract<ModelTurn, { kind: 'tool-call' }>) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const again = await ctx.tools.call(call.name, call.args)
    if (again.ok) {
      console.log(`[重试成功] ${String(again.value)}`)
    } else {
      console.log(`[重试也失败] ${again.error}`)
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
