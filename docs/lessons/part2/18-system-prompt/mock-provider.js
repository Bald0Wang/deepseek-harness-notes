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
  const system = options.messages.filter((message) => message.role === "system").at(-1)?.content ?? "";
  const persona = system.includes("\u8BED\u6C14") ? "\u793C\u8C8C" : "\u968F\u610F";
  const hasTools = system.includes("get_weather");
  const history = options.messages;
  const input = history.at(-1)?.content ?? "";
  if (input.includes("\xB0C")) {
    const tail = persona === "\u793C\u8C8C" ? "\u3002\u53E6\u5916\u63D0\u9192\u60A8\uFF0C\u51FA\u95E8\u8BF7\u914C\u60C5\u643A\u5E26\u96E8\u5177\u3002" : "\u3002\u51FA\u95E8\u770B\u60C5\u51B5\u5E26\u628A\u4F1E\u3002";
    return textResponse(`${input}${tail}`);
  }
  if (input.includes("\u521A\u624D")) {
    const summary = options.messages.find((message) => message.content.startsWith("\uFF08\u6458\u8981\uFF09"));
    if (summary) return textResponse("\u4F60\u95EE\u4E86\u6211\u5317\u4EAC\u5929\u6C14\uFF0C\u6211\u67E5\u5B8C\u8FD8\u63D0\u9192\u4E86\u4F60\u5E26\u4F1E\u3002");
    return textResponse("\u6211\u6CA1\u6709\u5386\u53F2\u8BB0\u5FC6\uFF0C\u6BCF\u6B21\u8BF7\u6C42\u53EA\u5E26\u5F53\u524D\u8FD9\u4E00\u53E5\u3002");
  }
  if (input.includes("\u5317\u4EAC")) {
    return toolCallResponse("call-1", "get_weather", { city: "\u5317\u4EAC" });
  }
  if (system.includes("\u53EA\u56DE\u7B54\u5929\u6C14")) {
    if (persona === "\u793C\u8C8C") {
      return textResponse("\u62B1\u6B49\uFF0C\u6211\u662F\u4E00\u4E2A\u5929\u6C14\u52A9\u624B\uFF0C\u53EA\u80FD\u56DE\u7B54\u5929\u6C14\u76F8\u5173\u7684\u95EE\u9898\u3002");
    }
    return textResponse("\u6211\u53EA\u7BA1\u5929\u6C14\uFF0C\u522B\u7684\u95EE\u4E0D\u4E86\u3002");
  }
  if (input.includes("\u8BD7")) {
    if (!hasTools) return textResponse("\u6211\u6CA1\u6709\u5DE5\u5177\u53EF\u7528\u3002");
    return textResponse("\u6674\u7A7A\u4E00\u5B57\u4E00\u884C\u8BD7\uFF0C\u4E91\u843D\u679D\u5934\u5316\u4F5C\u96E8\u3002");
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
