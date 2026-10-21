const name = "agent";
const inject = ["tools"];
function apply(ctx) {
  ctx.on("agent/turn", async (input) => {
    console.log(`
=== \u7528\u6237\u8BF4\uFF1A${input} ===`);
    for (const definition of ctx.tools.list()) {
      console.log(`[\u53EF\u7528\u5DE5\u5177] ${definition.name} \u2014 ${definition.description}`);
    }
    const call = matchTool(input);
    if (!call) {
      console.log("[\u6A21\u578B] \u8FD9\u4E2A\u95EE\u9898\u4E0D\u7528\u5DE5\u5177\uFF0C\u76F4\u63A5\u56DE\u7B54\u3002");
      return;
    }
    console.log(`[\u6A21\u578B\u51B3\u5B9A] \u8C03\u7528 ${call.name}\uFF0C\u53C2\u6570 ${JSON.stringify(call.args)}`);
    const result = await ctx.tools.call(call.name, call.args);
    if (result.ok) {
      console.log(`[\u5DE5\u5177\u8FD4\u56DE] ${String(result.value)}`);
    } else {
      console.log(`[\u5DE5\u5177\u5931\u8D25] ${result.error}`);
    }
  });
  setTimeout(() => ctx.emit("agent/turn", "\u5317\u4EAC\u5929\u6C14\u600E\u4E48\u6837\uFF1F"), 50);
  setTimeout(() => ctx.emit("agent/turn", "\u628A\u6E29\u5EA6\u6362\u6210\u534E\u6C0F"), 100);
  setTimeout(() => ctx.emit("agent/turn", "\u7A7A\u53C2\u6570"), 150);
  setTimeout(() => ctx.emit("agent/turn", "\u5355\u4F4D\u7528\u9519"), 200);
}
function matchTool(input) {
  const cities = ["\u5317\u4EAC", "\u4E0A\u6D77"];
  const city = cities.find((name2) => input.includes(name2));
  if (city) return { name: "get_weather", args: { city } };
  if (input.includes("\u534E\u6C0F")) return { name: "get_weather", args: { city: "\u5317\u4EAC", unit: "fahrenheit" } };
  if (input === "\u7A7A\u53C2\u6570") return { name: "get_weather", args: {} };
  if (input === "\u5355\u4F4D\u7528\u9519") return { name: "get_weather", args: { city: "\u5317\u4EAC", unit: "kelvin" } };
  return null;
}
export {
  apply,
  inject,
  name
};
