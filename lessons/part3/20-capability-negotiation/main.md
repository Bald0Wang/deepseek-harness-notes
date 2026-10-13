# 20 · 能力协商：缺什么，启动时就炸

> 源码：[main.ts](./main.ts) · [weather.ts](./weather.ts) · [calc.ts](./calc.ts) · [session.ts](./session.ts) · [provider.ts](./provider.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [json-schema.ts](./json-schema.ts) · [llm.ts](./llm.ts)　配置：[cordis.yml](./cordis.yml)

第 19 课结束时，加一个工具只要"写一个文件 + yml 加一行"。听起来很爽，但它藏了一个坑：

**如果 yml 里漏了一行呢？**

```yaml
- name: './provider.ts'
- name: './weather.ts'
- name: './calc.ts'
# - name: './session.ts'   ← 手滑注释掉了
- name: './mock-provider.ts'
- name: './main.ts'
```

`main.ts` 里写着 `ctx.session.append(...)`。第 03 课我们就定过规矩：**要拿 `ctx` 上的服务，必须先声明 `inject`。** [main.ts](./main.ts) 声明了：

```ts
export const inject = ['llm', 'tools', 'session']
```

也就是说，这个插件**知道自己要什么**。问题是：谁替它检查这些真的要到了？本课就补这一段——`agent` 不再假设 `session` 一定在，它把需求表摊开，让 cordis 在启动时核对。

## inject 到底是什么

它不是什么语法糖，就是一行普通的模块导出：

```ts
export const inject = ['llm', 'tools', 'session']
```

一个字符串数组，写着"我的 `apply` 会用到这三个服务"。cordis 的 loader 在加载插件时读它，做两件事：

1. **排加载顺序**——你要的服务先建好，再轮到你（第 19 课讲的依赖拓扑，靠的就是它）
2. **建一张需求表**——`ctx.fiber.inject`，cordis 拿着它一直盯着

第 19 课只讲了第 1 件。第 2 件才是本课。

## 三种"能力缺失"，三种下场

我们做三组对照，把能力一个个弄没。

### 情况一：yml 里漏掉 provider（PENDING）

把 [cordis.yml](./cordis.yml) 里的 `- name: './session.ts'` 注释掉，跑：

```bash
rm -rf .sessions && node --import tsx/esm ../../../launcher.ts
```

```
[launcher] 插件未激活（PENDING，可能在等待依赖）：agent
---- exit code: 0 ----
```

就这一行。然后呢？**然后就没了。** `agent` 插件的 `apply` 从未执行，一条日志都没写，磁盘上干干净净，进程平静退出，退出码 0。

这正是 `inject` 干的事：`session` 不在，cordis 就**不让这个插件活**。不是等 `ctx.session.append()` 踩空了才炸，是压根不启动。

反过来说，这也是它的危险处：**太安静了。** 一个 PENDING 的 agent 什么都不做、什么都不报，只是安静地不存在。如果你在排查"为什么它不理我"，第一眼完全看不出问题在哪。

### 情况二：忘了写 inject（FAILED）

再把 yml 恢复，改成另一种坏法——把 [weather.ts](./weather.ts) 的 `inject` 注释掉：

```ts
// export const inject = ['tools']   ← 注释掉这行
export function apply(ctx: Context) {
  ctx.tools.register(...)   // 但 apply 里直接用了 ctx.tools
}
```

跑：

```
[weather-tool] Error: cannot get property "tools" without inject
    at new apply (weather.ts:18:7)
    at Fiber.execute (cordis/lib/index.js:1068:24)
[launcher] 插件加载失败（FAILED）：weather-tool
---- exit code: 1 ----
```

**退出码 1。** 报错直接指着 `weather.ts:18`，就是那行 `ctx.tools.register(...)`。

区别在哪？实验一里，插件"声明了但没要到"，cordis 替它把关，它自己都没醒。实验二里，插件"没声明就伸手"，`apply` 函数体跑起来了，在 `ctx.tools` 这一下上被 cordis 的代理当场抓住。

那句 `cannot get property "tools" without inject` 出自 cordis 内核的反射层——[vendor/cordis/src/reflect.ts 第 144 行](../../../deepseek-harness/vendor/cordis/src/reflect.ts#L144)：

```ts
const error = new Error(`cannot get property "${prop}" without inject`)
```

`ctx` 是个代理。你访问 `ctx` 上任一属性，它先查你的需求表（`fiber.inject`）；表里没有这个名字，就抛这个错。**不是"取不到返回 undefined"，是抛错。** 这是 cordis 的选择：宁可在第一行代码上炸，也不给一个静默的 `undefined` 让你带进生产。

### 情况三：全齐（ACTIVE）

两种坏法都试完，恢复正常，`rm -rf .sessions` 跑一次：

```bash
rm -rf .sessions && node --import tsx/esm ../../../launcher.ts
```

```
=== 没有找到历史，开一个新会话 ===
=== 模型能选的工具 ===
- get_weather：查询一个城市的天气。需要城市名。
- calc：算一道四则运算。支持加减乘除。

=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。出门看情况带把伞。

=== 用户说：帮我算 7*6 ===
[模型决定] 调用 calc，参数 {"a":7,"b":6,"op":"*"}
[工具返回] 7 * 6 = 42
[模型回答] 算好了：7 * 6 = 42

=== 用户说：你好 ===
[模型回答] 我不知道怎么回答"你好"，但我可以查天气、也会算数。

=== 压缩：#1~#10 折成一条摘要 ===
摘要落成 #11，它顶掉了 #1~#10

=== 能力对账 ===
- llm：齐
- tools：齐
- session：齐

=== 日志全量（11 条）===
#1 [user/message] 北京天气怎么样？
#2 [tool/call] get_weather({"city":"北京"})
#3 [tool/result] 北京：晴，12°C
#4 [assistant/message] 北京：晴，12°C。出门看情况带把伞。
#5 [user/message] 帮我算 7*6
#6 [tool/call] calc({"a":7,"b":6,"op":"*"})
#7 [tool/result] 7 * 6 = 42
#8 [assistant/message] 算好了：7 * 6 = 42
#9 [user/message] 你好
#10 [assistant/message] 我不知道怎么回答"你好"，但我可以查天气、也会算数。
#11 [assistant/message] （摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。　← replace #1~#10

=== 模型看到的历史（折叠后 1 条）===
[assistant] （摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。
```

最后那个 `=== 能力对账 ===` 就是本课新增的代码，下面讲它。

## PENDING 还是 FAILED：一张表

三次实验整理成一张表。这张表是 cordis fiber 状态机的外在表现：

| 场景 | fiber 状态 | 你会看到什么 | 退出码 |
|---|---|---|---|
| 忘了写 `inject`，`apply` 里直接 `ctx.tools` | **FAILED** | 报错指向 `apply` 里那一行 + `[launcher] 插件加载失败（FAILED）` | **1** |
| 写了 `inject`，但没人提供这个服务 | **PENDING** | 只有 `[launcher] 插件未激活（PENDING，可能在等待依赖）` | 0 |
| 声明了，也有人提供 | **ACTIVE** | 什么都不打印，正常跑 | 0 |

cordis 内核对状态的定义在 [vendor/cordis/src/fiber.ts 第 574 行](../../../deepseek-harness/vendor/cordis/src/fiber.ts#L574)，五行业务判断：

```ts
private _getState() {
  if (this.uid === null) return FiberState.DISPOSED
  if (this._error) return FiberState.FAILED
  if (this._runner.epoch !== INACTIVE) return FiberState.ACTIVE
  return FiberState.PENDING
}
```

读法很直白：`_error` 有值就是 FAILED——而 `_error` 只在 `_reload()` 的 catch 里被赋值，也就是 **`apply` 函数体自己抛了错**。实验二走的就是这条路。

`epoch` 是什么？[同文件第 611 行](../../../deepseek-harness/vendor/cordis/src/fiber.ts#L611)的 `_refresh()`：

```ts
for (const name of Object.keys(this.inject)) {
  const impl = this._store[name]
  if (!impl) {
    epoch = INACTIVE
    break
  }
  epoch += ':' + impl.fiber.uid
}
```

它遍历你的需求表，**缺一个就置 `INACTIVE`**。没有 `_error`、epoch 又是 `INACTIVE`，状态就落到最后一行：PENDING。

所以两个状态的判据完全不同：**FAILED 是"你的代码炸了"，PENDING 是"你的代码还没被允许运行"。** 前者是你的 bug，后者是环境没配齐——yml 漏了一行、某个 provider 自己 FAILED 了、或者它还在异步加载中。

harness 真身对这个区别有一处直接证据——[packages/boot/plugin-manager/tests/manager.spec.ts 第 822 行](../../../deepseek-harness/packages/boot/plugin-manager/tests/manager.spec.ts#L822)：

```ts
writeFileSync(join(dir, 'node_modules/broken/pending.mjs'), 'export const inject = ["unavailable"]; export function apply() {}')
```

注意这个测试夹具的名字就叫 `pending`，文件内容跟我们的实验一一模一样：**声明了一个不存在的服务，`apply` 是空的。** harness 在这里断言整个 bundle 的 `application` 是 `'failed'`——也就是说在 harness 眼里，PENDING 和 FAILED 一样是失败，只是报告方式不同（`warnings` 而不是异常）。

而我们的 [launcher.ts](../../launcher.ts) 只对 FAILED 置退出码 1：

```ts
if (fiber.state === FiberState.PENDING) {
  console.log(`[launcher] 插件未激活（PENDING，可能在等待依赖）：${name}`)
} else if (fiber.state === FiberState.FAILED) {
  console.log(`[launcher] 插件加载失败（FAILED）：${name}`)
  hasFailure = true
}
```

**这不是 bug，是教学取舍。** PENDING 有一条正当用途：插件可以合法地"等一个将来才出现的服务"（第 19 课的工具就是先登记、后注册）。如果 PENDING 一律置 1，那种正常模式会被误杀。harness 用 plugin-manager 的 `application` 字段在更高的层级上判失败，我们这里只把话说出来，把判断权交给你。

## reportCapabilities()：启动时对一次账

现在看本课新增的代码。[main.ts](./main.ts) 的 `apply` 末尾：

```ts
function reportCapabilities() {
  console.log('\n=== 能力对账 ===')
  for (const service of Object.keys(ctx.fiber.inject)) {
    const registered = Object.hasOwn(ctx.reflect.props, service)
    const status = registered ? '齐' : '缺'
    console.log(`- ${service}：${status}`)
    if (!registered) {
      console.log(`  没人提供 ${service}——cordis.yml 里少了一个 provider，或者它自己加载失败了`)
    }
  }
}

setTimeout(reportCapabilities, 300)
```

两行核心：

- `ctx.fiber.inject` —— **我声明要的**（需求表）
- `ctx.reflect.props` —— **全应用登记过的**（服务名册）

需求表和名册一减，缺谁一目了然。而且这是在**启动阶段**减的，不是等某次调用踩空了才炸。

有个细节值得说：为什么读 `props`（登记册），不读 `store`（实例表）？因为第 19 课的工具就是**先登记、后注册**的——`tools` 这个服务在 `apply` 执行的那一刻，`store` 里可能还没有值，但 `props` 里已经有名字了。缺名字才是真缺，缺实例可能只是还没轮到。

把它和实验一对照看更有意思：实验一里 `agent` 是 PENDING，`apply` 从没执行，所以**这行对账根本没机会打印**。它只在插件真的活下来之后才有意义——活下来之后，它回答的是另一个问题："我现在靠的这些东西，还在吗？" yml 改坏了、provider 挂了、热重载丢了一个，对账都能在启动日志里指出来。

## 真身的 inject：不止一种写法

我们的 `inject` 是字符串数组。harness 真身 100+ 个插件全用这个写法，随便挑几个：

```ts
// packages/workflow/tool-workflow/src/index.ts:41
export const inject = ['tools', 'workflowEngine', 'systemPrompt']

// packages/acp/acp/src/index.ts:62
export const inject = ['agents', 'llm', 'sessionPersistence', 'sessions']

// packages/web/tool-web/src/index.ts:24
export const inject = ['tools', 'web', 'systemPrompt']
```

看出规律了吗：**一个插件要什么，看 `inject` 第一行就知道。** 不需要读完 500 行实现。这是 cordis 的"接口即文档"——依赖声明就是最好的架构图。

但数组只是三种写法里最土的一种。cordis 内核 [vendor/cordis/src/registry.ts 第 19 行](../../../deepseek-harness/vendor/cordis/src/registry.ts#L19) 的定义：

```ts
export type Inject<M = Dict> = (keyof M)[] | { [K in keyof M]?: M[K] }
```

第二种是对象，value 可以是**拦截配置**——拿到这个服务后怎么包一层。第一种是数组，等价于 `result[name] = null`，见 [同文件第 71 行的 `Inject.resolve`](../../../deepseek-harness/vendor/cordis/src/registry.ts#L71)：

```ts
export function resolve(inject: Inject | null | undefined, result: Dict = Object.create(null)) {
  if (!inject) return result
  if (Array.isArray(inject)) {
    for (const name of inject) result[name] = null
  } else if (Reflect.has(inject, symbols.checkProto)) {
    // 类继承：把父类的 inject 也并进来
    Object.assign(result, resolve(Object.getPrototypeOf(inject)))
    for (const name of Object.keys(inject)) result[name] = inject[name] ?? null
  } else {
    for (const name of Object.keys(inject)) result[name] = inject[name] ?? null
  }
  return result
}
```

三种输入——数组、对象、带原型标记的类——归一化成同一张 `name → 配置` 的表。**这就是 `fiber.inject` 的真身**，我们 `Object.keys(ctx.fiber.inject)` 读的那张表。

第三种写法最妙：`Reflect.has(inject, symbols.checkProto)` 那个分支处理的是**类继承**。一个插件用 `class` 写，父类声明了一部分 `inject`，子类再补几个——`resolve` 会先递归父类，再并上自己的。数组做不到这件事，所以真身留了这个口子。

还有一处：**cordis.yml 自己也能声明 inject。** [vendor/loader/src/index.ts 第 134 行](../../../deepseek-harness/vendor/loader/src/index.ts#L134)：

```ts
ctx.on('internal/plugin', (fiber) => {
  if (fiber.parent[Entry.key] && !fiber.entry) {
    fiber.entry = fiber.parent[Entry.key]
    Inject.resolve(fiber.entry!.options.inject, fiber.inject)
  }
```

loader 监听 `internal/plugin` 事件，把 entry 上配的 `inject` 也 `resolve` 进 `fiber.inject`。entry 的字段定义在 [vendor/loader/src/config/entry.ts 第 22 行](../../../deepseek-harness/vendor/loader/src/config/entry.ts#L21-L22)：

```ts
/** Required services or service intercept config for this entry. */
inject?: Inject | null
```

**配置文件和代码是同一个字段。** 也就是说，yml 里可以这么写：

```yaml
- name: './main.ts'
  inject:
    - tools
    - session
```

代码里那行 `export const inject` 就可以省了。两种来源汇进同一张表，这就是为什么 `reportCapabilities()` 只读 `fiber.inject` 就够——它不关心需求是谁提的。

## 动手改一改

**实验一：打错一个文件名。** 把 [cordis.yml](./cordis.yml) 里 `./provider.ts` 改成 `./provider-x.ts`（一个不存在的文件），跑：

```
[include] Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../17-capability-negotiation/provider-x.ts' imported from .../cordis-plugin-loader/lib/index.js
[launcher] 插件未激活（PENDING，可能在等待依赖）：weather-tool
---- exit code: 0 ----
```

两件事发生了。include 插件在**加载阶段**就炸了——文件找不到，这不是能力缺失，是路径写错。而 `weather-tool` 变成 PENDING：它 inject 了 `tools`，`tools` 的 provider 没加载成，所以它跟着一起等。**故障会沿着依赖链往上爬。**

再改成另一种坏法——把 `- name: './provider.ts'` 整行注释掉（文件还在，只是不加载）：

```
[launcher] 插件未激活（PENDING，可能在等待依赖）：agent
[launcher] 插件未激活（PENDING，可能在等待依赖）：weather-tool
[launcher] 插件未激活（PENDING，可能在等待依赖）：calc-tool
---- exit code: 0 ----
```

**四个插件一起 PENDING。** provider 是 `llm` / `tools` / `session` 三个服务的唯一来源，它一撤，所有声明了这些服务的插件全部停摆——包括两个工具插件，它们只 inject 了 `tools`。

把这两种坏法放在一起看：**文件写错路径 → 加载器当场报错；文件好好地不在 yml 里 → 一整片插件安静地 PENDING。** 前者你有 stack trace，后者你只有一句"可能在等待依赖"。这就是为什么对账必须做，而且要做得显眼。

**实验二：给 weather-tool 加一个要不着的服务。** 在 [weather.ts](./weather.ts) 里加一行 `export const inject = ['tools', 'noSuchService']`，跑：

```
[launcher] 插件未激活（PENDING，可能在等待依赖）：weather-tool
=== 模型能选的工具 ===
- calc：算一道四则运算。支持加减乘除。

=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具失败] 工具不存在：get_weather

=== 用户说：帮我算 7*6 ===
[模型决定] 调用 calc，参数 {"a":7,"b":6,"op":"*"}
[工具返回] 7 * 6 = 42
```

注意后半截：**程序照跑，只是少了一个工具。** 天气工具静默消失，模型还能算数。第 19 课我们说过"加一个工具，`main.ts` 一行都不用改"；反过来也成立：**少一个工具，也一行都不用改。**

但最值得看的是第 5、6 行。假模型的"大脑"是写死的 if——它不认识 `noSuchService`，它只知道用户问天气就该调 `get_weather`。而 `get_weather` 已经没了。于是：

```
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具失败] 工具不存在：get_weather
```

**模型决定调一个不存在的工具，loop 没有崩，工具层答了"工具不存在"。** 这就是 PENDING 最阴险的地方：它不报错，只是让你少一块功能。而你少的那块功能，可能要到某个用户问到天气时才暴露——那时候它在生产环境里。

`[工具失败]` 这行来自 [provider.ts](./provider.ts) 的 `call()`：注册表里查不到这个名字，返回 `{ ok: false, error: '工具不存在：...' }`，而不是抛异常。**能力可以静默消失，但调用它的那一侧必须有话可说。** 第 23 课我们会把这个 `ok: false` 变成真正有用的错误恢复。

**实验三：读一次名册。** 在 `reportCapabilities()` 里加两行，看看全应用都登记了哪些服务：

```ts
console.log(`\n名册上有 ${Object.keys(ctx.reflect.props).length} 个服务：`)
console.log(Object.keys(ctx.reflect.props).join(', '))
```

你会看到 `llm`、`tools`、`session` 之外还有一堆 `internal/*`——那些是 cordis 和 loader 自己的。**名册比你的需求表大得多，但你的插件只能碰自己声明过的那几个。** 这不是限制，是隔离：一个工具插件看不到 session 服务，哪怕它就在同一个 `ctx` 上。

## 小结

- `inject` 是插件的需求表：cordis 拿它排加载顺序（第 19 课），也拿它建 `ctx.fiber.inject` 盯着你（本课）
- **忘了写 `inject` 就伸手 → FAILED**：`cannot get property "X" without inject`，报错指向 `apply` 里那一行，退出码 1
- **写了 `inject` 但没人提供 → PENDING**：`apply` 从不执行，只有 launcher 一句提示，退出码 0
- 两个状态的判据在内核里隔着两行：`_error` 有值是 FAILED（你的代码炸了），`epoch === INACTIVE` 是 PENDING（你的代码没被允许运行）
- `Inject.resolve` 把数组、对象、类继承三种声明归一化成同一张表；cordis.yml 的 entry 级 `inject` 汇进同一张表
- `reportCapabilities()` 用 `ctx.fiber.inject` × `ctx.reflect.props` 对账，读名册不读实例——先登记后注册是正常模式
- 最重要的那条：**PENDING 太安静了。** 功能会静默消失，所以对账必须有人做，而且要在启动日志里做得显眼

下一篇：[21 · 目录即插件：一个文件夹就是一个插件](21-directory-as-plugin/main.md)
