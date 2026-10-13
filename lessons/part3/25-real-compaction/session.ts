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
}

/** 一条喂给模型的请求消息。 */
export interface ChatMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly content: string
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
 */
export class JsonlSession extends Session {
  private seq = 0
  private readonly records: SessionLine[] = []
  private readonly file: string
  /** 磁盘上已有多少条记录——恢复来的，还是新起的。 */
  readonly restoredCount: number

  constructor(ctx: Context, config: { file: string }) {
    super(ctx)
    this.file = join(config.file, 'session.jsonl')
    mkdirSync(dirname(this.file), { recursive: true })

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
  }

  append(record: SessionRecord, op: SurfaceOp = 'append'): number {
    this.seq += 1
    const line = this.toLine(this.seq, record, op)
    this.records.push(line)
    // 追加写：只往文件末尾加字节，不动已有内容
    appendFileSync(this.file, `${JSON.stringify(line)}\n`)
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
   */
  flush(): void {
    const header = `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION })}\n`
    const body = this.records.map((line) => `${JSON.stringify(line)}\n`).join('')
    writeFileSync(this.file, header + body)
  }
}

/** 把一条消息行翻译成模型请求里的消息。 */
function toChatMessage(line: SessionLine): ChatMessage {
  switch (line.type) {
    case 'user/message':
      return { role: 'user', content: line.data.content }
    case 'assistant/message':
      return { role: 'assistant', content: line.data.text }
    case 'tool/result':
      return { role: 'tool', content: String(line.data.value) }
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
