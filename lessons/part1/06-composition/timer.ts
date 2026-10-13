import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    timer: Timer
  }
}

export class Timer extends Service {
  constructor(ctx: Context) {
    super(ctx, 'timer')
  }

  /** 等待指定毫秒 */
  sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
}

export const name = 'timer'

export function apply(ctx: Context) {
  ctx.plugin(Timer)
}
