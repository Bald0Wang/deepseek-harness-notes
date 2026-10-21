import { Service } from "@deepseek-ai/cordis";
class StatsService extends Service {
  counts = /* @__PURE__ */ new Map();
  constructor(ctx) {
    super(ctx, "stats");
  }
  bump(name2) {
    const next = (this.counts.get(name2) ?? 0) + 1;
    this.counts.set(name2, next);
    this.ctx.emit("stats/report", name2, next);
  }
}
const name = "stats";
function apply(ctx) {
  ctx.plugin(StatsService);
}
export {
  StatsService,
  apply,
  name
};
