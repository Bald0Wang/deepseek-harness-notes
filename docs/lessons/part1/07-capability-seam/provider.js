import { Notifier } from "./notifier.js";
const name = "notifier-console";
class ConsoleNotifier extends Notifier {
  send(message) {
    console.log(`[console] ${message}`);
  }
}
function apply(ctx) {
  ctx.plugin(ConsoleNotifier);
}
export {
  ConsoleNotifier,
  apply,
  name
};
