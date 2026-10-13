import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, Usage } from './llm.ts'
import type { ToolResult } from './define-tool.ts'
import type { SessionLine } from './session.ts'
import { CHARS_PER_TOKEN, ROLE_OVERHEAD } from './token-meter.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 用户说了一句话，agent 处理一轮。 */
    'agent/turn'(input: string): void
    /** 把前面的轮次折叠成一条摘要。 */
    'agent/compact'(fromSeq: number, toSeq: number, summary: string): void
    /** 摘要生成开始（锁），折叠区间自此冻结。 */
    'agent/compact-begin'(fromSeq: number, toSeq: number): void
    /** 摘要生成结束（收尾），区间内不能再有别的东西落进来。 */
    'agent/compact-end'(fromSeq: number, toSeq: number, summarySeq: number): void
  }
}

export const name = 'agent'
export const inject = ['llm', 'tools', 'session', 'tokenMeter']

/**
 * 一次工具调用的时限，毫秒。
 *
 * 真身是 guard/timeout-policy：每个工具自己声明 `timeoutMs`，
 * 包装器 armed 这个期限，到点把 signal abort 掉，再把结果替换成
 * 一条结构化的 TOOL_TIMEOUT。教学版没法让假工具挂住，所以用
 * 一个统一的常量——但它演示的是同一件事：**等待必须有上限。**
 */
const TOOL_TIMEOUT_MS = 500

/**
 * 重复调用多少次算"没有进展"。
 *
 * 真身 repeat-tool-reminder 的默认阈值是 [3, 5, 8]：第一次温柔提醒，
 * 后面逐步升级到带工具名和参数详情的警告。教学版取 3，
 * 而且只演示"到阈值就提醒"这一档。
 */
const REPEAT_THRESHOLD = 3

/** 失败后最多再让模型试几次。递归没有头就会绕到天荒地老。 */
const MAX_RECOVERY_DEPTH = 2

/**
 * 上下文窗口，token。
 *
 * 真身里这是 adapter 的能力（`ctx.llm.resolveModelInfo().context.contextWindow`），
 * 每个模型自己声明。教学版的假模型没有这个字段，就摆一个常量——
 * 关键是**它是配置，不是算式里的魔法数**：换成 128k 只要改这一行。
 *
 * 这里摆 320 而不是 131072，是因为本课的剧本只有四轮，
 * 按真实窗口算到天荒地老也压不了一次——那样"预算告急"这条路
 * 在输出里根本看不见。缩小 400 倍，阈值 256 落在第四轮头上
 * （前三轮 163 / 197 / 246），正好只压一次。
 */
const CONTEXT_WINDOW = 320

/**
 * 压力阈值：请求估算超过窗口的这个比例就触发压缩。
 *
 * 真身 compaction-basic 的 `thresholdRatio` 默认 0.8——
 * 不等到塞满，留 20% 给回答和抖动。320 × 0.8 = 256。
 */
const THRESHOLD_RATIO = 0.8

/**
 * 保留窗口：压缩时原样留下最近这么多 token 的对话。
 *
 * 真身叫 `retainTokens`（或按 `retainRatio` 折算）。为什么必须留？
 * 因为**最近几句几乎必然和当前这轮有关**，折成摘要反而丢细节。
 * 默认 0.16——窗口的 16%，这里折算成 40 是为了让本课的剧本
 * 真的压上一次、看得见效果。
 */
const RETAIN_TOKENS = 40

/**
 * 摘要请求自己的输出上限，token。
 *
 * 真身 compaction-basic 的 `summarizationMaxTokens`。注意它是
 * **单独一项配置**，不跟着主请求的 maxTokens 走——摘要要的是
 * "够用就好"，写长了反而压不下预算。
 */
const SUMMARY_MAX_TOKENS = 128

/** 摘要正文的开闭标签。真身是 `<compacted-summary>`。 */
const SUMMARY_OPEN_TAG = '<summary>'
const SUMMARY_CLOSE_TAG = '</summary>'

/**
 * 压缩指令：作为最后一条 user 消息追加在被折历史后面。
 *
 * 真身叫 `COMPACTION_INSTRUCTION`，是一段七段式 Markdown 模板
 * （Primary Request and Intent / Key Technical Concepts / Files and Code /
 * Errors and Fixes / Pending Jobs / Current Work / Next Step /
 * Critical Context）。教学版缩成四段——**结构本身才是重点**：
 * 分段逼模型分门别类地回忆，不分段它就吐一段流水账，
 * 而流水账里"用户最初要什么"和"刚才在试什么"是混在一起的。
 *
 * 注意它是**消息**，不是 system prompt：追加在被折历史的末尾，
 * 让 provider 的 KV cache 还能命中前面那段前缀。
 */
