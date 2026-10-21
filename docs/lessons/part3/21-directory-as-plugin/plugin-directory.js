import { Service } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";
const Config = Schema.object({
  root: Schema.string().default(".")
});
class PluginDirectory extends Service {
  constructor(ctx) {
    super(ctx, "pluginDirectory");
  }
}
class MapPluginDirectory extends PluginDirectory {
  async load(dir) {
    const manifestUrl = new URL(`${dir.replace(/\/$/, "")}/manifest.js`, this.ctx.baseUrl);
    const manifest = await import(globalThis.__DSH_MANIFEST__ ?? manifestUrl.href);
    let count = 0;
    for (const plugin of manifest.default.plugins) {
      const url = new URL(`${dir.replace(/\/$/, "")}/${plugin.replace(/\.ts$/, ".js")}`, this.ctx.baseUrl);
      await this.ctx.loader.create({ name: url.href });
      count += 1;
    }
    this.ctx.emit("plugin-directory/loaded", dir, count);
    return count;
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
    yield () => {
    };
    await this.load(this.#root);
  }
  /** 要加载的目录，由 apply 从配置里写进来。 */
  #root = ".";
  /** 记录要加载的目录。 */
  setRoot(root) {
    this.#root = root;
  }
}
function apply(ctx, config) {
  ctx.plugin(MapPluginDirectory);
  ctx.reflect.get("pluginDirectory", false)?.setRoot(config.root);
}
export {
  Config,
  MapPluginDirectory,
  PluginDirectory,
  apply
};
