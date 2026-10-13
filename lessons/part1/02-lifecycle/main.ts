import type { Context } from '@deepseek-ai/cordis'

export const name = 'timers'

export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('A 心跳')
    }, 100)
    // 资源名
    return () => {
      clearInterval(timer)
      console.log('A 清理')
    }
  }, 'timer-A')

  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('B 心跳')
    }, 100)
    return () => {
      clearInterval(timer)
      console.log('B 清理')
    }
  }, 'timer-B')

  // 2 秒后手动卸载自己
  setTimeout(async () => {
    console.log('--- 主动卸载插件 ---')
    await ctx.fiber.dispose()
    console.log('--- 卸载完成，进程退出 ---')
  }, 2000)
}
