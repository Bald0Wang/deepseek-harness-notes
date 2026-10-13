import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    diagnose: Diagnose
  }
  interface Events {
    'diagnose/report'(lines: string[]): void
  }
}

export class Diagnose extends Service {
  constructor(ctx: Context) {
    super(ctx, 'diagnose')
  }

  /** 汇总当前所有插件的状态 */
  report() {
    const lines: string[] = []
    for (const runtime of this.ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        const state = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'UNLOADING', 'DISPOSED'][fiber.state] ?? fiber.state
        lines.push(`${runtime.name ?? '(匿名)'}: ${state}`)
      }
    }
    this.ctx.emit('diagnose/report', lines)
    return lines
  }
}

export const name = 'diagnose-service'

export function apply(ctx: Context) {
  ctx.plugin(Diagnose)
}
