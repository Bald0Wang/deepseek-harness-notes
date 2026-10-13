import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'demo/transform'(input: string, next: () => Promise<string>): Promise<string>
  }
}

export const name = 'waterfall-demo'

export function apply(ctx: Context) {
  // 监听器 1：包住下游的结果（`_input` 是占位，TS 要求参数位置对上）
  ctx.on('demo/transform', async (_input, next) => {
    const downstream = await next()
    return downstream.toUpperCase()
  })

  // 监听器 2：自己就能决定时，直接短路（`_input` 是占位，TS 要求参数位置对上）
  ctx.on('demo/transform', async (_input, next) => {
    if (_input.includes('blocked')) return '** blocked **'
    return next()
  })

  void (async () => {
    console.log(await ctx.waterfall('demo/transform', 'hello', async () => 'hello'))
    console.log(await ctx.waterfall('demo/transform', 'blocked words', async () => 'blocked words'))
  })()
}
