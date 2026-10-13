import type { Context } from '@deepseek-ai/cordis'
import { Notifier } from './notifier.ts'

export const name = 'notifier-console'

// Service Provider：具体实现——打到控制台
export class ConsoleNotifier extends Notifier {
  send(message: string) {
    console.log(`[console] ${message}`)
  }
}

export function apply(ctx: Context) {
  ctx.plugin(ConsoleNotifier)
}
