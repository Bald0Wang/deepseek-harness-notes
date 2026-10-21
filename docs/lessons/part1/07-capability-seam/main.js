const name = "consumer";
const inject = ["notifier"];
function apply(ctx) {
  ctx.on("notifier/send", (message) => {
    ctx.notifier.send(message);
  });
  ctx.emit("notifier/send", "\u6784\u5EFA\u5B8C\u6210");
  ctx.emit("notifier/send", "\u4E00\u5207\u6B63\u5E38");
}
export {
  apply,
  inject,
  name
};
