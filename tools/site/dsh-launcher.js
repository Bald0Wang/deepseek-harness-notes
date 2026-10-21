// 教学专用「浏览器启动器」——等价于仓库根目录的 launcher.ts。
//
// 区别只有两处：
// 1. cordis.yml 不通过 include 插件读取（它依赖磁盘上的 yml 写回），
//    而是直接 fetch 课程目录下的 cordis.yml 再解析；
// 2. 退出方式：Node 里进程自然退出即可，浏览器里由页面在输出平息后
//    调 dispose() 清掉计时器。
//
// 加载器、插件动态 import、生命周期报告（FiberState）与 launcher.ts 完全一致。

import { Context } from './cordis.js'
import Loader from './cordis-plugin-loader.js'
import { parseYmlEntries } from './yml-entries.js'

// FiberState：0 PENDING / 1 LOADING / 2 ACTIVE / 3 FAILED / 4 UNLOADING / 5 DISPOSED
const FiberState = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, UNLOADING: 4, DISPOSED: 5 }

/**
 * 运行一课。
 * @param lessonUrl 课程目录的绝对 URL（以 / 结尾），如 https://…/lessons/part1/01-first-plugin/
 * @param write 往终端写一行的回调（已含换行语义，传纯文本）
 * @param options.stripDisabled 为 true 时忽略 yml 里的 disabled 标记（教学启用模式）
 * @param options.manifestOverride 相对课程目录的 manifest 变体文件名（第 27 课真 API 模式用）
 */
export async function runLesson(lessonUrl, write, options = {}) {
  if (!lessonUrl.endsWith('/')) lessonUrl += '/'

  // manifest 覆盖钩子：plugin-directory 的补丁会优先读这个全局
  if (options.manifestOverride) {
    globalThis.__DSH_MANIFEST__ = new URL(options.manifestOverride, lessonUrl).href
  } else {
    delete globalThis.__DSH_MANIFEST__
  }

  const ctx = new Context()
  ctx.baseUrl = lessonUrl

  // 把日志打到页面终端：默认只有一个内存缓冲 exporter，不配置就什么都看不到
  ctx.logger.exporter({
    colors: 0,
    export: (message) => {
      const text = message.args
        .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg)))
        .join(' ')
      write(`[${message.name}] ${text}`)
    },
  })

  await ctx.plugin(Loader)

  const response = await fetch(new URL('cordis.yml', lessonUrl))
  if (!response.ok) throw new Error(`读取 cordis.yml 失败：HTTP ${response.status}`)
  const entries = parseYmlEntries(await response.text())
  for (const entry of entries) {
    if (options.stripDisabled) delete entry.disabled
    // Cordis Loader 会把条目名拼成绝对 URL 再动态 import，它的 .ts→.js
    // 改写只对 ./ 开头的相对串生效，绝对 URL 会原样发出（浏览器里 .ts
    // 的 MIME 不合法）。这里在条目名层面先把扩展名换成 .js。
    if (typeof entry.name === 'string' && entry.name.endsWith('.ts')) {
      entry.name = entry.name.replace(/\.ts$/, '.js')
    }
    await ctx.loader.create(entry)
  }

  // 等所有插件的加载/生命周期任务尘埃落定
  await ctx.loader.await()

  // 应用启动完成：谁没跑起来、为什么
  let hasFailure = false
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) {
      if (fiber.state === FiberState.ACTIVE) continue
      const name = fiber.name
      if (fiber.state === FiberState.PENDING) {
        write(`[launcher] 插件未激活（PENDING，可能在等待依赖）：${name}`)
      } else if (fiber.state === FiberState.FAILED) {
        write(`[launcher] 插件加载失败（FAILED）：${name}`)
        hasFailure = true
      }
    }
  }

  return { ctx, hasFailure }
}
