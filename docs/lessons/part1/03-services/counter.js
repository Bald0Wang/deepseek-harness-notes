import { Service } from "@deepseek-ai/cordis";
class Counter extends Service {
  count = 0;
  constructor(ctx) {
    super(ctx, "counter");
  }
  increment() {
    return ++this.count;
  }
  get value() {
    return this.count;
  }
}
const name = "counter";
function apply(ctx) {
  ctx.plugin(Counter);
}
export {
  Counter,
  apply,
  name
};
