import { Context } from '@deepseek-ai/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@deepseek-ai/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

// 把日志打到控制台：默认只有一个内存缓冲 exporter，不配置就什么都看不到
ctx.logger.exporter({
  colors: 0,
  export: (message) => {
    const text = message.args.map((arg) => arg instanceof Error ? (arg.stack ?? arg.message) : String(arg)).join(' ')
    console.log(`[${message.name}] ${text}`)
  },
})

// FiberState：0 PENDING / 1 LOADING / 2 ACTIVE / 3 FAILED / 4 UNLOADING / 5 DISPOSED
const FiberState = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, UNLOADING: 4, DISPOSED: 5 } as const

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@deepseek-ai/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})

// 等所有插件的加载/生命周期任务尘埃落定
await ctx.loader.await()

// 应用启动完成：谁没跑起来、为什么
let hasFailure = false
for (const runtime of ctx.registry.values()) {
  for (const fiber of runtime.fibers) {
    if (fiber.state === FiberState.ACTIVE) continue
    const name = fiber.name
    if (fiber.state === FiberState.PENDING) {
      console.log(`[launcher] 插件未激活（PENDING，可能在等待依赖）：${name}`)
    } else if (fiber.state === FiberState.FAILED) {
      console.log(`[launcher] 插件加载失败（FAILED）：${name}`)
      hasFailure = true
    }
  }
}

if (hasFailure) process.exitCode = 1
