# 21 · 目录即插件：一个文件夹就是一个插件

> 源码：[plugin-directory.ts](./plugin-directory.ts) · [manifest.ts](./manifest.ts)　配置：[cordis.yml](./cordis.yml)

上一课结束时，我们的 [cordis.yml](./cordis.yml) 长这样：

```yaml
- name: './provider.ts'
- name: './weather.ts'
- name: './calc.ts'
- name: './session.ts'
- name: './mock-provider.ts'
- name: './main.ts'
```

六行，六个文件。它能跑，但它把一件事摊在了明面上：**yml 知道每一个插件的文件名。**

这意味着什么？意味着这个能力集合只要动一次——加个工具、拆个模块、把一个 provider 换成两个——你就得回去改 yml。yml 是入口文件，是给人看的"这个应用由什么组成"的那张清单。让它记住 `weather.ts` 和 `calc.ts` 这种实现细节，是把两层东西搅在了一起。

本课把它拆开。改完之后：

```yaml
- name: './plugin-directory.ts'
  config:
    root: '.'
```

就两行。**yml 只声明"去加载这个目录"，至于目录里是谁，写目录的人自己知道。**

## 先看它怎么跑

```bash
rm -rf .sessions && node --import tsx/esm ../../../launcher.ts
```

输出和第 20 课**一模一样**——工具两个、三轮对话、压缩落成 #11、能力对账三项全齐、日志 11 条。这不是巧合，是本课的目的：**换了一种加载方式，行为一点没变。**

```
=== 没有找到历史，开一个新会话 ===

=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。出门看情况带把伞。
...
=== 能力对账 ===
- llm：齐
- tools：齐
- session：齐

=== 日志全量（11 条）===
#1 [user/message] 北京天气怎么样？
...
#11 [assistant/message] （摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。　← replace #1~#10
```

六行 yml 变成两行，跑出来的东西一模一样。

## 代码：两个文件

本课只加了两个文件，别的都没动。

### manifest.ts —— 谁是插件

```ts
export default {
  purpose: '目录即插件：把 provider、工具、agent loop 收进一个加载单位',
  plugins: [
    'provider.ts',
    'weather.ts',
    'calc.ts',
    'session.ts',
    'mock-provider.ts',
    'main.ts',
  ],
} satisfies DirectoryManifest
```

一个普通的对象，`default` 导出。`purpose` 是给人看的，`plugins` 是给加载器看的——**一个字符串数组，列这个目录里哪些文件是插件。**

注意这一行是 `satisfies DirectoryManifest`，不是 `: DirectoryManifest`。区别在第 05 课见过：前者做类型检查但不改变推导出的类型，所以 `manifest.default.plugins` 拿到的还是字面量 `string[]`，编译器能盯着它。

### plugin-directory.ts —— 文件夹变成加载单位

```ts
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
}
```

三行核心逻辑，一句一句看：

1. **拼出 `manifest.ts` 的 URL，`import()` 它。** `this.ctx.baseUrl` 是 cordis.yml 所在的目录（第 03 课讲 `baseUrl` 时用过），所以 `'.'` 就解析成本目录。
2. **遍历 `plugins`，每个都 `ctx.loader.create({ name })`。** 这正是第 18 课 yml 里的 `- name: './main.ts'` 在底层做的事——loader 的 `create()` 接收一个条目，自己 import 模块、unwrap exports、注册插件。我们只是把"写死在 yml 里的六行"搬进了循环。
3. **`emit` 一个事件。** `'plugin-directory/loaded'` 声明在文件顶部的 `declare module` 块里，带 `@mode emit`。谁想监听"目录扫完了"就 `ctx.on` 一下——这是第 04 课的事件，本课用它报个信。

`load()` 是 `async` 的，而且**里面是串行 `await`**，不是 `Promise.all`。为什么？因为插件的加载顺序是有意义的——第 19 课的依赖拓扑就靠顺序（`provider` 得先于 `agent`，工具得先于 `agent` 的对账）。并行加载会让拓扑变成"运气"。

## 显式清单 vs 目录扫描

这是本课真正想让你记住的取舍。

`load()` 完全可以不读 manifest，改成：

```ts
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.ts')) continue
  await this.ctx.loader.create({ name: `${dir}/${file}` })
}
```

少写一个文件，还能自动认新插件——听起来更好？**不。** 三个理由：

