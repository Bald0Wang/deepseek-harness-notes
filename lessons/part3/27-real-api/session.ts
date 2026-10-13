import { Service, type Context } from '@deepseek-ai/cordis'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 一条会话记录。`data` 的形状由 `type` 决定。
 *
 * harness 真身里这是 `SessionEventMap`（packages/core/session/src/types.ts 第 281 行），
 * 同样是"一个 type 对应一种 data"的表。
 */
export interface SessionRecordMap {
  /** 用户说了一句话。 */
  'user/message': { content: string }
  /** 模型回答了一轮。 */
  'assistant/message': { text: string }
  /** 模型请求调用一个工具，arguments 是它吐出的原始 JSON 字符串。 */
  'tool/call': { callId: string; name: string; arguments: string }
  /** 工具执行完了，value 是返回值，isError 标记成功失败。 */
  'tool/result': { callId: string; name: string; value: unknown; isError: boolean }
  /** 一条旁白：循环写给自己的提醒，模型看不见。 */
  'notice/message': { text: string }
}

/** 任意一种会话记录。 */
export type SessionRecord =
  | { [K in keyof SessionRecordMap]: { type: K; data: SessionRecordMap[K] } }[keyof SessionRecordMap]

/**
 * 会产生模型可见消息的记录类型。
 *
 * 日志里还有别的行（turn 边界、失败尝试），它们不进模型请求，
 * 只是排查问题时看的痕迹。harness 真身叫 `SurfaceEventType`
 * （packages/core/session/src/types.ts 第 439 行）。
 */
export type SurfaceRecordType = 'user/message' | 'assistant/message' | 'tool/result'

/** 一条记录在"模型能看到的历史"里的落点。 */
export type SurfaceOp =
  /** 追加到末尾：正常路径。 */
  | 'append'
  /** 替换一段已有节点：压缩上下文时用，被替换的行在日志里还在，只是不再进模型请求。 */
  | { op: 'replace'; startSeq: number; endSeq: number }

/**
 * 落盘的一行。
 *
 * 这是判别联合：`switch (line.type)` 会收窄 `line.data` 的类型，
 * 不用写任何断言。写法照抄 harness 真身的 `SessionEvent`
 * （packages/core/session/src/types.ts 第 493 行）——
 * `{ [K in ...]: {...} }[T]` 这层映射就是为了让联合生效。
 */
export type SessionLine = {
  [K in keyof SessionRecordMap]: {
    /** 会话内单调递增的序号，从 1 开始。 */
    readonly seq: number
    /** 写入时刻，Unix 毫秒。 */
    readonly time: number
    readonly type: K
    readonly data: SessionRecordMap[K]
    /** 它怎么进入模型可见历史。只有会产生消息的行带这个字段。 */
    readonly surfaceOp?: K extends SurfaceRecordType ? SurfaceOp : never
  }
}[keyof SessionRecordMap]

declare module '@deepseek-ai/cordis' {
  interface Context { session: Session }

  interface Events {
    /**
     * 会话问世：新起一个文件，或者从磁盘接上一条。
     *
     * 真身 `session/created`（packages/core/session/src/index.ts 第 54 行）
     * 的 `@mode emit`：同步广播，不等不收。它标记的是"这个 session
     * 现在有人负责了"，不是"第一条记录写完了"——头行先落地，
     * 事件后广播，所以监听器伸手就能读到 header。
     * @param session - 刚问世的会话。
     * @param restored - 从磁盘恢复了多少条记录，0 表示新起的。
     * @mode emit
     */
    'session/created'(session: Session, restored: number): void

    /**
     * 一条记录落定：写完盘、进了内存，才会广播。
     *
     * 真身 `session/event`（同文件第 74 行）是 post-commit 的
     * fire-and-forget：**监听器抛异常不会让 append 失败**。
     * 教学版不实现失败遏制——我们的监听器只打印。但这个顺序
     * 不能反：先广播后写盘，监听器读到的东西可能还没落定。
     * @param session - 日志变长的会话。
     * @param line - 刚落定的那一行，和盘上逐字一致。
     * @mode emit
     */
    'session/event'(session: Session, line: SessionLine): void

