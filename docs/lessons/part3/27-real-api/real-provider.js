import { Llm } from "./llm.js";
const name = "llm-deepseek";
const inject = ["llm"];
const BASE_URL = "https://api.deepseek.com/anthropic";
const MESSAGES_PATH = "/messages";
const MODEL = "deepseek-flash";
const REQUEST_TIMEOUT_MS = 6e4;
const API_KEY_ENV = "DEEPSEEK_API_KEY";
function toWireMessages(messages) {
  const wire = [];
  for (const message of messages) {
    const role = message.role === "tool" ? "user" : message.role;
    const block = message.role === "tool" ? {
      type: "tool_result",
      tool_use_id: message.callId ?? "",
      content: [{ type: "text", text: message.content }]
    } : { type: "text", text: message.content };
    const previous = wire.at(-1);
    if (previous !== void 0 && previous.role === role) {
      previous.content.push(block);
      continue;
    }
    wire.push({ role, content: [block] });
  }
  return wire;
}
async function* readSse(body) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
        if (data.length > 0) yield JSON.parse(data);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
async function* translateSse(events) {
  const blocks = /* @__PURE__ */ new Map();
  const identities = /* @__PURE__ */ new Map();
  const toolJson = /* @__PURE__ */ new Map();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let sawStop = false;
  for await (const event of events) {
    switch (event.type) {
      case "message_start": {
        const message = event.message ?? {};
        const initial = message.usage ?? {};
        usage.inputTokens = initial.input_tokens ?? 0;
        usage.outputTokens = initial.output_tokens ?? 0;
        break;
      }
      case "content_block_start": {
        const index = Number(event.index ?? 0);
        const block = event.content_block ?? {};
        if (block.type === "text") {
          blocks.set(index, { type: "text", text: String(block.text ?? "") });
          yield { type: "block-start", index, blockType: "text" };
          const initial = String(block.text ?? "");
          if (initial.length > 0) yield { type: "text-delta", index, text: initial };
        } else if (block.type === "tool_use") {
          const id = String(block.id ?? "");
          const name2 = String(block.name ?? "");
          identities.set(index, { id, name: name2 });
          toolJson.set(index, "");
          yield { type: "block-start", index, blockType: "tool-call" };
          yield { type: "tool-call-delta", index, id, name: name2, argumentsDelta: "" };
        }
        break;
      }
      case "content_block_delta": {
        const index = Number(event.index ?? 0);
        const delta = event.delta ?? {};
        if (delta.type === "text_delta") {
          const text = String(delta.text ?? "");
          const block = blocks.get(index);
          if (block?.type === "text") block.text += text;
          yield { type: "text-delta", index, text };
        } else if (delta.type === "input_json_delta") {
          const argumentsDelta = String(delta.partial_json ?? "");
          toolJson.set(index, (toolJson.get(index) ?? "") + argumentsDelta);
          const identity = identities.get(index);
          yield { type: "tool-call-delta", index, id: identity?.id ?? "", argumentsDelta };
        }
        break;
      }
      case "content_block_stop": {
        const index = Number(event.index ?? 0);
        const block = blocks.get(index);
        if (block !== void 0) {
          yield { type: "block-end", index, block };
        } else {
          const identity = identities.get(index);
          yield {
            type: "block-end",
            index,
            block: {
              type: "tool-call",
              id: identity?.id ?? "",
              name: identity?.name ?? "",
              arguments: toolJson.get(index) ?? ""
            }
          };
        }
        break;
      }
      case "message_delta": {
        const delta = event.delta ?? {};
        const reason = String(delta.stop_reason ?? "");
        if (reason === "end_turn" || reason === "stop_sequence") {
          yield { type: "finish", reason: { kind: "stop" } };
        } else if (reason === "tool_use") {
          yield { type: "finish", reason: { kind: "tool-calls" } };
        } else if (reason === "max_tokens") {
          yield { type: "finish", reason: { kind: "max-tokens" } };
        }
        const deltaUsage = event.usage ?? {};
        usage.outputTokens = deltaUsage.output_tokens ?? usage.outputTokens;
        sawStop = true;
        break;
      }
      case "message_stop":
        sawStop = true;
        break;
      case "error": {
        const error = event.error ?? {};
        throw new Error(`DeepSeek \u62A5\u9519\uFF1A${String(error.message ?? JSON.stringify(event))}`);
      }
    }
  }
  if (!sawStop) throw new Error("\u6D41\u5728 message_stop \u4E4B\u524D\u5C31\u65AD\u4E86");
  yield { type: "usage", usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } };
}
class DeepSeekAdapter extends Llm {
  constructor(ctx) {
    super(ctx);
  }
  async *stream(options) {
    const apiKey = process.env[API_KEY_ENV];
    if (apiKey === void 0 || apiKey.length === 0) {
      throw new Error(`\u6CA1\u8BFB\u5230 ${API_KEY_ENV}\u2014\u2014export \u4E4B\u540E\u518D\u8DD1\uFF0C\u6216\u8005\u56DE\u5230 mock-provider`);
    }
    const request = {
      model: MODEL,
      stream: true,
      max_tokens: options.maxTokens ?? 1024,
      messages: toWireMessages(options.messages),
      // 清单为空时**整个字段都不发**。真身
      // serialize.ts:156 就是这个写法：`...options.tools === undefined ? {} : {...}`。
      // 空数组和"没有这个字段"在协议里不是一个意思——后者才是"别调工具"。
      ...options.tools === void 0 || options.tools.length === 0 ? {} : {
        tools: options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters
        }))
      },
      // 系统提示同理：没有就不发这个字段。真身把 options.system
      // 和历史里的系统提示用空行拼起来，教学版只有一次请求一个来源。
      ...options.system === void 0 || options.system.length === 0 ? {} : { system: options.system }
    };
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
    }, REQUEST_TIMEOUT_MS);
    if (options.signal !== void 0) {
      if (options.signal.aborted) abort.abort();
      else options.signal.addEventListener("abort", () => {
        abort.abort();
      }, { once: true });
    }
    try {
      const response = await fetch(`${BASE_URL}${MESSAGES_PATH}`, {
        method: "POST",
        headers: {
          // Messages 协议的鉴权头。真身叫 x-api-key，不是
          // OpenAI 那套 Authorization: Bearer。
          "content-type": "application/json",
          "x-api-key": apiKey
        },
        body: JSON.stringify(request),
        signal: abort.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`DeepSeek HTTP ${response.status}\uFF1A${text.slice(0, 200)}`);
      }
      if (response.body === null) throw new Error("DeepSeek \u54CD\u5E94\u6CA1\u6709 body");
      yield* translateSse(readSse(response.body));
    } finally {
      clearTimeout(timer);
    }
  }
}
function apply(ctx) {
  if (process.env[API_KEY_ENV] === void 0 || process.env[API_KEY_ENV] === "") {
    console.log(`[provider] \u6CA1\u8BFB\u5230 ${API_KEY_ENV}\uFF0C\u8DF3\u8FC7\u771F\u6A21\u578B\u2014\u2014\u672C\u8BFE\u5269\u4E0B\u7684\u90E8\u5206\u7167\u6837\u8DD1\uFF08\u7528 mock\uFF09`);
    return;
  }
  ctx.plugin(DeepSeekAdapter);
  console.log(`[provider] \u771F\u6A21\u578B\u5DF2\u6CE8\u518C\uFF1A${MODEL} @ ${BASE_URL}`);
}
export {
  DeepSeekAdapter,
  apply,
  inject,
  name,
  toWireMessages
};
