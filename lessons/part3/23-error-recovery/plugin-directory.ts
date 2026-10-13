import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * 目录加载器扫完一个目录，往 cordis 里加了一批插件。
     * @param dir - 被扫描的目录（相对路径）。
     * @param count - 从这个目录里加载了几个插件。
     * @mode emit
     */
    'plugin-directory/loaded'(dir: string, count: number): void
  }
}

/** 一个目录里的插件清单。 */
export interface DirectoryManifest {
  /** 这个目录是干什么的，出现在启动日志里。 */
  readonly purpose: string
  /** 插件文件列表，相对本目录。 */
  readonly plugins: readonly string[]
}

/** 插件配置：加载哪个目录。 */
export interface Config {
  /** 目录路径，相对 cordis.yml 所在位置。 */
  root: string
}

/** 同名 schema 给 Cordis 看：运行前验证，缺的补默认值。 */
export const Config: Schema<Config> = Schema.object({
  root: Schema.string().default('.'),
})

/**
 * 目录加载器：扫一个文件夹，把里面的插件一个个递给 cordis。
 *
 * 本课的主题。`ctx.loader.create()` 一次只认一个文件，
 * 而一个能力（比如"工具"）通常长在一个文件夹里。
 * 这个 Service 把"文件夹"变成加载单位。
 */
export abstract class PluginDirectory extends Service {
  constructor(ctx: Context) { super(ctx, 'pluginDirectory') }

  /**
   * 加载一个目录。
   * @param dir - 目录路径，相对 cordis.yml 所在位置。
   * @returns 从这个目录里加载了几个插件。
   */
  abstract load(dir: string): Promise<number>
}

/**
 * Service Provider：读 manifest.ts，逐个 ctx.loader.create。
 *
 * 为什么不直接 `readdirSync` 扫文件？因为**显式清单比目录扫描安全**：
 * 一个 `_backup.ts`、一个临时 `test.ts` 都会被扫进来，而它们可能
 * 不是插件，或者是不该现在加载的插件。harness 真身的
 * packages/ 也是靠 package.json 的 exports 声明，不是扫文件名。
 */
export class MapPluginDirectory extends PluginDirectory {
  async load(dir: string): Promise<number> {
    const manifestUrl = new URL(`${dir.replace(/\/$/, '')}/manifest.ts`, this.ctx.baseUrl)
    const manifest = (await import(manifestUrl.href)) as { default: DirectoryManifest }

    let count = 0
    for (const plugin of manifest.default.plugins) {
      const url = new URL(`${dir.replace(/\/$/, '')}/${plugin}`, this.ctx.baseUrl)
      await this.ctx.loader.create({ name: url.href })
      count += 1
    }

    this.ctx.emit('plugin-directory/loaded', dir, count)
    return count
  }

  /**
   * 插件启动钩子：本 fiber 激活后才跑，此时服务已经能从 ctx 上取到。
   *
   * 为什么不在 `apply()` 里直接 `await ctx.pluginDirectory.load()`？
   * 因为 `ctx.plugin(X)` 只是**登记**了服务，要等这个插件的 fiber
   * 真正激活（ACTIVE）之后，`ctx.pluginDirectory` 才取得出来。
   * 在 apply 里伸手，只会拿到
   * `cannot get property "pluginDirectory" without inject`。
   *
   * 这个钩子的调用时机正好：apply 跑完、fiber 就绪。
   */
  async *[Service.init]() {
    yield () => {}
    await this.load(this.#root)
  }

  /** 要加载的目录，由 apply 从配置里写进来。 */
  #root = '.'

  /** 记录要加载的目录。 */
  setRoot(root: string) {
    this.#root = root
  }
}

/**
 * 应用入口：登记服务，把配置里的目录记下来。
 *
 * 真正的加载发生在 `[Service.init]` 钩子里——那时本插件的 fiber 已激活，
 * `ctx.pluginDirectory` 取得出来，而且能安全地往 loader 里添新条目。
 */
export function apply(ctx: Context, config: Config) {
  ctx.plugin(MapPluginDirectory)
  ctx.reflect.get('pluginDirectory', false)?.setRoot(config.root)
}
