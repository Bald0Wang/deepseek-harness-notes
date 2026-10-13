import type { DirectoryManifest } from './plugin-directory.ts'

/**
 * 本目录的插件清单。
 *
 * 为什么不用 readdirSync 扫文件名？因为目录里迟早会出现
 * 不该被当成插件的东西——一个 `.bak`、一个临时的 `test.ts`、
 * 一个还没写完的草稿。**显式清单把"谁是插件"这个决定
 * 交回到写配置的人手里**，而不是交给文件系统的偶然状态。
 *
 * harness 真身的 packages/ 也是这个路子：一个目录是不是一个
 * 插件，看 package.json 的 exports 声明，不是看目录里有几个 .ts。
 */
export default {
  purpose: '目录即插件：把 provider、工具、agent loop 收进一个加载单位',
  plugins: [
    'provider.ts', // llm / tools / session 三个服务的唯一来源
    'weather.ts', // 往注册表里放一个工具
    'calc.ts', // 再放一个工具
    'session.ts', // 只增不减的磁盘日志
    'token-meter.ts', // 本课新增：给请求算 token 账
    'mock-provider.ts', // 假模型：不需要 API Key
    'main.ts', // agent loop（Consumer）
  ],
} satisfies DirectoryManifest
