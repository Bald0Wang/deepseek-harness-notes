import { SECTION_ORDER } from "./system-prompt.js";
const name = "agent";
const inject = ["llm", "tools", "sessionLog", "systemPrompt"];
let lastSystem = "";
let lastSystemSeq;
let disposeIdentity;
function apply(ctx) {
  ctx.on("agent/turn", (input) => {
    void run(input);
  });
  disposeIdentity = ctx.systemPrompt.section({
    name: "agent:identity",
    order: SECTION_ORDER.identity,
    text: "\u4F60\u662F\u4E00\u4E2A\u5929\u6C14\u52A9\u624B\uFF0C\u53EA\u56DE\u7B54\u5929\u6C14\u76F8\u5173\u7684\u95EE\u9898\u3002"
  });
  ctx.systemPrompt.section({
    name: "agent:persona",
    order: SECTION_ORDER.persona,
    text: "\u56DE\u7B54\u65F6\u8BED\u6C14\u793C\u8C8C\uFF0C\u4E0D\u786E\u5B9A\u5C31\u660E\u8BF4\u3002"
  });
  ctx.systemPrompt.section({
    name: "agent:tools",
    order: SECTION_ORDER.tools,
    text: () => ctx.systemPrompt.renderTools(ctx.tools.schemas())
  });
  ctx.on("system-prompt/change", () => {
    console.log(`[\u63D0\u793A\u8BCD\u53D8\u66F4] \u73B0\u5728\u5171 ${ctx.systemPrompt.assemble().length} \u5B57`);
  });
  ctx.on("tools/change", () => {
    console.log(`[\u5DE5\u5177\u6E05\u5355\u53D8\u66F4] \u73B0\u5728\u5171 ${ctx.tools.schemas().length} \u4E2A\u5DE5\u5177`);
  });
  setTimeout(() => ctx.emit("agent/turn", "\u5317\u4EAC\u5929\u6C14\u600E\u4E48\u6837\uFF1F"), 50);
  setTimeout(() => ctx.emit("agent/turn", "\u5E2E\u6211\u5199\u4E00\u9996\u8BD7"), 150);
  setTimeout(() => {
    widenScope();
  }, 300);
  setTimeout(() => ctx.emit("agent/turn", "\u5E2E\u6211\u5199\u4E00\u9996\u8BD7"), 400);
  setTimeout(() => replay(), 500);
  function widenScope() {
    console.log("\n=== \u6539\u5199\u8EAB\u4EFD\u6BB5\uFF1A\u5141\u8BB8\u95F2\u804A ===");
    disposeIdentity?.();
    disposeIdentity = ctx.systemPrompt.section({
      name: "agent:identity",
      order: SECTION_ORDER.identity,
      text: "\u4F60\u662F\u4E00\u4E2A\u5929\u6C14\u52A9\u624B\uFF0C\u4E3B\u8981\u56DE\u7B54\u5929\u6C14\uFF0C\u4F46\u4E5F\u80FD\u95F2\u804A\u51E0\u53E5\u3002"
    });
  }
  async function run(input) {
    console.log(`
=== \u7528\u6237\u8BF4\uFF1A${input} ===`);
    ctx.sessionLog.append({ type: "user/message", data: { content: input } });
    const system = ctx.systemPrompt.assemble();
    if (system !== lastSystem) {
      ctx.sessionLog.append(
        { type: "system/message", data: { content: system } },
        lastSystemSeq === void 0 ? "append" : { op: "replace", startSeq: lastSystemSeq, endSeq: lastSystemSeq }
      );
      lastSystem = system;
      lastSystemSeq = ctx.sessionLog.list().at(-1)?.seq;
    }
    const options = { messages: ctx.sessionLog.deriveMessages() };
    const turn = await collect(ctx.llm.stream(options));
    switch (turn.kind) {
      case "text":
        console.log(`[\u6A21\u578B\u56DE\u7B54] ${turn.text}`);
        ctx.sessionLog.append({ type: "assistant/message", data: { text: turn.text } });
        break;
      case "tool-call": {
        console.log(`[\u6A21\u578B\u51B3\u5B9A] \u8C03\u7528 ${turn.name}\uFF0C\u53C2\u6570 ${JSON.stringify(turn.args)}`);
        ctx.sessionLog.append({
          type: "tool/call",
          data: { callId: turn.id, name: turn.name, arguments: JSON.stringify(turn.args) }
        });
        await executeTool(turn);
        break;
      }
    }
  }
  async function executeTool(call) {
    const result = await ctx.tools.call(call.name, call.args);
    if (result.ok) {
      console.log(`[\u5DE5\u5177\u8FD4\u56DE] ${String(result.value)}`);
      ctx.sessionLog.append({
        type: "tool/result",
        data: { callId: call.id, name: call.name, value: result.value, isError: false }
      });
      const follow = await collect(ctx.llm.stream({ messages: ctx.sessionLog.deriveMessages() }));
      if (follow.kind === "text") {
        console.log(`[\u6A21\u578B\u56DE\u7B54] ${follow.text}`);
        ctx.sessionLog.append({ type: "assistant/message", data: { text: follow.text } });
      }
    } else {
      console.log(`[\u5DE5\u5177\u5931\u8D25] ${result.error}`);
      ctx.sessionLog.append({
        type: "tool/result",
        data: { callId: call.id, name: call.name, value: result.error, isError: true }
      });
    }
  }
  function replay() {
    const lines = ctx.sessionLog.list();
    console.log(`
=== \u65E5\u5FD7\u5168\u91CF\uFF08${lines.length} \u6761\uFF09===`);
    for (const line of lines) {
      console.log(`#${line.seq} [${line.type}] ${describe(line)}`);
    }
    const messages = ctx.sessionLog.deriveMessages();
    console.log(`
=== \u7B2C\u4E8C\u8F6E\u8BF7\u6C42\u65F6\u6A21\u578B\u770B\u5230\u7684\u5386\u53F2\uFF08${messages.length} \u6761\uFF09===`);
    for (const message of messages) {
      console.log(`[${message.role}] ${message.content}`);
    }
  }
  function describe(line) {
    switch (line.type) {
      case "user/message":
        return line.data.content;
      case "assistant/message":
        return line.data.text;
      case "tool/call":
        return `${line.data.name}(${line.data.arguments})`;
      case "tool/result":
        return line.data.isError ? `\u5931\u8D25\uFF1A${String(line.data.value)}` : String(line.data.value);
      case "system/message":
        return line.data.content;
    }
  }
}
async function collect(stream) {
  const texts = /* @__PURE__ */ new Map();
  const calls = /* @__PURE__ */ new Map();
  for await (const chunk of stream) {
    switch (chunk.type) {
      case "text-delta":
        texts.set(chunk.index, (texts.get(chunk.index) ?? "") + chunk.text);
        break;
      case "tool-call-delta": {
        const existing = calls.get(chunk.index) ?? { id: chunk.id, name: "", arguments: "" };
        if (chunk.name !== void 0) existing.name = chunk.name;
        existing.arguments += chunk.argumentsDelta;
        calls.set(chunk.index, existing);
        break;
      }
      case "block-end":
        if (chunk.block.type === "tool-call") {
          return { kind: "tool-call", id: chunk.block.id, name: chunk.block.name, args: parseArgs(chunk.block.arguments) };
        }
        break;
      case "finish":
        break;
      default:
        break;
    }
  }
  const text = [...texts.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join("");
  return { kind: "text", text };
}
function parseArgs(json) {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
export {
  apply,
  inject,
  name
};
