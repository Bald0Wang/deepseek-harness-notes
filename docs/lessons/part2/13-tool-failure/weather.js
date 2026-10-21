import { defineTool } from "./define-tool.js";
const name = "weather-tool";
const inject = ["tools"];
function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "get_weather",
    description: "\u67E5\u8BE2\u4E00\u4E2A\u57CE\u5E02\u7684\u5929\u6C14\u3002\u9700\u8981\u57CE\u5E02\u540D\u3002",
    parameters: {
      city: {
        type: "string",
        required: true,
        description: '\u57CE\u5E02\u540D\uFF0C\u4F8B\u5982 "\u5317\u4EAC"'
      },
      unit: {
        type: "string",
        enum: ["celsius", "fahrenheit"],
        description: "\u6E29\u5EA6\u5355\u4F4D\uFF0C\u9ED8\u8BA4\u6444\u6C0F\u5EA6\u3002"
      }
    },
    async execute(args) {
      const city = String(args.city ?? "");
      const table = {
        \u5317\u4EAC: "\u6674\uFF0C12\xB0C",
        \u4E0A\u6D77: "\u5C0F\u96E8\uFF0C18\xB0C"
      };
      if (city === "\u706B\u661F") throw new Error("\u6C14\u8C61\u670D\u52A1\u8FDE\u63A5\u8D85\u65F6\uFF0830s\uFF09");
      const forecast = table[city] ?? "\u6674\uFF0C20\xB0C\uFF08\u9ED8\u8BA4\u503C\uFF09";
      const unit = args.unit === "fahrenheit" ? "\uFF08\u5DF2\u6362\u7B97\u4E3A\u534E\u6C0F\uFF09" : "";
      return `${city}\uFF1A${forecast}${unit}`;
    }
  }));
}
export {
  apply,
  inject,
  name
};
