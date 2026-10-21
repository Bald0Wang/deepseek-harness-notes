const name = "agent";
const inject = ["llm", "tools", "session"];
function apply(ctx) {
  ctx.on("agent/turn", (input) => {
    void run(input);
  });
  ctx.on("agent/compact", (fromSeq, toSeq, summary) => {
    compact(fromSeq, toSeq, summary);
  });
  const restored = ctx.session.restoredCount;
  if (restored > 0) {
    console.log(`=== \u4ECE\u78C1\u76D8\u6062\u590D\u4E86 ${restored} \u6761\u8BB0\u5F55\uFF0Cseq \u63A5\u7740 #${ctx.session.list().at(-1)?.seq ?? 0} \u5F80\u4E0B\u7F16 ===`);
    console.log("=== \u6A21\u578B\u770B\u5230\u7684\u5386\u53F2 ===");
    for (const message of ctx.session.deriveMessages()) {
      console.log(`[${message.role}] ${message.content}`);
    }
    setTimeout(() => ctx.emit("agent/turn", "\u521A\u624D\u6211\u95EE\u4E86\u4EC0\u4E48\uFF1F"), 50);
  } else {
    console.log("=== \u6CA1\u6709\u627E\u5230\u5386\u53F2\uFF0C\u5F00\u4E00\u4E2A\u65B0\u4F1A\u8BDD ===");
    setTimeout(() => ctx.emit("agent/turn", "\u5317\u4EAC\u5929\u6C14\u600E\u4E48\u6837\uFF1F"), 50);
    setTimeout(() => ctx.emit("agent/turn", "\u4F60\u597D"), 100);
    setTimeout(() => ctx.emit("agent/compact", 1, 6, '\uFF08\u6458\u8981\uFF09\u7528\u6237\u95EE\u4E86\u5317\u4EAC\u5929\u6C14\uFF0C\u6A21\u578B\u8C03\u4E86 get_weather \u62FF\u5230"\u5317\u4EAC\uFF1A\u6674\uFF0C12\xB0C"\uFF0C\u5E76\u63D0\u9192\u51FA\u95E8\u770B\u60C5\u51B5\u5E26\u4F1E\u3002'), 200);
  }
  setTimeout(() => replay(), 400);
  async function run(input) {
    console.log(`
=== \u7528\u6237\u8BF4\uFF1A${input} ===`);
    ctx.session.append({ type: "user/message", data: { content: input } });
    const options = { messages: ctx.session.deriveMessages() };
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
      const follow = await collect(ctx.llm.stream({ messages: ctx.session.deriveMessages() }));
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
  function compact(fromSeq, toSeq, summary) {
    console.log(`
=== \u538B\u7F29\uFF1A#${fromSeq}~#${toSeq} \u6298\u6210\u4E00\u6761\u6458\u8981 ===`);
    const seq = ctx.session.append(
      { type: "assistant/message", data: { text: summary } },
      { op: "replace", startSeq: fromSeq, endSeq: toSeq }
    );
    console.log(`\u6458\u8981\u843D\u6210 #${seq}\uFF0C\u5B83\u9876\u6389\u4E86 #${fromSeq}~#${toSeq}`);
  }
  function replay() {
    const lines = ctx.session.list();
    console.log(`
=== \u65E5\u5FD7\u5168\u91CF\uFF08${lines.length} \u6761\uFF09===`);
    for (const line of lines) {
      console.log(`#${line.seq} [${line.type}] ${describe(line)}${opNote(line)}`);
    }
    const messages = ctx.session.deriveMessages();
    console.log(`
=== \u6A21\u578B\u770B\u5230\u7684\u5386\u53F2\uFF08\u6298\u53E0\u540E ${messages.length} \u6761\uFF09===`);
    for (const message of messages) {
      console.log(`[${message.role}] ${message.content}`);
    }
  }
  function opNote(line) {
    const op = line.surfaceOp;
    if (op === void 0 || op === "append") return "";
    return `\u3000\u2190 replace #${op.startSeq}~#${op.endSeq}`;
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
