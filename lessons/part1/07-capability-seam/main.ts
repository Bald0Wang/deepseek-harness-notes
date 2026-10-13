import type { Context } from '@deepseek-ai/cordis'
import type {} from './notifier.ts'

export const name = 'consumer'

export const inject = ['notifier']

// Consumer：只依赖抽象，不知道也不需要知道是哪个提供方
export function apply(ctx: Context) {
  ctx.on('notifier/send', (message) => {
    ctx.notifier.send(message)
  })

  ctx.emit('notifier/send', '构建完成')
  ctx.emit('notifier/send', '一切正常')
}