const COMPACTION_INSTRUCTION = [
  'You are a compaction engine. Condense the conversation ABOVE into a checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the structure below, and wrap it in <summary> ... </summary> tags:',
  '',
  '## Primary Request and Intent',
  '- [用户最初的目标，以及它有没有变过]',
  '',
  '## Current Work',
  '- [此刻进行到哪一步，最近一次交互是什么]',
  '',
  '## Next Step',
  '- [接下来该做的那一件事]',
  '',
  'Rules: 用中文写要点，不要写段落。保留确切的文件路径、命令、错误字符串和数字。不要提"这是一次压缩"，也不要调用任何工具。',
].join('\n')

/**
 * 落盘关卡的触发点。
 *
 * 真身是 `session-checkpoint-policy`，三处 await `session/flush`：
 * `llm/stream`（流构造前）、`tools/execute`（顶层工具 body 前）、
 * `agent/pre-step`。三处的共同理由：**危险动作发生之前，
 * 日志必须先已经在盘上**。请求发出去、工具跑起来，进程随时
 * 可能死；死了之后能拿来还原现场的只有盘上的东西。
 *
 * 教学版只挑最要紧的一处：模型请求发出之前。工具的假执行
 * 是同步返回的，放在那里只会刷屏。
 */
const FLUSH_BEFORE_REQUEST = true

/**
 * 系统提示。
 *
 * 26 课及之前，`measureRequest()` 里的 `systemTokens` 恒 0——
 * 账本上一直有这一项，从来没有人往里写过一个字。本课第一次
 * 真的有系统提示：**它不是一条消息，是请求体上一个独立的
 * 顶层字段**（见 real-provider.ts 的 `WireRequest.system`）。
 *
 * 真身这里是一整套（角色卡、工具使用规范、环境信息），而且
 * 按模型的 `systemPromptUpdate` 策略决定要不要进历史。
 * 教学版只写一句，够说明"它不在 messages 里"这件事。
 */
const SYSTEM_PROMPT = [
  '你是 deepseek-harness 教学版的助手，用中文回答。',
  '需要外部数据时调用工具，不要编造。',
].join('\n')

/**
 * 一轮对话里模型给出的指令：要么说话，要么调工具。
 */
type ModelTurn =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; id: string; name: string; args: Record<string, unknown> }

/**
 * Consumer：agent loop 的第十版。
 *
 * 前四版跑完就忘。第五版补上**能力协商**：这个插件声明了自己要
 * `llm`、`tools`、`session`、`tokenMeter` 四项能力，cordis 就替我们
 * 盯着它们。第六版的主题是**流式**：每收到一片 text-delta 就立刻
 * 打到屏幕上。第七版的主题是**错误恢复**：工具失败了，这一轮不能
 * 就这么散了。第八版的主题是**让模型自己写摘要**。第九版的主题是
 * **看见 session 的一生**。
 *
 * 本版（第十版）的主题是**接真 API**。而这一版最反直觉的地方是：
 * **本文件几乎没改**。改了的是 `llm.ts`（多了两个字段）、
 * `real-provider.ts`（新文件）、`session.ts`（callId 透传）和
 * `token-meter.ts`（导出两个常量）——Consumer 这边只多了
 * system/tools 的透传和一次 usage 分账。
 *
 * 这正是第 01 课那个 capability seam 的意义：Provider 从 if 换成
 * HTTP，Consumer 不知道。
 */