    /**
     * 落盘关卡：把缓冲里的记录全部推到磁盘，所有监听器并发跑完才返回。
     *
     * 真身 `session/flush`（同文件第 82 行）的 `@mode parallel`——
     * 它是 **await 型**的：调用方等所有监听器都做完。
     * `session-checkpoint-policy` 在 `llm/stream` 构造前、工具
     * body 执行前、`agent/pre-step` 三处 await 它，所以
     * "模型请求发出前日志一定在盘上"这件事是被强制出来的。
     * @param session - 要被推到磁盘的会话。
     * @mode parallel
     */
    'session/flush'(session: Session): Promise<void> | void

    /**
     * 会话入土：文件关闭，进程退出前最后一个可观测的时刻。
     *
     * 真身 `session/disposed`（同文件第 63 行）在会话离开 store
     * 时广播一次。教学版由 launcher 在 `ctx.dispose()` 时触发，
     * 所以监听器必须在这里把手里的东西吐完——过了这村，
     * 进程都要退了，没人再听你说话。
     * @param session - 结束的会话。
     * @mode emit
     */
    'session/disposed'(session: Session): void
  }
}

/**
 * 一条喂给模型的请求消息。
 *
 * 27 课加了 `callId`：`tool/result` 日志行里一直存着这个字段
 * （见 `SessionRecordMap`），但从来没有被读过——直到要接真 API。
 * 协议的 tool_result 必须带 `tool_use_id` 对回当初那次调用，
 * 教学版第一次真的把这个字段读出来用。
 */
export interface ChatMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly content: string
  /** 工具调用/结果的 id。只有 `tool` 角色带。 */
  readonly callId?: string
}

/**
 * Service Definition：把"发生过的事"写进一条只增不减的日志。
 *
 * 这是 harness 的**唯一事实来源**。第 12 课的 agent loop 只在内存里跑，
 * 进程一退全忘了；有了它，任何时候都能把对话重放出来。
 */
export abstract class Session extends Service {
  constructor(ctx: Context) { super(ctx, 'session') }

  /**
   * 追加一条记录。
   * @param record - 记录内容。
   * @param op - 它怎么进入模型可见历史，默认 `'append'`。
   * @returns 分配到的序号。
   */
  abstract append(record: SessionRecord, op?: SurfaceOp): number

  /** 目前为止的全部记录，按 seq 升序。 */
  abstract list(): readonly SessionLine[]

  /**
   * 把日志折叠成模型能看的历史。
   *
   * 只走会产生消息的行；`replace` 标记的行会顶掉它覆盖的那一段。
   * 这就是 harness 的 `deriveMessages()`——每次请求前都重新折一遍，
   * 所以日志和模型看到的东西永远一致。
   */
  abstract deriveMessages(): ChatMessage[]

  /** 磁盘上已经有多少条记录——恢复来的，还是新起的。 */
  abstract readonly restoredCount: number

  /**
   * 把缓冲里的记录全部推到磁盘，然后广播 `session/flush`。
   *
   * 真身里这是"落盘关卡"：`session-checkpoint-policy` 在模型请求
   * 构造前、工具 body 执行前 await 它。教学版的 append 本身就是
   * 同步落盘的，所以这个方法空转——但**事件照发**，因为关卡
   * 的位置比关卡的实现更值得看。
   */
  abstract flush(): void

  /**
   * 结束这个会话：广播 `session/disposed`，交还单写者名额。
   *
   * **幂等**：第二次调用什么都不做。
   */
  abstract dispose(): void

  /**
   * 从磁盘读回一个 session 的全部记录。
   *
   * 第一行是头行（`type: 'session'`），记录格式版本；剩下的是记录行。
   * 版本对不上直接抛错——**拒绝加载比猜着加载安全**。
   * @param file - session.jsonl 的路径。
   * @returns 按 seq 升序的记录。
   */
  static load(file: string): readonly SessionLine[] {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SessionFileLine)
    const [header, ...rest] = lines
    if (header.type !== 'session') {
      throw new Error(`session 文件第一行必须是头行，实际是 ${String(header.type)}`)
    }
    if (header.version !== SESSION_FORMAT_VERSION) {
      throw new Error(
        `session 格式版本不匹配：文件是 v${header.version}，本程序只会 v${SESSION_FORMAT_VERSION}`,
      )
    }
    // 剩下的都是记录行；头行在上面已经核对掉了
    return rest.filter(isSessionLine)
  }
}

