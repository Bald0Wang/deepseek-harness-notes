import { defineTool } from "./define-tool.js";
const name = "calc-tool";
const inject = ["tools"];
function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "calc",
    description: "\u7B97\u4E00\u9053\u56DB\u5219\u8FD0\u7B97\u3002\u652F\u6301\u52A0\u51CF\u4E58\u9664\u3002",
    parameters: {
      a: { type: "number", required: true, description: "\u5DE6\u64CD\u4F5C\u6570" },
      b: { type: "number", required: true, description: "\u53F3\u64CD\u4F5C\u6570" },
      op: { type: "string", enum: ["+", "-", "*", "/"], description: "\u8FD0\u7B97\u7B26" }
    },
    execute(args) {
      const a = Number(args.a);
      const b = Number(args.b);
      switch (args.op) {
        case "+":
          return `${a} + ${b} = ${a + b}`;
        case "-":
          return `${a} - ${b} = ${a - b}`;
        case "*":
          return `${a} * ${b} = ${a * b}`;
        case "/":
          return `${a} / ${b} = ${b === 0 ? "\u9664\u6570\u4E0D\u80FD\u4E3A 0" : a / b}`;
        default:
          return `\u4E0D\u652F\u6301\u7684\u8FD0\u7B97\u7B26\uFF1A${String(args.op)}`;
      }
    }
  }));
}
export {
  apply,
  inject,
  name
};
