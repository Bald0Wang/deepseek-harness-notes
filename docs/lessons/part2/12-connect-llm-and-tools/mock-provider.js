import { Llm } from "./llm.js";
function textResponse(text) {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    ...Array.from(text, (char) => ({ type: "text-delta", index: 0, text: char })),
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "usage", usage: { inputTokens: 10, outputTokens: text.length } },
    { type: "finish", reason: { kind: "stop" } }
  ];
}
function toolCallResponse(id, name2, args) {
  const argumentsJson = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id, name: name2, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: "tool-call-delta", index: 0, id, argumentsDelta: argumentsJson.slice(5) },
    { type: "block-end", index: 0, block: { type: "tool-call", id, name: name2, arguments: argumentsJson } },
    { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
    { type: "finish", reason: { kind: "tool-calls" } }
  ];
}
const name = "llm-mock";
class MockAdapter extends Llm {
  constructor(ctx, script) {
    super(ctx);
    this.script = script;
  }
  script;
  cursor = 0;
  async *stream(options) {
    const entry = this.script[this.cursor];
    if (!entry) throw new Error("MockAdapter: \u5267\u672C\u7528\u5B8C\u4E86");
    if (typeof entry !== "function") this.cursor += 1;
    const chunks = typeof entry === "function" ? entry(options) : entry;
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}
function decide(options) {
  const input = options.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
  if (input.includes("\u5317\u4EAC")) {
    return toolCallResponse("call-1", "get_weather", { city: "\u5317\u4EAC" });
  }
  if (input.includes("\u5929\u6C14")) {
    return toolCallResponse("call-2", "get_weather", { city: "\u5317\u4EAC" });
  }
  return textResponse(`\u6211\u4E0D\u77E5\u9053\u600E\u4E48\u56DE\u7B54"${input}"\uFF0C\u4F46\u6211\u53EF\u4EE5\u67E5\u5929\u6C14\u3002`);
}
function apply(ctx) {
  ctx.plugin(MockAdapter, [decide]);
}
export {
  MockAdapter,
  apply,
  decide,
  name,
  textResponse,
  toolCallResponse
};
