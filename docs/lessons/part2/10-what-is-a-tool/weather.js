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
      }
    },
    async execute(args) {
      const city = String(args.city ?? "");
      const table = {
        \u5317\u4EAC: "\u6674\uFF0C12\xB0C",
        \u4E0A\u6D77: "\u5C0F\u96E8\uFF0C18\xB0C"
      };
      const forecast = table[city] ?? "\u6674\uFF0C20\xB0C\uFF08\u9ED8\u8BA4\u503C\uFF09";
      return `${city}\uFF1A${forecast}`;
    }
  }));
}
export {
  apply,
  inject,
  name
};
