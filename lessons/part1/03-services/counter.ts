import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    counter: Counter
  }
}

// Counter 是一个"挂到 ctx 上的具名 API"
export class Counter extends Service {
  private count = 0

  constructor(ctx: Context) {
    super(ctx, 'counter')
  }

  increment() {
    return ++this.count
  }

  get value() {
    return this.count
  }
}

export const name = 'counter'

export function apply(ctx: Context) {
  ctx.plugin(Counter)
}
