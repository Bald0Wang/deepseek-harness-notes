import { Service } from "@deepseek-ai/cordis";
class Timer extends Service {
  constructor(ctx) {
    super(ctx, "timer");
  }
  /** 等待指定毫秒 */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
const name = "timer";
function apply(ctx) {
  ctx.plugin(Timer);
}
export {
  Timer,
  apply,
  name
};
