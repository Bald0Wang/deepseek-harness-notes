import type { Context } from '@deepseek-ai/cordis'

// FiberState：0 PENDING / 1 LOADING / 2 ACTIVE / 3 FAILED / 4 UNLOADING / 5 DISPOSED
// FiberState 在 cordis 里是 const enum，npm 包中没有真实导出，直接用数字
const PENDING = 0

export const name = 'diagnose'

export function apply(ctx: Context) {
  setTimeout(() => {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === PENDING) {
          console.log(`${runtime.name} is PENDING — a required service is missing`)
        }
      }
    }
  }, 500)
}