/** 头行不是记录。 */
function isSessionLine(line: SessionFileLine): line is SessionLine {
  return line.type !== 'session'
}

/**
 * 落盘文件的一行：要么是头行，要么是一条记录。
 *
 * 头行不是记录——它没有 `seq`，只说明"这个文件是什么格式的"。
 * harness 真身在 packages/session/session-persistence-jsonl/src/format.ts
 * 里也叫 `HeaderLine`，`type` 字段值是 `'session'`。
 */
export type SessionFileLine =
  | { type: 'session'; version: number }
  | SessionLine

/** 当前会话日志的格式版本。harness 真身是 `SESSION_FORMAT_VERSION = 4`。 */
export const SESSION_FORMAT_VERSION = 1

/**
 * Service Provider：JSONL 落地。
 *
 * 每行一条 JSON，追加写文件。harness 真身（packages/session/session-persistence-jsonl）
 * 用 zstd 压缩、分代文件名和原子替换，我们保留最核心的那个决定：
 * **append-only，写出去的行永不改写**。
 *
 * 本课（26 课）加的是另外一组真身也有的事：
 *
 * 1. **四个生命周期事件**（`session/created` / `session/event` /
 *    `session/flush` / `session/disposed`）——会话从问世到入土，
 *    每一步都有事件可听，不必去轮询 `list()`。
 * 2. **`session/flush` 是 await 型关卡**——真身叫 `@mode parallel`：
 *    调用方等所有监听器做完。checkpoint-policy 靠它在
 *    "模型请求发出前"强制日志落盘。
 * 3. **单写者**——真身是进程内 claim + 内核 flock（Windows 命名
 *    信号量）。教学版只有进程内 claim，但那个错误必须现在就抛：
 *    两个 JsonlSession 同时写一个文件，交替追加会把彼此的
 *    行从中间劈开，读回来时整份日志都是坏的。
 */
export class JsonlSession extends Session {
  private seq = 0
  private readonly records: SessionLine[] = []
  private readonly file: string
  /** 磁盘上已有多少条记录——恢复来的，还是新起的。 */
  readonly restoredCount: number
  /**
   * 已经广播过 `session/disposed` 了吗。收尾只能发生一次。
   *
   * 为什么不用 `#disposed`：服务是从 `ctx.session` 读的，那是 cordis
   * 的 Proxy——私有字段穿过 Proxy 就读不到了（`get` 拦截器拿到的
   * receiver 不是原对象）。TypeScript 的 `private` 只是编译期的事，
   * 运行时就一个普通属性，Proxy 照样能转发。
   */
  private disposed = false

  constructor(ctx: Context, config: { file: string }) {
    super(ctx)
    this.file = join(config.file, 'session.jsonl')
    mkdirSync(dirname(this.file), { recursive: true })

    // 单写者：同一个文件在同一个进程里只许一个 session 持有。
    // 真身在这一步还会去抢内核锁，防的是**另一个进程**——
    // 教学版不跨进程，只拦"自己人打自己人"。
    if (ownedFiles.has(this.file)) {
      throw new Error(`session 文件已被占用：${this.file}（单写者，不能两个实例同时开）`)
    }

    // 恢复：接着磁盘上已有的行往下写，seq 继续往上加
    if (existsSync(this.file)) {
      const existing = Session.load(this.file)
      this.records.push(...existing)
      this.seq = existing.at(-1)?.seq ?? 0
      this.restoredCount = existing.length
    } else {
      this.restoredCount = 0
      // 新文件第一行写头行：以后谁来读这个文件，先核对版本
      appendFileSync(this.file, `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION })}\n`)
    }

    ownedFiles.add(this.file)
    // 头行已在盘上，事件才可以广播——监听器伸手能读到 header
    this.ctx.emit('session/created', this, this.restoredCount)
  }

  append(record: SessionRecord, op: SurfaceOp = 'append'): number {
    this.seq += 1
    const line = this.toLine(this.seq, record, op)
    this.records.push(line)
    // 追加写：只往文件末尾加字节，不动已有内容
    appendFileSync(this.file, `${JSON.stringify(line)}\n`)
    // 先落盘、后广播：监听器看到的每一行都已经是既成事实
    this.ctx.emit('session/event', this, line)
    return line.seq
  }

