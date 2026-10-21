import { CHARS_PER_TOKEN, ROLE_OVERHEAD } from "./token-meter.js";
const name = "agent";
const inject = ["llm", "tools", "session", "tokenMeter"];
const TOOL_TIMEOUT_MS = 500;
const REPEAT_THRESHOLD = 3;
const MAX_RECOVERY_DEPTH = 2;
const CONTEXT_WINDOW = 320;
const THRESHOLD_RATIO = 0.8;
const RETAIN_TOKENS = 40;
const SUMMARY_MAX_TOKENS = 128;
const SUMMARY_OPEN_TAG = "<summary>";
const SUMMARY_CLOSE_TAG = "</summary>";
const COMPACTION_INSTRUCTION = [
  "You are a compaction engine. Condense the conversation ABOVE into a checkpoint that lets another model resume the work with no loss of essential context.",
  "",
  "Output EXACTLY the structure below, and wrap it in <summary> ... </summary> tags:",
  "",
  "## Primary Request and Intent",
  "- [\u7528\u6237\u6700\u521D\u7684\u76EE\u6807\uFF0C\u4EE5\u53CA\u5B83\u6709\u6CA1\u6709\u53D8\u8FC7]",
  "",
  "## Current Work",
  "- [\u6B64\u523B\u8FDB\u884C\u5230\u54EA\u4E00\u6B65\uFF0C\u6700\u8FD1\u4E00\u6B21\u4EA4\u4E92\u662F\u4EC0\u4E48]",
  "",
  "## Next Step",
  "- [\u63A5\u4E0B\u6765\u8BE5\u505A\u7684\u90A3\u4E00\u4EF6\u4E8B]",
  "",
  'Rules: \u7528\u4E2D\u6587\u5199\u8981\u70B9\uFF0C\u4E0D\u8981\u5199\u6BB5\u843D\u3002\u4FDD\u7559\u786E\u5207\u7684\u6587\u4EF6\u8DEF\u5F84\u3001\u547D\u4EE4\u3001\u9519\u8BEF\u5B57\u7B26\u4E32\u548C\u6570\u5B57\u3002\u4E0D\u8981\u63D0"\u8FD9\u662F\u4E00\u6B21\u538B\u7F29"\uFF0C\u4E5F\u4E0D\u8981\u8C03\u7528\u4EFB\u4F55\u5DE5\u5177\u3002'
].join("\n");
const FLUSH_BEFORE_REQUEST = true;
const SYSTEM_PROMPT = [
  "\u4F60\u662F deepseek-harness \u6559\u5B66\u7248\u7684\u52A9\u624B\uFF0C\u7528\u4E2D\u6587\u56DE\u7B54\u3002",
  "\u9700\u8981\u5916\u90E8\u6570\u636E\u65F6\u8C03\u7528\u5DE5\u5177\uFF0C\u4E0D\u8981\u7F16\u9020\u3002"
].join("\n");
function apply(ctx) {
  ctx.on("agent/turn", (input) => {
    void run(input);
  });
  ctx.on("agent/compact", (fromSeq, toSeq, summary) => {
    compact(fromSeq, toSeq, summary);
  });
  let events = 0;
  ctx.on("session/created", (_session, restored2) => {
    console.log(`[session \u4E00\u751F] \u95EE\u4E16\uFF08\u6062\u590D ${restored2} \u6761\uFF09`);
  });
  ctx.on("session/event", (_session, line) => {
    events += 1;
    console.log(`[session \u4E00\u751F] #${line.seq} ${line.type} \u843D\u5B9A\uFF08\u7D2F\u8BA1 ${events} \u6761\uFF09`);
  });
  ctx.on("session/flush", async () => {
    console.log("[session \u4E00\u751F] \u843D\u76D8\u5173\u5361\uFF1A\u65E5\u5FD7\u5DF2\u5168\u90E8\u5728\u76D8\u4E0A");
  });
  ctx.on("session/disposed", (_session) => {
    console.log(`[session \u4E00\u751F] \u5165\u571F\uFF08\u4E00\u751F\u5171 ${events} \u6761\u8BB0\u5F55\uFF09`);
  });
  ctx.on("agent/compact-begin", (fromSeq, toSeq) => {
    console.log(`[\u533A\u95F4\u9501] #${fromSeq}~#${toSeq} \u51BB\u7ED3\uFF0C\u5F00\u59CB\u751F\u6210\u6458\u8981`);
  });
  ctx.on("agent/compact-end", (fromSeq, toSeq, summarySeq) => {
    console.log(`[\u533A\u95F4\u9501] \u89E3\u51BB\uFF1A\u533A\u95F4\u6536\u6210 #${summarySeq}\uFF0C#${fromSeq}~#${toSeq} \u5C31\u6B64\u9000\u51FA\u6A21\u578B\u89C6\u91CE`);
  });
  ctx.effect(() => () => {
    ctx.session.dispose();
  }, "session.dispose");
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
    }
    reportCapabilities();
    replay();
    ctx.session.dispose();
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
    const options = {
      messages: ctx.session.deriveMessages(),
      system: SYSTEM_PROMPT,
      tools: ctx.tools.schemas()
    };
    await compactIfNeeded(options);
    measureRequest(options);
    if (FLUSH_BEFORE_REQUEST) {
      ctx.session.flush();
    }
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
        data: { callId: result.callId, name: result.name, value: result.value, isError: false }
      });
      const follow = {
        messages: ctx.session.deriveMessages(),
        system: SYSTEM_PROMPT,
        tools: ctx.tools.schemas()
      };
      await compactIfNeeded(follow);
      if (FLUSH_BEFORE_REQUEST) {
        ctx.session.flush();
      }
      const turn = await stream(ctx, follow);
      if (turn.kind === "text") {
        ctx.session.append({ type: "assistant/message", data: { text: turn.text } });
      }
      return;
    }
    console.log(`[\u5DE5\u5177\u5931\u8D25] ${result.error}`);
    ctx.session.append({
      type: "tool/result",
      data: { callId: result.callId, name: result.name, value: result.error, isError: true }
    });
    const repeats = observeRepeat(call.name, JSON.stringify(call.args));
    if (repeats >= REPEAT_THRESHOLD) {
      const notice = `\u4F60\u5DF2\u7ECF\u7528\u540C\u6837\u7684\u53C2\u6570\u8FDE\u7EED\u8C03\u4E86 ${repeats} \u6B21 ${call.name}\uFF0C\u8FD9\u6CA1\u6709\u8FDB\u5C55\u3002\u6362\u4E2A\u5DE5\u5177\u3001\u6362\u4E9B\u53C2\u6570\uFF0C\u6216\u8005\u76F4\u63A5\u544A\u8BC9\u7528\u6237\u4F60\u505A\u4E0D\u5230\u3002`;
      console.log(`[\u5FAA\u73AF\u63D0\u9192] ${notice}`);
      ctx.session.append({ type: "notice/message", data: { text: notice } });
    }
    const followUp = {
      messages: ctx.session.deriveMessages(),
      system: SYSTEM_PROMPT,
      tools: ctx.tools.schemas()
    };
    await compactIfNeeded(followUp);
    if (FLUSH_BEFORE_REQUEST) {
      ctx.session.flush();
    }
    const recovery = await stream(ctx, followUp);
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
  function measureRequest(options) {
    const budget = ctx.tokenMeter.measure(options.messages, toolsTokens(), systemTokens());
    console.log(
      `[\u9884\u7B97] \u672C\u6B21\u8BF7\u6C42 \u2248 ${budget.totalTokens} token\uFF08\u6D88\u606F ${budget.totalTokens - budget.toolsTokens - budget.systemTokens} + \u5DE5\u5177\u6E05\u5355 ${budget.toolsTokens} + \u7CFB\u7EDF\u63D0\u793A ${budget.systemTokens}\uFF0C\u7A97\u53E3 ${CONTEXT_WINDOW}\uFF0C\u9608\u503C ${thresholdTokens()}\uFF09`
    );
  }
  function systemTokens() {
    return Math.ceil(SYSTEM_PROMPT.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
  }
  function thresholdTokens() {
    return Math.floor(CONTEXT_WINDOW * THRESHOLD_RATIO);
  }
  async function compactIfNeeded(options) {
    const budget = ctx.tokenMeter.measure(options.messages, toolsTokens(), systemTokens());
    if (budget.totalTokens < thresholdTokens()) return;
    const lines = ctx.session.list();
    const surface = lines.filter((line) => line.surfaceOp !== void 0);
    let accumulated = 0;
    let keepFromIdx = surface.length;
    for (let index = surface.length - 1; index >= 0; index -= 1) {
      const line = surface[index];
      if (line === void 0) break;
      accumulated += ctx.tokenMeter.estimateMessage(toMessage(line));
      keepFromIdx = index;
      if (accumulated >= RETAIN_TOKENS) break;
    }
    if (keepFromIdx <= 1) return;
    const from = surface[0];
    const to = surface[keepFromIdx - 1];
    if (from === void 0 || to === void 0) return;
    console.log(
      `
[\u9884\u7B97\u544A\u6025] \u5386\u53F2 \u2248 ${budget.totalTokens} token \u8D85\u8FC7\u9608\u503C ${thresholdTokens()}\uFF0C\u6298\u6389 #${from.seq}~#${to.seq}\uFF0C\u4FDD\u7559\u6700\u8FD1 ${accumulated} token`
    );
    ctx.emit("agent/compact-begin", from.seq, to.seq);
    const summary = await summarize(from.seq, to.seq);
    const summarySeq = appendSummary(from.seq, to.seq, summary);
    ctx.emit("agent/compact-end", from.seq, to.seq, summarySeq);
    const before = budget.totalTokens;
    options.messages = ctx.session.deriveMessages();
    const after = ctx.tokenMeter.measure(options.messages, toolsTokens(), systemTokens());
    console.log(`[\u9884\u7B97] \u6298\u5B8C\u964D\u5230 \u2248 ${after.totalTokens} token\uFF0C\u7701\u4E86\u7EA6 ${before - after.totalTokens}`);
  }
  function appendSummary(fromSeq, toSeq, summary) {
    console.log(`
=== \u538B\u7F29\uFF1A#${fromSeq}~#${toSeq} \u6298\u6210\u4E00\u6761\u6458\u8981 ===`);
    const seq = ctx.session.append(
      { type: "assistant/message", data: { text: summary } },
      { op: "replace", startSeq: fromSeq, endSeq: toSeq }
    );
    console.log(`\u6458\u8981\u843D\u6210 #${seq}\uFF0C\u5B83\u9876\u6389\u4E86 #${fromSeq}~#${toSeq}`);
    return seq;
  }
  function toolsTokens() {
    const schemas = JSON.stringify(ctx.tools.schemas());
    return schemas.length === 0 ? 0 : Math.ceil(schemas.length / 4) + 4;
  }
  async function summarize(fromSeq, toSeq) {
    const replayed = ctx.session.list().filter((line) => line.seq >= fromSeq && line.seq <= toSeq && line.surfaceOp !== void 0).map(toMessage);
    const options = {
      messages: [
        ...replayed,
        { role: "user", content: COMPACTION_INSTRUCTION }
      ],
      system: SYSTEM_PROMPT,
      // **摘要请求不带工具清单**：它要的是一段文字，给工具只会
      // 诱导它去调用，而且白付几百 token 的 schema。真身也一样——
      // summarizer 的请求里 tools 是空的。
      maxTokens: SUMMARY_MAX_TOKENS,
      purpose: "compaction"
    };
    console.log("\n=== \u6458\u8981\u8BF7\u6C42\uFF1A\u8BA9\u6A21\u578B\u81EA\u5DF1\u5199 ===");
    const turn = await stream(ctx, options);
    if (turn.kind !== "text") {
      throw new Error("\u6458\u8981\u8BF7\u6C42\u8FD4\u56DE\u4E86\u5DE5\u5177\u8C03\u7528\u2014\u2014\u6458\u8981\u53EA\u80FD\u662F\u4E00\u6BB5\u6587\u5B57");
    }
    const summary = extractSummary(turn.text);
    if (summary.length === 0) {
      throw new Error("\u6458\u8981\u4E3A\u7A7A\uFF1A\u6A21\u578B\u6CA1\u6709\u5728 <summary> \u6807\u7B7E\u91CC\u7ED9\u51FA\u5185\u5BB9");
    }
    return summary;
  }
  function extractSummary(text) {
    const open = text.indexOf(SUMMARY_OPEN_TAG);
    const close = text.indexOf(SUMMARY_CLOSE_TAG);
    if (open === -1 || close === -1 || close < open) {
      throw new Error(`\u6458\u8981\u7F3A\u5C11\u95ED\u5408\u7684 ${SUMMARY_OPEN_TAG} \u6807\u7B7E\uFF1A${text}`);
    }
    return text.slice(open + SUMMARY_OPEN_TAG.length, close).trim();
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
function toMessage(line) {
  switch (line.type) {
    case "user/message":
      return { role: "user", content: line.data.content };
    case "assistant/message":
      return { role: "assistant", content: line.data.text };
    case "tool/result":
      return { role: "tool", content: String(line.data.value) };
    case "tool/call":
      return { role: "assistant", content: line.data.name };
    case "notice/message":
      return { role: "assistant", content: line.data.text };
  }
}
async function stream(ctx, options) {
  const texts = /* @__PURE__ */ new Map();
  const calls = /* @__PURE__ */ new Map();
  let wroteText = false;
  let spent = { inputTokens: 0, outputTokens: 0 };
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
          reportUsage(options.purpose, spent);
          return { kind: "tool-call", id: chunk.block.id, name: chunk.block.name, args: parseArgs(chunk.block.arguments) };
        }
        break;
      case "usage":
        spent = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens };
        break;
      case "finish":
        break;
      default:
        break;
    }
  }
  const text = [...texts.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join("");
  if (wroteText) process.stdout.write("\n");
  reportUsage(options.purpose, spent);
  return { kind: "text", text };
}
function reportUsage(purpose, spent) {
  const label = purpose === "compaction" ? "\u538B\u7F29" : "\u5BF9\u8BDD";
  console.log(
    `[${label}\u8D26] \u672C\u6B21\u771F\u5B9E\u82B1\u8D39\uFF1A\u8F93\u5165 ${spent.inputTokens} + \u8F93\u51FA ${spent.outputTokens} = ${spent.inputTokens + spent.outputTokens} token`
  );
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
