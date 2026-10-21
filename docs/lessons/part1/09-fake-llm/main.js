const name = "consumer";
const inject = ["llm"];
function apply(ctx) {
  ctx.on("llm/generate", (input) => {
    void run(input);
  });
  ctx.emit("llm/generate", "\u4F60\u597D");
  setTimeout(() => ctx.emit("llm/generate", "\u73B0\u5728\u51E0\u70B9\u4E86\uFF1F"), 50);
  setTimeout(() => ctx.emit("llm/generate", "\u7B2C\u4E8C\u7BC7\u6211\u4EEC\u4F1A\u5B66\u5DE5\u5177"), 100);
  async function run(input) {
    const options = {
      messages: [{ role: "user", content: input }]
    };
    for await (const chunk of ctx.llm.stream(options)) {
      print(chunk);
    }
  }
  function print(chunk) {
    switch (chunk.type) {
      case "block-start":
        console.log(`--- \u5185\u5BB9\u5757\u5F00\u59CB\uFF08${chunk.blockType}\uFF09---`);
        break;
      case "text-delta":
        process.stdout.write(chunk.text);
        break;
      case "reasoning-delta":
        process.stdout.write(`[\u601D\u8003] ${chunk.text}`);
        break;
      case "tool-call-delta":
        console.log(`[\u5DE5\u5177\u8C03\u7528\u7247\u6BB5] id=${chunk.id} name=${chunk.name ?? "(\u540C\u4E0A)"} \u53C2\u6570=${chunk.argumentsDelta}`);
        break;
      case "block-end":
        console.log(`
--- \u5185\u5BB9\u5757\u7ED3\u675F\uFF1A${formatBlock(chunk.block)} ---`);
        break;
      case "usage":
        console.log(`[\u7528\u91CF] \u8F93\u5165 ${chunk.usage.inputTokens} / \u8F93\u51FA ${chunk.usage.outputTokens} tokens`);
        break;
      case "finish":
        console.log(`[\u7ED3\u675F] \u539F\u56E0\uFF1A${chunk.reason.kind}`);
        break;
    }
  }
}
function formatBlock(block) {
  switch (block.type) {
    case "text":
      return `\u6587\u5B57 "${block.text}"`;
    case "tool-call":
      return `\u5DE5\u5177 ${block.name}(${block.arguments})`;
  }
}
export {
  apply,
  inject,
  name
};
