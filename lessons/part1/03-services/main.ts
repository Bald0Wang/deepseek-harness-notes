import type { Context } from '@deepseek-ai/cordis'

export const name = 'user'

// inject：本插件需要 counter 服务，否则一直等着
export const inject = ['counter']

export function apply(ctx: Context) {
  ctx.counter.increment()
  ctx.counter.increment()
  console.log('当前计数：', ctx.counter.value)
}
