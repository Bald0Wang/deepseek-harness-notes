import type { Context } from '@deepseek-ai/cordis'
import { Notifier } from './notifier.ts'

export const name = 'notifier-uppercase'

// 第二个提供方：全大写。和 console 版实现完全一致，只是 send 不同
export class UppercaseNotifier extends Notifier {
  send(message: string) {
    console.log(`[uppercase] ${message.toUpperCase()}`)
  }
}

export function apply(ctx: Context) {
  ctx.plugin(UppercaseNotifier)
}
