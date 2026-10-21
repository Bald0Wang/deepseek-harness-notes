const name = "agent";
const inject = ["llm", "tools"];
function apply(ctx) {
  ctx.on("agent/turn", (input) => {
    void run(input);
  });
  setTimeout(() => ctx.emit("agent/turn", "\u5317\u4EAC\u5929\u6C14\u600E\u4E48\u6837\uFF1F"), 50);
  setTimeout(() => ctx.emit("agent/turn", "\u4F60\u597D"), 100);
  async function run(input) {
    console.log(`
=== \u7528\u6237\u8BF4\uFF1A${input} ===`);
    const options = {
      messages: [{ role: "user", content: input }]
    };
    const turn = await collect(ctx.llm.stream(options));
    switch (turn.kind) {
      case "text":
        console.log(`[\u6A21\u578B\u56DE\u7B54] ${turn.text}`);
        break;
      case "tool-call":
        console.log(`[\u6A21\u578B\u51B3\u5B9A] \u8C03\u7528 ${turn.name}\uFF0C\u53C2\u6570 ${JSON.stringify(turn.args)}`);
        await executeTool(turn);
        break;
    }
  }
  async function executeTool(call) {
    const result = await ctx.tools.call(call.name, call.args);
    if (result.ok) {
      console.log(`[\u5DE5\u5177\u8FD4\u56DE] ${String(result.value)}`);
    } else {
      console.log(`[\u5DE5\u5177\u5931\u8D25] ${result.error}`);
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