1. **目录里迟早有不该加载的东西。** 一个 `.bak`、一个临时的 `test.ts`、一个你写到一半的草稿。扫描方案会把它们全当成插件 import 进去，草稿的语法错误会让整个启动失败。
2. **顺序失控。** `readdirSync` 的返回顺序由文件系统决定，不同平台不一样。而我们需要 `provider` 在 `main` 之前。
3. **"谁是插件"变成了一件碰运气的事。** 显式清单把决定权交回写配置的人手里：想加载，写进数组；不想，放着不管。

harness 真身就是这么做的——`packages/` 下有 50 多个目录，cordis 不会去扫它们，每个目录里的 `package.json` 自己声明 `exports`，**声明了才是插件，没声明就只是个文件夹。**

## 时序：一个真实的坑

这个 `load()` 该在哪调用？第一反应是 `apply` 里：

```ts
export async function apply(ctx: Context, config: Config) {
  ctx.plugin(MapPluginDirectory)
  await ctx.pluginDirectory.load(config.root)   // ← 这样不行
}
```

跑一下，你会看到：

```
[include] Error: cannot get property "pluginDirectory" without inject
    at Object.apply (plugin-directory.ts:90:13)
[launcher] 插件加载失败（FAILED）：Include
```

**退出码 1，`apply` 里那一行当场炸。** 这个错误你在第 20 课见过——`cannot get property "X" without inject`，反射层抛的。区别是：这次我们明明刚 `ctx.plugin(MapPluginDirectory)` 登记过它。

原因在第 20 课那张表里：`ctx.plugin()` 只是**登记**了一个 fiber，这个 fiber 要等自己的依赖齐了、被 loader 调度到，才会变成 ACTIVE。而 `apply` 函数体执行的时候，本插件的 fiber 还在激活过程中——**服务登记在名册上了，但还没"上架"。**

