const name = "timers";
function apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log("A \u5FC3\u8DF3");
    }, 100);
    return () => {
      clearInterval(timer);
      console.log("A \u6E05\u7406");
    };
  }, "timer-A");
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log("B \u5FC3\u8DF3");
    }, 100);
    return () => {
      clearInterval(timer);
      console.log("B \u6E05\u7406");
    };
  }, "timer-B");
  setTimeout(async () => {
    console.log("--- \u4E3B\u52A8\u5378\u8F7D\u63D2\u4EF6 ---");
    await ctx.fiber.dispose();
    console.log("--- \u5378\u8F7D\u5B8C\u6210\uFF0C\u8FDB\u7A0B\u9000\u51FA ---");
  }, 2e3);
}
export {
  apply,
  name
};
