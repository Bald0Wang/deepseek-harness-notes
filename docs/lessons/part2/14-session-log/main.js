const name = "agent";
const inject = ["llm", "tools", "session"];
function apply(ctx) {
  ctx.on("agent/turn", (input) => {
    void run(input);
  });
  setTimeout(() => ctx.emit("agent/turn", "\u5317\u4EAC\u5929\u6C14\u600E\u4E48\u6837\uFF1F"), 50);
  setTimeout(() => ctx.emit("agent/turn", "\u4F60\u597D"), 100);
  setTimeout(() => replay(), 300);
  async function run(input) {
    console.log(`
=== \u7528\u6237\u8BF4\uFF1A${input} ===`);
    ctx.session.append({ type: "user/message", data: { content: input } });
    const options = { messages: [{ role: "user", content: input }] };
    const turn = await collect(ctx.llm.stream(options));
    switch (turn.kind) {
      case "text":
        console.log(`[\u6A21\u578B\u56DE\u7B54] ${turn.text}`);
        ctx.session.append({ type: "assistant/message", data: { text: turn.text } });
        break;
      case "tool-call": {
        console.log(`[\u6A21\u578B\u51B3\u5B9A] \u8C03\u7528 ${turn.name}\uFF0C\u53C2\u6570 ${JSON.stringify(turn.args)}`);
        ctx.session.append({
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
      ctx.session.append({
        type: "tool/result",
        data: { callId: call.id, name: call.name, value: result.value, isError: false }
      });
      const follow = await collect(ctx.llm.stream({
        messages: [{ role: "user", content: String(result.value) }]
      }));
      if (follow.kind === "text") {
        console.log(`[\u6A21\u578B\u56DE\u7B54] ${follow.text}`);
        ctx.session.append({ type: "assistant/message", data: { text: follow.text } });
      }
    } else {
      console.log(`[\u5DE5\u5177\u5931\u8D25] ${result.error}`);
      ctx.session.append({
        type: "tool/result",
        data: { callId: call.id, name: call.name, value: result.error, isError: true }
      });
    }
  }
  function replay() {
    console.log("\n=== \u4ECE\u65E5\u5FD7\u91CD\u653E ===");
    for (const line of ctx.session.list()) {
      console.log(`#${line.seq} [${line.type}] ${describe(line)}`);
    }
    console.log(`\u5171 ${ctx.session.list().length} \u6761\u8BB0\u5F55`);
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
