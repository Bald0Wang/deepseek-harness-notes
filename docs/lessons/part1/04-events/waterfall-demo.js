const name = "waterfall-demo";
function apply(ctx) {
  ctx.on("demo/transform", async (_input, next) => {
    const downstream = await next();
    return downstream.toUpperCase();
  });
  ctx.on("demo/transform", async (_input, next) => {
    if (_input.includes("blocked")) return "** blocked **";
    return next();
  });
  void (async () => {
    console.log(await ctx.waterfall("demo/transform", "hello", async () => "hello"));
    console.log(await ctx.waterfall("demo/transform", "blocked words", async () => "blocked words"));
  })();
}
export {
  apply,
  name
};
