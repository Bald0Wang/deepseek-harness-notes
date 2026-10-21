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
  constructor(ctx, config) {
    super(ctx);
    this.file = join(config.file, "session.jsonl");
    mkdirSync(dirname(this.file), { recursive: true });
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
  }
  append(record, op = "append") {
    this.seq += 1;
    const line = this.toLine(this.seq, record, op);
    this.records.push(line);
    appendFileSync(this.file, `${JSON.stringify(line)}
`);
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
   */
  flush() {
    const header = `${JSON.stringify({ type: "session", version: SESSION_FORMAT_VERSION })}
`;
    const body = this.records.map((line) => `${JSON.stringify(line)}
`).join("");
    writeFileSync(this.file, header + body);
  }
}
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