  /** 拼一行。`tool/call` 不进模型可见历史——它已经被同一轮的 assistant/message 代表了。 */
  private toLine(seq: number, record: SessionRecord, op: SurfaceOp): SessionLine {
    const time = Date.now()
    switch (record.type) {
      case 'user/message':
        return { seq, time, type: 'user/message', data: record.data, surfaceOp: op }
      case 'assistant/message':
        return { seq, time, type: 'assistant/message', data: record.data, surfaceOp: op }
      case 'tool/result':
        return { seq, time, type: 'tool/result', data: record.data, surfaceOp: op }
      case 'tool/call':
        return { seq, time, type: 'tool/call', data: record.data }
      case 'notice/message':
        return { seq, time, type: 'notice/message', data: record.data }
    }
  }

  list(): readonly SessionLine[] { return this.records }

  /**
   * 折叠日志。
   *
   * `surface` 是一个"模型能看到哪些 seq"的有序列表。
   * 追加就 push；替换就把 [startSeq, endSeq] 那段挖掉、换成新行。
   * 被挖掉的行在日志里一行不少，只是不再进模型请求。
   */
  deriveMessages(): ChatMessage[] {
    const surface: SessionLine[] = []
    for (const line of this.records) {
      const op = line.surfaceOp
      if (op === undefined) continue          // 非消息行：跳过
      if (op === 'append') { surface.push(line); continue }
      // replace：挖掉旧段，在原来的位置插入新行
      const start = surface.findIndex((node) => node.seq === op.startSeq)
      const end = surface.findIndex((node) => node.seq === op.endSeq)
      if (start === -1 || end === -1) continue
      surface.splice(start, end - start + 1, line)
    }
    return surface.map(toChatMessage)
  }

  /**
   * 把整个文件重写一遍。
   *
   * 注意头行得带上——它是文件的一部分，不是记录。
   * 这是本文件里唯一一处"整份重写"的路径，正常写入走的是 append。
   *
   * 教学版的 `append()` 是同步落盘的，所以这个方法空转；
   * 真身有写缓冲，`flush()` 是把缓冲推盘的那一下——
   * 也是 `session/flush` 事件存在的全部理由。
   */
  flush(): void {
    const header = `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION })}\n`
    const body = this.records.map((line) => `${JSON.stringify(line)}\n`).join('')
    writeFileSync(this.file, header + body)
    void this.ctx.parallel('session/flush', this)
  }

  /**
   * 收尾：广播 `session/disposed`，交还单写者名额。
   *
   * 由剧本末尾显式调用（也由插件的清理钩子兜底）。**幂等**——
   * 第二次调用什么都不做：重复广播会让监听器把一个会话埋两遍。
   * 真身在会话离开 store 时广播一次，同样只此一次。
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    ownedFiles.delete(this.file)
    this.ctx.emit('session/disposed', this)
  }
}

/** 进程内已被占用的 session 文件。真身在这之上还有一层内核 flock。 */
const ownedFiles = new Set<string>()

/** 把一条消息行翻译成模型请求里的消息。 */
function toChatMessage(line: SessionLine): ChatMessage {
  switch (line.type) {
    case 'user/message':
      return { role: 'user', content: line.data.content }
    case 'assistant/message':
      return { role: 'assistant', content: line.data.text }
    case 'tool/result':
      // callId 从日志里读出来，原样带进请求。真身在这里读的是
      // 同一个字段——tool_result 要靠它和当初的 tool_use 对上。
      return { role: 'tool', content: String(line.data.value), callId: line.data.callId }
    case 'tool/call':
      // 走不到这里：tool/call 没有 surfaceOp，deriveMessages 已经把它过滤掉了
      return { role: 'assistant', content: `${line.data.name}(${line.data.arguments})` }
    case 'notice/message':
      // 走不到这里：旁白没有 surfaceOp，deriveMessages 已经把它过滤掉了
      return { role: 'assistant', content: line.data.text }
  }
}

export function apply(ctx: Context) {
  ctx.plugin(JsonlSession, { file: '.sessions/demo' })
}