cordis 的解法是 `[Service.init]` 钩子，[vendor/cordis/src/service.ts 第 13 行](../../../deepseek-harness/vendor/cordis/src/service.ts#L13)：

```ts
/** Symbol key of an instance method run after construction (class plugins). */
static readonly init: unique symbol = symbols.init
```

一个类的生成器方法，`yield` 出去的函数是卸载回调，`yield` 之后的部分在 fiber 激活后跑。真身的 [cordis-plugin-include](../../../deepseek-harness-notes/node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js) 就是这么用的——它在 `[Service.init]` 里 `yield () => this.stop()`，然后才 `await this.root.update(...)` 去挂载 yml 里的条目。

我们的版本：

```ts
async *[Service.init]() {
  yield () => {}
  await this.load(this.#root)
}
```

`yield () => {}` 是个空的卸载回调（我们没有要停的东西），真正的加载在 `yield` 之后。这样跑，就通了。

`#root` 从哪来？`apply(ctx, config)` 里存进去的：

```ts
export function apply(ctx: Context, config: Config) {
  ctx.plugin(MapPluginDirectory)
  ctx.reflect.get('pluginDirectory', false)?.setRoot(config.root)
}
```

注意这里是 `ctx.reflect.get('pluginDirectory', false)`，不是 `ctx.pluginDirectory`。**同一个服务，两条取值的路。** `ctx.pluginDirectory` 走反射代理，要 fiber ACTIVE；`ctx.reflect.get()` 直接查实例表，`false` 参数表示"取不到别抛错"。apply 里能用的只有后者。

这正是第 20 课说的"读名册不读实例"的反面：那次我们**故意不读实例**，这次我们**必须读实例**——要往它身上写一个字段。两种读法，对应两种时机。

## 配置怎么流到这里

`config` 是第二参数，第 05 课的写法：

```ts
export interface Config {
  /** 目录路径，相对 cordis.yml 所在位置。 */
  root: string
}

export const Config: Schema<Config> = Schema.object({
  root: Schema.string().default('.'),
})
```

yml 里 `config: { root: '.' }`。不写也行——schema 的 `.default('.')` 会补上。这和第 05 课 `greeting` 的行为一样：**`apply` 收到的 config 永远是完整的。**

## 动手改一改

**实验一：把它改回扫描版。** 把 `load()` 换成：

```ts
async load(dir: string): Promise<number> {
  let count = 0
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file === 'manifest.ts') continue
    await this.ctx.loader.create({ name: new URL(`${dir}/${file}`, this.ctx.baseUrl).href })
    count += 1
  }
  return count
}
```

跑。**它炸了**，而且炸得比你能想到的更早：

```
[map-plugin-directory] Error: invalid plugin, expect function or object with an "apply" method, received object
    at Proxy.plugin (cordis/lib/index.js:1621:24)
    at async MapPluginDirectory.load (plugin-directory.ts:68:7)
[launcher] 插件未激活（PENDING，可能在等待依赖）：calc-tool
```

为什么？因为这个目录里**不止有插件。** 除了六个插件，还有四个库文件：

| 文件 | 是什么 |
|---|---|
| [llm.ts](./llm.ts) | `LlmAdapter` 接口、`StreamChunk` 类型——被 import 的，不是插件 |
| [tools.ts](./tools.ts) | `ToolRegistry` 抽象类——同上 |
| [define-tool.ts](./define-tool.ts) | 工具定义的 helper——同上 |
| [json-schema.ts](./json-schema.ts) | 手写 JSON Schema 生成——同上 |

它们只导出接口和类，**没有 `apply`。** 扫描版把它们也当成插件递给了 loader，cordis 在注册时逐个检查"你总得是个函数或者带 apply 的对象"，当场抓住。

这就是扫描方案的真实死法，比我预想的还准：**"目录里哪些文件是插件"这个问题，文件系统答不了。** 一个文件夹里同时住着插件、接口、helper 和草稿，只有写代码的人知道谁是谁。`manifest.ts` 就是把这件事写下来。

（顺带一说：报错里那个 `calc-tool` PENDING 也值得看一眼。loader 在 `load()` 的循环里抛错，后面的插件一个都没注册，于是声明了 `tools` 的 `calc-tool` 就一直等——故障沿着依赖链往下传。）

**实验二：清单里加一个不存在的文件。** 在 `manifest.ts` 的 `plugins` 里加一行 `'nope.ts'`，跑：

```
[loader] Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../21-directory-as-plugin/nope.ts' imported from .../cordis-plugin-loader/lib/index.js
    at finalizeResolution (node:internal/modules/esm/resolve:274:11)
    ...
```

模块路径完整可读，报错来自 `[loader]`（不是 `[include]`——yml 已经不含 include 的条目列表了，这次是 `load()` 里的 `ctx.loader.create()` 直接踩空的）。然后**其他插件照常加载，程序继续跑完，退出码 0。**

这和第 20 课实验一不一样，值得说清楚：那次 yml 里写错路径，include 在加载阶段就炸，FAILED + 退出码 1；这次路径错在**运行中途动态创建**的条目里，`loader.create()` 抛出的错误被 loader 自己接住记了日志，没有上升到 fiber 的 `_error`。**同一个错误，两种上报路径，取决于它是静态条目还是动态条目。**

想让它在启动时就 FAILED 也不难——把 `load()` 里的 `await` 换成不接错的，或者让 `load` 返回后由 apply 检查 count。但教学版先这样：错误看得见、路径读得懂、程序不装死。

**实验三：删掉 manifest.ts 里的一行。** 把 `'weather.ts'` 从清单里删掉，跑：

```
=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具失败] 工具不存在：get_weather

=== 用户说：帮我算 7*6 ===
[模型决定] 调用 calc，参数 {"a":7,"b":6,"op":"*"}
[工具返回] 7 * 6 = 42
[模型回答] 算好了：7 * 6 = 42
```

**和上一课实验二一模一样。** 天气工具静默消失，假模型照样按写死的 if 决定调 `get_weather`，工具层答"工具不存在"，loop 没崩，继续算下一题。

`[工具失败]` 这行来自 [provider.ts](./provider.ts) 的 `call()`：注册表里查不到这个名字，返回失败而不是抛异常——**能力可以静默消失，但调用它的那一侧必须有话可说。** 第 23 课我们会把这个失败变成真正有用的错误恢复。

值得对照的是上一课的同一个实验：那次问题出在 yml，你要在六行里找哪行被注释了；这次问题只能在 manifest 里，而 manifest 本来就一件事——**列清单。** 排查面变小了。

## 小结

- **yml 声明"加载哪个目录"，manifest 声明"目录里谁是插件"**：入口文件和实现细节分开
- `manifest.ts` 是普通模块，`default` 导出 `{ purpose, plugins }`
- `load()` 读 manifest → 逐个 `ctx.loader.create()`，串行 `await` 保住加载顺序
- **显式清单 > 目录扫描**：目录里会有不该加载的文件，扫描顺序也不可控；真身靠 `package.json` 的 `exports` 声明同理
- `apply` 里取不到刚登记的服务（fiber 未 ACTIVE），`[Service.init]` 生成器钩子才是"激活后跑"的位置
- `ctx.reflect.get(name, false)` 是"读实例"的直路，`ctx.X` 是"经反射"的大路，时机不同路不同

下一篇：22 · 流式 loop
