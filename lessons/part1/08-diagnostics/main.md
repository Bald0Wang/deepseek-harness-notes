# 08 · 诊断与调试

> 源码：[diagnose.ts](./diagnose.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

写插件一定会出bug。这一课教你三件事：**怎么看清系统状态、插件炸了会发生什么、怎么在运行时抓到它。**

## 状态全景：fiber 状态机

每个插件运行时（fiber）都处在六个状态之一：

```
PENDING ──→ LOADING ──→ ACTIVE
  ↑            │          
  └── 依赖消失 ─┘          
               ↓
            FAILED ──→ (可重试)

ACTIVE ──→ UNLOADING ──→ DISPOSED
```

| 状态 | 含义 | 你该做什么 |
|---|---|---|
| PENDING | 在等 inject 的服务 | 查谁没提供（第 06 课） |
| LOADING | `apply` 正在跑 | 正常，稍等 |
| ACTIVE | 活着 | 没事 |
| FAILED | 抛错了 | 看错误日志，修 |
| UNLOADING / DISPOSED | 正在/已经卸载 | 正常，如非预期检查谁卸载了它 |

[diagnose.ts](./diagnose.ts) 把这些状态汇总成一个服务：

```ts
const state = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'UNLOADING', 'DISPOSED'][fiber.state]
lines.push(`${runtime.name ?? '(匿名)'}: ${state}`)
```

运行本课，你会看到：

```
=== 插件状态 ===
Loader: ACTIVE
isolate: ACTIVE
Include: LOADING
main: LOADING
diagnose-service: ACTIVE
Diagnose: ACTIVE
```

注意这里能认出自家的 `Loader`、`Include`——**cordis.yml 本身就是靠插件加载的**，launcher 也是插件。整个应用就是一棵插件树，根是 `new Context()`。

## 故障隔离：一个插件炸了，不等于全崩

[main.ts](./main.ts) 里有个故意写坏的插件：

```ts
export class BrokenPlugin {
  constructor(public ctx: Context) {
    throw new Error('boom：我在构造时炸了')
  }
}
```

运行后在"故障后重新看一眼"里：

```
BrokenPlugin: FAILED
```

而其他插件**全部还是 ACTIVE**，进程照常跑完，退出码 0。

这就是 fiber 隔离：**每个插件的故障被关在自己的 fiber 里**。错误会：

1. 被 `ctx.logger.error()` 记下来（所以第 05 课我们给 launcher 配了 console exporter——没有它你什么都看不到）
2. fiber 进入 FAILED，它已注册的 effect 全部回卷清理
3. 其他插件毫发无伤

对比 JS 项目里常见的"一个模块抛错，整个进程挂掉"——这里是**局部坏死**。

## 运行时抓错误：fiber.await()

`ctx.plugin()` 返回的 fiber 同时是个 Promise。想知道它加载成功没有：

```ts
const fiber = ctx.plugin(BrokenPlugin)
await fiber.await().catch((error) => {
  console.log('捕获到错误：', error.message)
})
```

`await()` 会重放启动时的错误。本课输出里的 `捕获到错误： boom：我在构造时炸了` 就是这么来的。
如果你写测试、或者在运行时动态加载插件，这是标准做法。

## 调试三板斧

按顺序试：

1. **看状态**：遍历 `ctx.registry.values()`，谁不是 ACTIVE？
2. **看日志**：`ctx.logger.error()` 记了什么？(前提是有 exporter，见 launcher.ts)
3. **看 effect 树**：高级技巧，`fiber.getEffects()` 返回这个插件注册过的所有带标签 effect，包括嵌套关系——排查"这个资源谁注册的、为什么没清理"时用

## 小结

- 六个状态：PENDING（等依赖）/ LOADING / ACTIVE / FAILED / UNLOADING / DISPOSED
- 遍历 `ctx.registry.values()` 看全景，是本教程 launcher 启动时自动做的事
- 插件故障被隔离在自己的 fiber：记日志、变 FAILED、回卷 effect，不影响别人
- `fiber.await().catch()` 在运行时捕获启动错误
- launcher 里必须配 console exporter，否则 cordis 的日志只进内存缓冲

下一篇：[09 · 造一个假 llm 服务](09-fake-llm/main.md)
