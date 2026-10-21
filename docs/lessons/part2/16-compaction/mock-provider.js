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
  const history = options.messages;
  const input = history.at(-1)?.content ?? "";
  if (input.includes("\xB0C")) {
    return textResponse(`${input}\u3002\u51FA\u95E8\u770B\u60C5\u51B5\u5E26\u628A\u4F1E\u3002`);
  }
  if (input.includes("\u521A\u624D")) {
    const sawRaw = history.some((message) => message.role === "tool");
    if (sawRaw) return textResponse("\u4F60\u6CA1\u6709\u5386\u53F2\u8BB0\u5FC6\uFF0C\u6BCF\u6B21\u8BF7\u6C42\u53EA\u5E26\u5F53\u524D\u8FD9\u4E00\u53E5\u3002");
    const summary = history.find((message) => message.content.startsWith("\uFF08\u6458\u8981\uFF09"));
    if (summary) return textResponse("\u6211\u53EA\u8BB0\u5F97\u4E00\u4EFD\u6458\u8981\uFF1A\u4F60\u95EE\u4E86\u5317\u4EAC\u5929\u6C14\uFF0C\u522B\u7684\u7EC6\u8282\u88AB\u538B\u6389\u4E86\u3002");
    return textResponse("\u6211\u6CA1\u6709\u5386\u53F2\u8BB0\u5FC6\uFF0C\u6BCF\u6B21\u8BF7\u6C42\u53EA\u5E26\u5F53\u524D\u8FD9\u4E00\u53E5\u3002");
  }
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
