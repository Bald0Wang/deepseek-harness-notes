import { Service } from "@deepseek-ai/cordis";
class Diagnose extends Service {
  constructor(ctx) {
    super(ctx, "diagnose");
  }
  /** 汇总当前所有插件的状态 */
  report() {
    const lines = [];
    for (const runtime of this.ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        const state = ["PENDING", "LOADING", "ACTIVE", "FAILED", "UNLOADING", "DISPOSED"][fiber.state] ?? fiber.state;
        lines.push(`${runtime.name ?? "(\u533F\u540D)"}: ${state}`);
      }
    }
    this.ctx.emit("diagnose/report", lines);
    return lines;
  }
}
const name = "diagnose-service";
function apply(ctx) {
  ctx.plugin(Diagnose);
}
export {
  Diagnose,
  apply,
  name
};
