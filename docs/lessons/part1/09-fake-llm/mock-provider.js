import { Llm } from "./llm.js";
function textResponse(text) {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    // 一个字符一条 delta，模拟真实模型逐字吐字
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
  async *stream(options) {
    const entry = this.script.shift();
    if (!entry) throw new Error("MockAdapter: \u5267\u672C\u7528\u5B8C\u4E86");
    const chunks = typeof entry === "function" ? entry(options) : entry;
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}
function apply(ctx) {
  ctx.plugin(MockAdapter, [
    textResponse("\u4F60\u597D\uFF0C\u6211\u662F\u5047\u6A21\u578B\u3002"),
    toolCallResponse("call-1", "get_weather", { city: "\u5317\u4EAC" }),
    (options) => {
      const last = options.messages.at(-1)?.content ?? "";
      return textResponse(`\u4F60\u521A\u624D\u8BF4\uFF1A${last}`);
    }
  ]);
}
export {
  MockAdapter,
  apply,
  name,
  textResponse,
  toolCallResponse
};
