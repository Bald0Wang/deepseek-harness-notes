const name = "user";
const inject = ["counter"];
function apply(ctx) {
  ctx.counter.increment();
  ctx.counter.increment();
  console.log("\u5F53\u524D\u8BA1\u6570\uFF1A", ctx.counter.value);
}
export {
  apply,
  inject,
  name
};
