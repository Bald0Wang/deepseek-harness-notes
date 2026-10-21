import { Notifier } from "./notifier.js";
const name = "notifier-uppercase";
class UppercaseNotifier extends Notifier {
  send(message) {
    console.log(`[uppercase] ${message.toUpperCase()}`);
  }
}
function apply(ctx) {
  ctx.plugin(UppercaseNotifier);
}
export {
  UppercaseNotifier,
  apply,
  name
};
