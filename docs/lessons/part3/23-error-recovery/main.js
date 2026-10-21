const name = "agent";
const inject = ["llm", "tools", "session"];
const TOOL_TIMEOUT_MS = 500;
const REPEAT_THRESHOLD = 3;
const MAX_RECOVERY_DEPTH = 2;
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
  } else {
    console.log("=== \u6CA1\u6709\u627E\u5230\u5386\u53F2\uFF0C\u5F00\u4E00\u4E2A\u65B0\u4F1A\u8BDD ===");
  }
  void (async () => {
    if (restored > 0) {
      await run("\u521A\u624D\u6211\u95EE\u4E86\u4EC0\u4E48\uFF1F");
    } else {
      await run("\u5317\u4EAC\u5929\u6C14\u600E\u4E48\u6837\uFF1F");
      await run("\u5E2E\u6211\u7B97 7*6");
      await run("\u4F60\u597D");
      compact(1, 12, "\uFF08\u6458\u8981\uFF09\u7528\u6237\u95EE\u4E86\u5317\u4EAC\u5929\u6C14\u548C\u4E00\u9053\u4E58\u6CD5\uFF0C\u6A21\u578B\u5206\u522B\u8C03\u4E86 get_weather \u548C calc\u3002");
    }
    reportCapabilities();
    replay();
  })();
  let scheduled = false;
  ctx.on("tools/change", () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(printTools, 0);
  });
  function printTools() {
    console.log("=== \u6A21\u578B\u80FD\u9009\u7684\u5DE5\u5177 ===");
    for (const schema of ctx.tools.schemas()) {
      console.log(`- ${schema.name}\uFF1A${schema.description}`);
    }
  }
  function reportCapabilities() {
    console.log("\n=== \u80FD\u529B\u5BF9\u8D26 ===");
    for (const service of Object.keys(ctx.fiber.inject)) {
      const registered = Object.hasOwn(ctx.reflect.props, service);
      const status = registered ? "\u9F50" : "\u7F3A";
      console.log(`- ${service}\uFF1A${status}`);
      if (!registered) {
        console.log(`  \u6CA1\u4EBA\u63D0\u4F9B ${service}\u2014\u2014cordis.yml \u91CC\u5C11\u4E86\u4E00\u4E2A provider\uFF0C\u6216\u8005\u5B83\u81EA\u5DF1\u52A0\u8F7D\u5931\u8D25\u4E86`);
      }
    }
  }
  async function run(input) {
    console.log(`
=== \u7528\u6237\u8BF4\uFF1A${input} ===`);
    ctx.session.append({ type: "user/message", data: { content: input } });
    const options = { messages: ctx.session.deriveMessages() };
    const turn = await stream(ctx, options);
    switch (turn.kind) {
      case "text":
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
  async function executeTool(call, depth = 0) {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
    }, TOOL_TIMEOUT_MS);
    let result;
    try {
      result = await ctx.tools.call(call.name, call.args, abort.signal);
    } catch (error) {
      result = { ok: false, callId: call.id, name: call.name, error: describeError(error) };
    } finally {
      clearTimeout(timer);
    }
    if (result.ok) {
      console.log(`[\u5DE5\u5177\u8FD4\u56DE] ${String(result.value)}`);
      ctx.session.append({
        type: "tool/result",
        data: { callId: call.id, name: call.name, value: result.value, isError: false }
      });
      const follow = await stream(ctx, { messages: ctx.session.deriveMessages() });
      if (follow.kind === "text") {
        ctx.session.append({ type: "assistant/message", data: { text: follow.text } });
      }
      return;
    }
    console.log(`[\u5DE5\u5177\u5931\u8D25] ${result.error}`);
    ctx.session.append({
      type: "tool/result",
      data: { callId: call.id, name: call.name, value: result.error, isError: true }
    });
    const repeats = observeRepeat(call.name, JSON.stringify(call.args));
    if (repeats >= REPEAT_THRESHOLD) {
      const notice = `\u4F60\u5DF2\u7ECF\u7528\u540C\u6837\u7684\u53C2\u6570\u8FDE\u7EED\u8C03\u4E86 ${repeats} \u6B21 ${call.name}\uFF0C\u8FD9\u6CA1\u6709\u8FDB\u5C55\u3002\u6362\u4E2A\u5DE5\u5177\u3001\u6362\u4E9B\u53C2\u6570\uFF0C\u6216\u8005\u76F4\u63A5\u544A\u8BC9\u7528\u6237\u4F60\u505A\u4E0D\u5230\u3002`;
      console.log(`[\u5FAA\u73AF\u63D0\u9192] ${notice}`);
      ctx.session.append({ type: "notice/message", data: { text: notice } });
    }
    const recovery = await stream(ctx, { messages: ctx.session.deriveMessages() });
    switch (recovery.kind) {
      case "text":
        ctx.session.append({ type: "assistant/message", data: { text: recovery.text } });
        break;
      case "tool-call": {
        if (depth >= MAX_RECOVERY_DEPTH) {
          console.log(`[\u653E\u5F03\u6062\u590D] \u5DF2\u7ECF\u91CD\u8BD5 ${MAX_RECOVERY_DEPTH} \u6B21\uFF0C\u6536\u624B`);
          ctx.session.append({
            type: "notice/message",
            data: { text: `\u6062\u590D\u91CD\u8BD5\u8FBE\u5230\u4E0A\u9650\uFF08${MAX_RECOVERY_DEPTH} \u6B21\uFF09\uFF0C\u672C\u8F6E\u7ED3\u675F\u3002` }
          });
          return;
        }
        ctx.session.append({
          type: "tool/call",
          data: { callId: recovery.id, name: recovery.name, arguments: JSON.stringify(recovery.args) }
        });
        await executeTool(recovery, depth + 1);
        break;
      }
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
      case "notice/message":
        return line.data.text;
    }
  }
}
async function stream(ctx, options) {
  const texts = /* @__PURE__ */ new Map();
  const calls = /* @__PURE__ */ new Map();
  let wroteText = false;
  for await (const chunk of ctx.llm.stream(options)) {
    switch (chunk.type) {
      case "text-delta":
        texts.set(chunk.index, (texts.get(chunk.index) ?? "") + chunk.text);
        if (!wroteText) {
          process.stdout.write("[\u6A21\u578B\u56DE\u7B54] ");
          wroteText = true;
        }
        process.stdout.write(chunk.text);
        break;
      case "reasoning-delta":
        process.stdout.write(chunk.text);
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
          process.stdout.write("\n");
          return { kind: "tool-call", id: chunk.block.id, name: chunk.block.name, args: parseArgs(chunk.block.arguments) };
        }
        break;
      case "usage":
        break;
      case "finish":
        break;
      default:
        break;
    }
  }
  const text = [...texts.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join("");
  if (wroteText) process.stdout.write("\n");
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
function observeRepeat(name2, argsJson) {
  const key = `${name2}(${argsJson})`;
  const count = lastCallKey === key ? lastCallCount + 1 : 1;
  lastCallKey = key;
  lastCallCount = count;
  return count;
}
let lastCallKey = "";
let lastCallCount = 0;
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
export {
  apply,
  inject,
  name
};