export function apply(ctx: Context) {
  ctx.on('agent/turn', (input) => { void run(input) })
  ctx.on('agent/compact', (fromSeq, toSeq, summary) => { compact(fromSeq, toSeq, summary) })

  // 本课新增：听 session 的一生。四条事件各管一个阶段，
  // 合起来就是"一个会话从问世到入土"的完整轨迹。
  //
  // 注意这里读的还是 `restoredCount`，不是等 `session/created`
  // 送过来——因为 **provider 先加载、我们后加载**（inject 的
  // 拓扑序），session 问世时我们还没出生，那条事件听不到。
  // 这是 cordis 的一个通用事实：**监听只能从现在开始，之前
  // 发生的事要靠别的方式补**。
  let events = 0
  ctx.on('session/created', (_session, restored) => {
    // 本课的剧本里这条走不到：agent 比 session 晚加载。
    // 留着它是为了让"为什么听不到"这件事有地方对照。
    console.log(`[session 一生] 问世（恢复 ${restored} 条）`)
  })
  ctx.on('session/event', (_session, line) => {
    events += 1
    console.log(`[session 一生] #${line.seq} ${line.type} 落定（累计 ${events} 条）`)
  })
  ctx.on('session/flush', async () => {
    // 这是 await 型事件：监听器返回的 Promise 会被
    // ctx.parallel 一起等完。所以这里"打一行字"这件事
    // 是真的会拖慢调用方的——不能在里面干重活。
    console.log('[session 一生] 落盘关卡：日志已全部在盘上')
  })
  ctx.on('session/disposed', (_session) => {
    console.log(`[session 一生] 入土（一生共 ${events} 条记录）`)
  })

  // 区间锁：25 课声明了这两条事件却没有任何人听，本课补上。
  //
  // 真身在 begin 和 end 两端各挂一个断言：
  // `assertSelectedSpanStable`（摘要生成期间，选中的区间
  // 一条都不许动）和 `assertWholeSurfaceUnchanged`（除了
  // 摘要那一行，别的地方也不许动）。教学版的循环是串行
  // await 的，期间确实没有别人能插进来——所以这两条
  // 事件现在是**纯观测**。但监听它们的位置，就是真身
  // 放不变量检查的位置：看得见。
  ctx.on('agent/compact-begin', (fromSeq, toSeq) => {
    console.log(`[区间锁] #${fromSeq}~#${toSeq} 冻结，开始生成摘要`)
  })
  ctx.on('agent/compact-end', (fromSeq, toSeq, summarySeq) => {
    console.log(`[区间锁] 解冻：区间收成 #${summarySeq}，#${fromSeq}~#${toSeq} 就此退出模型视野`)
  })

  // 收尾：进程要退了，把 session 埋了。
  //
  // 为什么用 `ctx.effect` 而不是 `ctx.on('dispose')`？因为 cordis
  // 没有 `'dispose'` 这个事件——清理的钩子是 `ctx.effect(() => () => ...)`
  // 的**返回值**：插件卸载时它逆序执行。这就是第 02 课的
  // "注册即效果"：注册一个动作，同时注册它的撤销。
  //
  // 顺序上它一定跑在 session 服务被拆之前吗？不一定。cordis 按
  // 反序卸载 fiber，而 agent 比 session 晚加载，所以 agent 的
  // effect 先跑——**在本课的这个配置下**成立。真身不需要操心
  // 这个：SessionStore 自己管生命周期，`session/disposed` 由
  // store 在会话离开时广播，不劳别人。
  ctx.effect(() => () => { ctx.session.dispose() }, 'session.dispose')

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
   * 第七课这里是三个 setTimeout，间隔 50ms——因为那一轮的
   * 模型是"瞬间吐完"的，50ms 足够跑完一整轮。
   * 第七课不行了：**一轮现在要花几百毫秒**（几十片 × 60ms），
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
      // 三轮下来日志已经 12 条，而第四轮"你好"会把预算推过阈值——
      // 它一开始 compactIfNeeded 就会自动折一次，这里不手写了。
      // 23 课那句写死的 compact() 删掉：它折的 #1~#12 已经被自动压缩
      // 覆盖，再折一次 endSeq 落空，压缩会被静默跳过。
    }
    reportCapabilities()
    replay()

    // 落幕：把这个会话埋了。
    //
    // 为什么显式调用，而不是等插件卸载？卸载的时机不由我们定，
    // 而且 fiber 一拆，挂在它上面的监听器跟着被摘掉——
    // `session/disposed` 可能刚发出来就已经没人听了。
    // 显式调用完全确定：发事件的这一刻，听事件的那四条
    // 监听器全都活着。
    //
    // `ctx.effect` 里那个清理钩子仍然留着：它管的是**另一种**
    // 收场——插件被卸载（真身的 store 关会话走的就是这条）。
    // 两条路都通向 dispose()，所以它必须幂等：
    // 第二次调用什么都不做。
    ctx.session.dispose()
  })()

  /**
   * 工具清单：等注册表通知，不自己猜时机。
   *
   * 为什么不能在 apply 函数体里直接 `ctx.tools.schemas()`？因为 cordis 按
   * **依赖拓扑**排插件的加载顺序：agent 声明了 `inject: ['llm','tools','session','tokenMeter']`，
   * 它要的服务必须先把 provider 建好，所以 agent 的 apply 排在 provider
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
   * 这就是第 20 课的主题。`ctx.fiber.inject` 是本插件声明的那张需求表，
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

    // 关键一行：messages 不是手搓的，是从日志折出来的。
    // 它每轮都要重新折一次——历史随时可能在压缩中变短。
    //
    // 27 课新增两样**不在 messages 里**的东西：system 和 tools。
    // 它们每轮都一样，但每轮都要发——清单是请求的一部分，
    // 压不掉也得算钱（见 toolsTokens）。
    const options: GenerateOptions = {
      messages: ctx.session.deriveMessages(),
      system: SYSTEM_PROMPT,
      tools: ctx.tools.schemas(),
    }

    // 第七课新增：发出请求之前，先算一次账。
    // 注意顺序——**先折、再量、后问**。预算永远基于
    // 这一轮真正要发出去的那个 messages，不是历史总量。
    await compactIfNeeded(options)
    measureRequest(options)

    // 本课新增：请求出门之前，先让日志落盘。
    //
    // 真身 checkpoint-policy 把这个动作做成**策略插件**，
    // 在 llm/stream 构造前 await `session/flush`——agent loop
    // 自己一行都不写。教学版直接调 `ctx.session.flush()`，
    // 效果一样：`session/flush` 事件被 parallel 出去，
    // 所有监听器做完，请求才发。
    //
    // 为什么非做不可？请求一离开进程，我们就把控制权交出去了：
    // 网络可能断，进程可能被杀，机器可能断电。**能证明
    // "我们问过什么"的，只有盘上那条日志。**
    if (FLUSH_BEFORE_REQUEST) {
      ctx.session.flush()
    }

    const turn = await stream(ctx, options)

    switch (turn.kind) {
      case 'text':
        // 正文连标签一起在 stream() 里打完了，这里只写日志。
        // 第六课是 `console.log('[模型回答] ' + turn.text)` 整句一次打完；
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

  /**
   * 执行一次工具调用，失败后**把失败喂回模型**。
   *
   * 第七课这里是个 if/else：成功就问一次模型，失败就打印+记日志，
   * 然后 run() 返回——这一轮就这么结束了，模型一个字都不知道。
   * 第七课补上另一半：**失败也是一次结果，模型有权看见它、换一个办法。**
   *
   * 这是真身 `packages/guard` 想解决的问题。`repeat-tool-reminder` 盯着
   * "模型用一模一样的参数反复调同一个工具"，`timeout-policy` 给工具
   * 装上时限。两件事的共同前提是：**失败必须回到对话里**，否则
   * 模型只会一遍遍重复同一个动作——它看不见别的东西。
   */
  async function executeTool(call: Extract<ModelTurn, { kind: 'tool-call' }>, depth = 0) {
    // 超时：给工具一个上限。真身是 guard/timeout-policy，工具自己声明
    // timeoutMs、honor exec.signal；教学版简化成统一的超时常量，
    // 用 AbortController 把"到点了"变成一个 signal。
    const abort = new AbortController()
    const timer = setTimeout(() => { abort.abort() }, TOOL_TIMEOUT_MS)
    let result: ToolResult
    try {
      result = await ctx.tools.call(call.name, call.args, abort.signal)
    } catch (error) {
      // 工具直接抛异常（不是返回失败）：第 19 课的注册表只兜 execute 里的错，
      // 这里兜的是"连注册表都没走完"的错。一样当失败处理，不能让它炸掉 loop。
      result = { ok: false, callId: call.id, name: call.name, error: describeError(error) }
    } finally {
      clearTimeout(timer)
    }

    if (result.ok) {
      console.log(`[工具返回] ${String(result.value)}`)
      ctx.session.append({
        type: 'tool/result',
        data: { callId: result.callId, name: result.name, value: result.value, isError: false },
      })

      // 工具结果有了，再问模型一次，让它说人话——这次它看得见刚才的调用和返回。
      // 第七课起，这些追问也走 compactIfNeeded：**模型每被问一次，就是一次请求。**
      const follow: GenerateOptions = {
        messages: ctx.session.deriveMessages(),
        system: SYSTEM_PROMPT,
        tools: ctx.tools.schemas(),
      }
      await compactIfNeeded(follow)
      if (FLUSH_BEFORE_REQUEST) {
        ctx.session.flush()
      }
      const turn = await stream(ctx, follow)
      if (turn.kind === 'text') {
        ctx.session.append({ type: 'assistant/message', data: { text: turn.text } })
      }
      return
    }

    // 失败路径：先看见，再判断要不要提醒，最后把话筒还给模型
    console.log(`[工具失败] ${result.error}`)
    ctx.session.append({
      type: 'tool/result',
      data: { callId: result.callId, name: result.name, value: result.error, isError: true },
    })

    // 重复检测：同样的工具+同样的参数，连续第几次了？
    const repeats = observeRepeat(call.name, JSON.stringify(call.args))
    if (repeats >= REPEAT_THRESHOLD) {
      // 这不是一条"给模型看的结果"，是一条**旁白**：提醒它换个办法。
      // 真身叫 additionalContexts，带 source 标签，渲染时不会冒充用户说的话。
      const notice = `你已经用同样的参数连续调了 ${repeats} 次 ${call.name}，这没有进展。换个工具、换些参数，或者直接告诉用户你做不到。`
      console.log(`[循环提醒] ${notice}`)
      ctx.session.append({ type: 'notice/message', data: { text: notice } })
    }

    // 失败之后也问一次模型。它看得见刚才的 tool/result（isError: true），
    // 有机会换一个工具、换一组参数，或者老实说"这个我办不到"。
    // **不问的话，这一轮就白失败了**——日志里多一行，对话里什么都没发生。
    const followUp: GenerateOptions = {
      messages: ctx.session.deriveMessages(),
      system: SYSTEM_PROMPT,
      tools: ctx.tools.schemas(),
    }
    await compactIfNeeded(followUp)
    if (FLUSH_BEFORE_REQUEST) {
      ctx.session.flush()
    }
    const recovery = await stream(ctx, followUp)
    switch (recovery.kind) {
      case 'text':
        ctx.session.append({ type: 'assistant/message', data: { text: recovery.text } })
        break
      case 'tool-call': {
        // 模型换了个办法。递归要有个头——超过重试上限就收手，
        // 否则一个坏工具能让它绕到天荒地老。
        if (depth >= MAX_RECOVERY_DEPTH) {
          console.log(`[放弃恢复] 已经重试 ${MAX_RECOVERY_DEPTH} 次，收手`)
          ctx.session.append({
            type: 'notice/message',
            data: { text: `恢复重试达到上限（${MAX_RECOVERY_DEPTH} 次），本轮结束。` },
          })
          return
        }
        ctx.session.append({
          type: 'tool/call',
          data: { callId: recovery.id, name: recovery.name, arguments: JSON.stringify(recovery.args) },
        })
        await executeTool(recovery, depth + 1)
        break
      }
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

  // ===== 第七课新增：上下文预算 =====

  /**
   * 量一次请求：把这一轮真正要发出去的东西折算成 token。
   *
   * 三个组成部分，对应真身 [token-meter](../../../deepseek-harness/packages/llm/token-meter/src/estimate.ts)
   * 的 `contextBreakdown`：
   *
   * 1. **工具清单**（toolsTokens）——`ctx.tools.schemas()` 序列化后的
   *    JSON Schema。这是最容易被忘掉的一块：两个工具的 schema 就能吃掉
   *    几百 token，而它们**每一轮都在**。
   * 2. **消息**（nodes）——`deriveMessages()` 折出来的历史。
   * 3. **系统提示**（systemTokens）——26 课及之前这里恒 0，因为从来
   *    没有系统提示。本课第一次真的算它：**它不在 messages 里，
   *    但一样花钱。**
   *
   * 只量 messages 不算账——那正是"日志进了请求"的误解。
   */
  function measureRequest(options: GenerateOptions) {
    const budget = ctx.tokenMeter.measure(options.messages, toolsTokens(), systemTokens())
    console.log(
      `[预算] 本次请求 ≈ ${budget.totalTokens} token`
      + `（消息 ${budget.totalTokens - budget.toolsTokens - budget.systemTokens}`
      + ` + 工具清单 ${budget.toolsTokens}`
      + ` + 系统提示 ${budget.systemTokens}`
      + `，窗口 ${CONTEXT_WINDOW}，阈值 ${thresholdTokens()}）`,
    )
  }

  /**
   * 系统提示占多少 token。
   *
   * 26 课这个函数不存在——那一行打印里写死 `+ 系统提示 0`。
   * 真身 `estimate.ts` 给 system 开了一条**不带 BLOCK_OVERHEAD**
   * 的岔路：系统提示序列化成一个纯字符串字段，不是带 type 标签的
   * 内容块。教学版照抄这条岔路，所以只有角色开销没有块开销。
   */
  function systemTokens(): number {
    return Math.ceil(SYSTEM_PROMPT.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD
  }

  /** 触发压缩的绝对 token 数。真身是 `floor(contextWindow × thresholdRatio)`。 */
  function thresholdTokens(): number {
    return Math.floor(CONTEXT_WINDOW * THRESHOLD_RATIO)
  }

  /**
   * 预算驱动：超了就先折历史，再发请求。
   *
   * 第七课的核心。压缩靠一句手写的 `compact(1, 12, '（摘要）…')`——
   * **人肉决定什么时候折、折哪一段**。第七课换成：量一下，超阈值就
   * 自动选一段折掉。
   *
   * 折哪一段的规则照抄真身
   * [selectCompactableRange](../../../deepseek-harness/packages/compaction/compaction-basic/src/region.ts)，
   * 四条红线一条不少：
   *
   * 1. **从尾部往前累加，够 `retainTokens` 就停**——最近的对话原样留着，
   *    因为它们和当前这轮最相关。
   * 2. **从 `#1` 起折**（`keepFromIdx > 1` 才动手）——系统提示在真身
   *    里是 surface 节点 0，永不进区间；教学版没有系统提示，但这条
   *    边界留着：真要加，它必须是第一条。
   * 3. **只折进过请求的行**（`surfaceOp !== undefined`）——`tool/call`
   *    和 `notice/message` 从没进过模型请求，折它们只会让 endSeq 落空。
   * 4. **保不住就整个收手**——连最近的几句都保不住，折掉一切等于清空
   *    历史，比不折更糟。
   *
   * 本课改的是折完之后那一步：摘要不再写死，而是
   * **再问一次模型，让它自己写**（见 summarize）。
   */
  async function compactIfNeeded(options: GenerateOptions) {
    // 口径和 measureRequest 完全一致：**含工具清单和系统提示。**
    // 真身 token-meter 的 `totalTokens = estimateToolsTokens(header) + surfaceTokens`
    // ——工具清单是请求的一部分，压不掉也得算钱。
    const budget = ctx.tokenMeter.measure(options.messages, toolsTokens(), systemTokens())
    if (budget.totalTokens < thresholdTokens()) return

    const lines = ctx.session.list()
    // 只考虑"进过请求"的行——notice 旁白和 tool/call 从没进过，
    // 折它们没有意义，而且 endSeq 会落空。
    const surface = lines.filter((line) => line.surfaceOp !== undefined)

    // 从尾部往前累加，保留最近 retainTokens 个 token。
    // 累加用的是日志行的估价，而阈值判的是请求的估价——
    // 两边同源（都是 tokenMeter），但别忘了 surface 里含 tool/result，
    // 请求里也一样含，口径一致。
    let accumulated = 0
    let keepFromIdx = surface.length
    for (let index = surface.length - 1; index >= 0; index -= 1) {
      const line = surface[index]
      if (line === undefined) break
      accumulated += ctx.tokenMeter.estimateMessage(toMessage(line))
      keepFromIdx = index
      if (accumulated >= RETAIN_TOKENS) break
    }

    // 红线四：保留的部分已经顶到开头，没什么可折的
    if (keepFromIdx <= 1) return

    const from = surface[0]
    const to = surface[keepFromIdx - 1]
    if (from === undefined || to === undefined) return

    console.log(
      `\n[预算告急] 历史 ≈ ${budget.totalTokens} token 超过阈值 ${thresholdTokens()}，`
      + `折掉 #${from.seq}~#${to.seq}，保留最近 ${accumulated} token`,
    )

    // 区间锁（本课接上）：25 课声明了这两条事件却没用，
    // 本课把它们接在"区间定下来"和"摘要落成"两端。
    //
    // 真身叫 `compaction/start` / `compaction/end`，配
    // `assertSelectedSpanStable` + `assertWholeSurfaceUnchanged`：
    // 摘要生成期间（要等一次模型请求，几百毫秒）整个 surface
    // 一条都不许动。教学版的循环是串行 await 的，期间确实
    // 没有别人能插进来——**所以这两条事件现在是纯观测**，
    // 没有断言在背后。但它们的**位置**就是真身的 invariants
    // 所在的位置，看得见。
    ctx.emit('agent/compact-begin', from.seq, to.seq)

    // 摘要由模型写。这一次请求**不过压力阈值**：阈值检查是为了
    // 避免无限压缩，而摘要请求只发一次、发完就完了。
    // 真身 summarizer.ts 里这个请求走的是同一个 `ctx.llm.stream()`，
    // 带 `purpose: 'compaction'` 和独立的 maxTokens。
    const summary = await summarize(from.seq, to.seq)

    const summarySeq = appendSummary(from.seq, to.seq, summary)
    ctx.emit('agent/compact-end', from.seq, to.seq, summarySeq)

    // 折完重新折一遍历史——options 是调用方传进来的引用，
    // 里面装的是旧的 messages，必须原地换掉，否则这一轮
    // 发的还是没折过的请求。
    const before = budget.totalTokens
    options.messages = ctx.session.deriveMessages()
    const after = ctx.tokenMeter.measure(options.messages, toolsTokens(), systemTokens())
    console.log(`[预算] 折完降到 ≈ ${after.totalTokens} token，省了约 ${before - after.totalTokens}`)
  }

  /**
   * 落一条摘要，返回它的 seq。
   *
   * 从 `compact()` 里拆出来，是为了让 `compact-end` 拿到
   * `summarySeq`——25 课的事件签名里就有这个参数，但那时候
   * 没有任何人发这条事件，参数一直是空口许诺。
   */
  function appendSummary(fromSeq: number, toSeq: number, summary: string): number {
    console.log(`\n=== 压缩：#${fromSeq}~#${toSeq} 折成一条摘要 ===`)
    const seq = ctx.session.append(
      { type: 'assistant/message', data: { text: summary } },
      { op: 'replace', startSeq: fromSeq, endSeq: toSeq },
    )
    console.log(`摘要落成 #${seq}，它顶掉了 #${fromSeq}~#${toSeq}`)
    return seq
  }

  /** 工具清单占多少 token。它每一轮都一样，但每一轮都要重新付。 */
  function toolsTokens(): number {
    const schemas = JSON.stringify(ctx.tools.schemas())
    return schemas.length === 0 ? 0 : Math.ceil(schemas.length / 4) + 4
  }

  // ===== 本课新增：让模型自己写摘要 =====

  /**
   * 把 [fromSeq, toSeq] 那段历史交给模型，要回一条摘要。
   *
   * 这是本课的核心。第七课这里是一句写死的话；本课换成一次真实的
   * 模型请求，形状照抄真身
   * [summarizer.ts](../../../deepseek-harness/packages/compaction/compaction-basic/src/summarizer.ts)：
   *
   * 1. **重放要被折掉的那段对话**，末尾追加一条压缩指令。
   *    指令是 user 角色、带 `<summary>` 开闭标签——真身叫
   *    `COMPACTION_INSTRUCTION`，七段式 Markdown 逼出结构化输出。
   * 2. **摘要请求也是一次 `stream()`**。它要过流式协议、要拼装、
   *    要处理 finish——和主循环那次请求用的是同一条管子。
   * 3. **从标签里抽正文**。模型偶尔会在 `<summary>` 前后多说两句
   *    客套话，抽标签比信任整段输出干净。
   *
   * 一次失败（没闭合标签、空摘要）就抛错——**摘要落空比摘要难看
   * 严重得多**：难看只是信息少，落空等于把历史扔了还骗你说折好了。
   */
  async function summarize(fromSeq: number, toSeq: number): Promise<string> {
    // 重放：把要折掉的那段历史原样发给模型，末尾追加压缩指令。
    // 注意这里重放的是**日志行**，不是 deriveMessages() 的产物——
    // 那段历史可能已经被 replace 过，我们要折的是它当前的样子。
    const replayed = ctx.session.list()
      .filter((line) => line.seq >= fromSeq && line.seq <= toSeq && line.surfaceOp !== undefined)
      .map(toMessage)

    const options: GenerateOptions = {
      messages: [
        ...replayed,
        { role: 'user', content: COMPACTION_INSTRUCTION },
      ],
      system: SYSTEM_PROMPT,
      // **摘要请求不带工具清单**：它要的是一段文字，给工具只会
      // 诱导它去调用，而且白付几百 token 的 schema。真身也一样——
      // summarizer 的请求里 tools 是空的。
      maxTokens: SUMMARY_MAX_TOKENS,
      purpose: 'compaction',
    }

    console.log('\n=== 摘要请求：让模型自己写 ===')
    const turn = await stream(ctx, options)
    if (turn.kind !== 'text') {
      throw new Error('摘要请求返回了工具调用——摘要只能是一段文字')
    }

    const summary = extractSummary(turn.text)
    if (summary.length === 0) {
      throw new Error('摘要为空：模型没有在 <summary> 标签里给出内容')
    }
    return summary
  }

  /**
   * 从模型输出里抽出 `<summary>` 标签中的正文。
   *
   * 真身 [summarizer.ts](../../../deepseek-harness/packages/compaction/compaction-basic/src/summarizer.ts)
   * 用 `<compacted-summary>` 开闭标签，外加一层 `CHECKPOINT_PREAMBLE`
   * 把摘要包成"已成事实的背景"。教学版只保留抽标签这一步。
   *
   * 标签没闭合就抛错，**不做宽容兜底**：兜底会把模型的客套话、
   * 复述的指令一起塞进摘要，那正是标签要防的东西。
   */
  function extractSummary(text: string): string {
    const open = text.indexOf(SUMMARY_OPEN_TAG)
    const close = text.indexOf(SUMMARY_CLOSE_TAG)
    if (open === -1 || close === -1 || close < open) {
      throw new Error(`摘要缺少闭合的 ${SUMMARY_OPEN_TAG} 标签：${text}`)
    }
    return text.slice(open + SUMMARY_OPEN_TAG.length, close).trim()
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
      case 'notice/message':
        return line.data.text
    }
  }
}

/** 把一条消息行翻译成计价器认识的形状。 */
function toMessage(line: SessionLine): { role: 'user' | 'assistant' | 'tool'; content: string } {
  switch (line.type) {
    case 'user/message':
      return { role: 'user', content: line.data.content }
    case 'assistant/message':
      return { role: 'assistant', content: line.data.text }
    case 'tool/result':
      return { role: 'tool', content: String(line.data.value) }
    case 'tool/call':
      return { role: 'assistant', content: line.data.name }
    case 'notice/message':
      return { role: 'assistant', content: line.data.text }
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
  // 这一轮真花了多少 token。**只有真模型会给出非零的数**——
  // mock 的 usage 是写死的 10/len，那是给教学版凑形状用的，
  // 不能当账。这就是"账单要靠 response 的 usage 分"的意思。
  let spent: Usage = { inputTokens: 0, outputTokens: 0 }

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
          reportUsage(options.purpose, spent)
          return { kind: 'tool-call', id: chunk.block.id, name: chunk.block.name, args: parseArgs(chunk.block.arguments) }
        }
        break
      case 'usage':
        spent = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens }
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
  // 分账放在 return 之前：不管这一轮是说话还是调工具，账单都要报。
  // 真模型的 usage 在流末尾才来（message_delta），而 block-end
  // 可能先到——所以 text 分支必须在这里报，不能只在 tool-call
  // 那条路径上报。
  reportUsage(options.purpose, spent)
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

/**
 * 把一次请求真实花掉的 token 报出来，按用途分开。
 *
 * 前 26 课没有这个函数——账本上从来没有"真花了多少"这一栏。
 * 假模型的 usage 是 provider 里写死的 `10 / len`，那是给教学版
 * 凑形状用的，照它记账等于记了个假数。**只有真模型的 response
 * 会给出账单**，而且只在流末尾来一次（见 stream() 的
 * `case 'usage'`）。
 *
 * 为什么要按 `purpose` 分开？因为两种请求付的是同一份钱，
 * 记的却是两本账：
 * - `generate`——用户看得见的那一轮，是交互成本；
 * - `compaction`——用户看不见的那一次，是维护开销。
 *
 * 混在一起，"压缩一次多少钱"这个问题就永远答不出来。
 *
 * 真身在这里走得更远：`purpose` 会变成请求头
 * `x-deepseek-harness-compact: 1`（adapter.ts:130），
 * 服务端据此分账。教学版只在日志里分——但分账这件事本身
 * 从第一课起就是刚需，不是锦上添花。
 *
 * 为什么放在模块作用域而不是 apply() 里面：调用它的是模块级的
 * `stream()`，那是第 09 课就从 apply 里拆出去的纯函数。
 * 它只做一件事——打一行字，不碰 ctx。
 */
function reportUsage(purpose: GenerateOptions['purpose'], spent: Usage): void {
  const label = purpose === 'compaction' ? '压缩' : '对话'
  console.log(
    `[${label}账] 本次真实花费：输入 ${spent.inputTokens} + 输出 ${spent.outputTokens}`
    + ` = ${spent.inputTokens + spent.outputTokens} token`,
  )
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

/**
 * 连续重复检测。
 *
 * 记录上一次调用的身份（工具名 + 规范化参数），和这次的比一比：
 * 一样就连贯计数 +1，不一样就重新从 1 开始。
 *
 * 真身 repeat-tool-reminder 比这讲究得多——它深排序 JSON 再序列化，
 * 所以 `{a:1,b:2}` 和 `{b:2,a:3}` 算同一次调用；还支持 include/exclude
 * 通配符和分级阈值。教学版只保留那个核心判断：**同样的动作连续做，
 * 就是没有进展。**
 */
function observeRepeat(name: string, argsJson: string): number {
  const key = `${name}(${argsJson})`
  const count = lastCallKey === key ? lastCallCount + 1 : 1
  lastCallKey = key
  lastCallCount = count
  return count
}

/** 上一次调用的身份，见 observeRepeat。 */
let lastCallKey = ''
/** 它已经连续重复了几次。 */
let lastCallCount = 0

/**
 * 把任意异常描述成一句人能看懂的话。
 *
 * `catch (error)` 收到的是 `unknown`——TypeScript 不允许你直接
 * `.message`。先收窄到 Error，剩下的用 String() 兜底。
 * 注意这里**不重新抛出**：到了这一层，任何异常都是"工具失败"，
 * 都要变成模型能看见的一句话。
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
