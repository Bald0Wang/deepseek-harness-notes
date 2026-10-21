const name = "reporter";
const inject = ["stats"];
function apply(ctx) {
  ctx.on("stats/report", (name2, count) => {
    console.log(`[stats] ${name2} -> ${count}`);
  });
  ctx.stats.bump("tool_call");
  ctx.stats.bump("tool_call");
  ctx.stats.bump("prompt");
}
export {
  apply,
  inject,
  name
};
