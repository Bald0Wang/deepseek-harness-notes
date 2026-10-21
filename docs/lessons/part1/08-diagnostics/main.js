const name = "main";
const inject = ["diagnose"];
class BrokenPlugin {
  constructor(ctx) {
    this.ctx = ctx;
    throw new Error("boom\uFF1A\u6211\u5728\u6784\u9020\u65F6\u70B8\u4E86");
  }
  ctx;
}
function apply(ctx) {
  ctx.on("diagnose/report", (lines) => {
    console.log("=== \u63D2\u4EF6\u72B6\u6001 ===");
    for (const line of lines) console.log(line);
  });
  ctx.diagnose.report();
  setTimeout(async () => {
    console.log("\n=== \u52A0\u8F7D\u4E00\u4E2A\u4F1A\u629B\u9519\u7684\u63D2\u4EF6 ===");
    const fiber = ctx.plugin(BrokenPlugin);
    await fiber.await().catch((error) => {
      console.log("\u6355\u83B7\u5230\u9519\u8BEF\uFF1A", error.message);
    });
    console.log("\n=== \u6545\u969C\u540E\u91CD\u65B0\u770B\u4E00\u773C ===");
    ctx.diagnose.report();
  }, 100);
}
export {
  BrokenPlugin,
  apply,
  inject,
  name
};
