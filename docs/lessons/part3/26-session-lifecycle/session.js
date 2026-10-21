import { Service } from "@deepseek-ai/cordis";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
class Session extends Service {
  constructor(ctx) {
    super(ctx, "session");
  }
  /**
   * 从磁盘读回一个 session 的全部记录。
   *
   * 第一行是头行（`type: 'session'`），记录格式版本；剩下的是记录行。
   * 版本对不上直接抛错——**拒绝加载比猜着加载安全**。
   * @param file - session.jsonl 的路径。
   * @returns 按 seq 升序的记录。
   */
  static load(file) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
    const [header, ...rest] = lines;
    if (header.type !== "session") {
      throw new Error(`session \u6587\u4EF6\u7B2C\u4E00\u884C\u5FC5\u987B\u662F\u5934\u884C\uFF0C\u5B9E\u9645\u662F ${String(header.type)}`);
    }
    if (header.version !== SESSION_FORMAT_VERSION) {
      throw new Error(
        `session \u683C\u5F0F\u7248\u672C\u4E0D\u5339\u914D\uFF1A\u6587\u4EF6\u662F v${header.version}\uFF0C\u672C\u7A0B\u5E8F\u53EA\u4F1A v${SESSION_FORMAT_VERSION}`
      );
    }
    return rest.filter(isSessionLine);
  }
}
function isSessionLine(line) {
  return line.type !== "session";
}
const SESSION_FORMAT_VERSION = 1;
class JsonlSession extends Session {
  seq = 0;
  records = [];
  file;
  /** 磁盘上已有多少条记录——恢复来的，还是新起的。 */
  restoredCount;
  /**
   * 已经广播过 `session/disposed` 了吗。收尾只能发生一次。
   *
   * 为什么不用 `#disposed`：服务是从 `ctx.session` 读的，那是 cordis
   * 的 Proxy——私有字段穿过 Proxy 就读不到了（`get` 拦截器拿到的
   * receiver 不是原对象）。TypeScript 的 `private` 只是编译期的事，
   * 运行时就一个普通属性，Proxy 照样能转发。
   */
  disposed = false;
  constructor(ctx, config) {
    super(ctx);
    this.file = join(config.file, "session.jsonl");
    mkdirSync(dirname(this.file), { recursive: true });
    if (ownedFiles.has(this.file)) {
      throw new Error(`session \u6587\u4EF6\u5DF2\u88AB\u5360\u7528\uFF1A${this.file}\uFF08\u5355\u5199\u8005\uFF0C\u4E0D\u80FD\u4E24\u4E2A\u5B9E\u4F8B\u540C\u65F6\u5F00\uFF09`);
    }
    if (existsSync(this.file)) {
      const existing = Session.load(this.file);
      this.records.push(...existing);
      this.seq = existing.at(-1)?.seq ?? 0;
      this.restoredCount = existing.length;
    } else {
      this.restoredCount = 0;
      appendFileSync(this.file, `${JSON.stringify({ type: "session", version: SESSION_FORMAT_VERSION })}
`);
    }
    ownedFiles.add(this.file);
    this.ctx.emit("session/created", this, this.restoredCount);
  }
  append(record, op = "append") {
    this.seq += 1;
    const line = this.toLine(this.seq, record, op);
    this.records.push(line);
    appendFileSync(this.file, `${JSON.stringify(line)}
`);
    this.ctx.emit("session/event", this, line);
    return line.seq;
  }
  /** 拼一行。`tool/call` 不进模型可见历史——它已经被同一轮的 assistant/message 代表了。 */
  toLine(seq, record, op) {
    const time = Date.now();
    switch (record.type) {
      case "user/message":
        return { seq, time, type: "user/message", data: record.data, surfaceOp: op };
      case "assistant/message":
        return { seq, time, type: "assistant/message", data: record.data, surfaceOp: op };
      case "tool/result":
        return { seq, time, type: "tool/result", data: record.data, surfaceOp: op };
      case "tool/call":
        return { seq, time, type: "tool/call", data: record.data };
      case "notice/message":
        return { seq, time, type: "notice/message", data: record.data };
    }
  }
  list() {
    return this.records;
  }
  /**
   * 折叠日志。
   *
   * `surface` 是一个"模型能看到哪些 seq"的有序列表。
   * 追加就 push；替换就把 [startSeq, endSeq] 那段挖掉、换成新行。
   * 被挖掉的行在日志里一行不少，只是不再进模型请求。
   */
  deriveMessages() {
    const surface = [];
    for (const line of this.records) {
      const op = line.surfaceOp;
      if (op === void 0) continue;
      if (op === "append") {
        surface.push(line);
        continue;
      }
      const start = surface.findIndex((node) => node.seq === op.startSeq);
      const end = surface.findIndex((node) => node.seq === op.endSeq);
      if (start === -1 || end === -1) continue;
      surface.splice(start, end - start + 1, line);
    }
    return surface.map(toChatMessage);
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
  flush() {
    const header = `${JSON.stringify({ type: "session", version: SESSION_FORMAT_VERSION })}
`;
    const body = this.records.map((line) => `${JSON.stringify(line)}
`).join("");
    writeFileSync(this.file, header + body);
    void this.ctx.parallel("session/flush", this);
  }
  /**
   * 收尾：广播 `session/disposed`，交还单写者名额。
   *
   * 由剧本末尾显式调用（也由插件的清理钩子兜底）。**幂等**——
   * 第二次调用什么都不做：重复广播会让监听器把一个会话埋两遍。
   * 真身在会话离开 store 时广播一次，同样只此一次。
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ownedFiles.delete(this.file);
    this.ctx.emit("session/disposed", this);
  }
}
const ownedFiles = /* @__PURE__ */ new Set();
function toChatMessage(line) {
  switch (line.type) {
    case "user/message":
      return { role: "user", content: line.data.content };
    case "assistant/message":
      return { role: "assistant", content: line.data.text };
    case "tool/result":
      return { role: "tool", content: String(line.data.value) };
    case "tool/call":
      return { role: "assistant", content: `${line.data.name}(${line.data.arguments})` };
    case "notice/message":
      return { role: "assistant", content: line.data.text };
  }
}
function apply(ctx) {
  ctx.plugin(JsonlSession, { file: ".sessions/demo" });
}
export {
  JsonlSession,
  SESSION_FORMAT_VERSION,
  Session,
  apply
};
