const name = "agent";
const inject = ["llm", "tools"];
function apply(ctx) {
  ctx.on("agent/turn", (input) => {
    void run(input);
  });
  setTimeout(() => ctx.emit("agent/turn", "\u5317\u4EAC\u5929\u6C14\u600E\u4E48\u6837\uFF1F"), 50);
  setTimeout(() => ctx.emit("agent/turn", "\u4E0A\u6D77\u5929\u6C14\u600E\u4E48\u6837\uFF1F"), 150);
  setTimeout(() => ctx.emit("agent/turn", "\u706B\u661F\u5929\u6C14\u5982\u4F55\uFF1F"), 400);
  setTimeout(() => ctx.emit("agent/turn", "\u5E2E\u6211\u641C\u7D22\u4E0A\u6D77\u5929\u6C14"), 700);
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
      return;
    }
    const kind = classifyFailure(result.error);
    switch (kind) {
      case "unknown-tool":
        console.log(`[\u5DE5\u5177\u4E0D\u5B58\u5728] ${call.name}`);
        reportToModel(`\u5DE5\u5177 ${call.name} \u4E0D\u5B58\u5728\u3002\u53EF\u7528\u7684\u5DE5\u5177\uFF1A${ctx.tools.list().map((t) => t.name).join("\u3001")}`);
        break;
      case "invalid-args":
        console.log(`[\u53C2\u6570\u4E0D\u5408\u6CD5] ${result.error}`);
        reportToModel(result.error);
        break;
      case "crashed":
        console.log(`[\u5DE5\u5177\u5F02\u5E38] ${result.error}`);
        await retry(call);
        break;
    }
  }
  function classifyFailure(error) {
    if (error.startsWith("\u5DE5\u5177\u4E0D\u5B58\u5728")) return "unknown-tool";
    if (error.startsWith("invalid arguments")) return "invalid-args";
    return "crashed";
  }
  function reportToModel(message) {
    const follow = collect(ctx.llm.stream({
      messages: [
        { role: "user", content: "\uFF08\u7CFB\u7EDF\u63D0\u793A\uFF09" },
        { role: "assistant", content: `\u5DE5\u5177\u8C03\u7528\u5931\u8D25\uFF1A${message}` },
        { role: "user", content: "\u8BF7\u6839\u636E\u5931\u8D25\u539F\u56E0\u91CD\u65B0\u5C1D\u8BD5\u3002" }
      ]
    }));
    void follow.then((turn) => {
      if (turn.kind === "text") console.log(`[\u6A21\u578B\u56DE\u5E94] ${turn.text}`);
    });
  }
  async function retry(call) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const again = await ctx.tools.call(call.name, call.args);
    if (again.ok) {
      console.log(`[\u91CD\u8BD5\u6210\u529F] ${String(again.value)}`);
    } else {
      console.log(`[\u91CD\u8BD5\u4E5F\u5931\u8D25] ${again.error}`);
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
