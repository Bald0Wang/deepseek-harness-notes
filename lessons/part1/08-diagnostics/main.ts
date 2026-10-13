import type { Context } from '@deepseek-ai/cordis'
import type {} from './diagnose.ts'

export const name = 'main'

export const inject = ['diagnose']

// FiberState：0 PENDING / 1 LOADING / 2 ACTIVE / 3 FAILED / 4 UNLOADING / 5 DISPOSED

// 一个构造时就抛错的插件，用来看 FAILED 状态
export class BrokenPlugin {
  constructor(public ctx: Context) {
    throw new Error('boom：我在构造时炸了')
  }
}

export function apply(ctx: Context) {
  ctx.on('diagnose/report', (lines) => {
    console.log('=== 插件状态 ===')
    for (const line of lines) console.log(line)
  })

  // 1. 正常看一眼
  ctx.diagnose.report()

  // 2. 再加载一个会炸的插件，看它怎么变成 FAILED
  setTimeout(async () => {
    console.log('\n=== 加载一个会抛错的插件 ===')
    const fiber = ctx.plugin(BrokenPlugin)
    await fiber.await().catch((error) => {
      console.log('捕获到错误：', (error as Error).message)
    })
    console.log('\n=== 故障后重新看一眼 ===')
    ctx.diagnose.report()
  }, 100)
}
