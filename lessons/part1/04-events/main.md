# 04 · 事件

> 源码：[stats.ts](./stats.ts) · [main.ts](./main.ts) · [waterfall-demo.ts](./waterfall-demo.ts)　配置：[cordis.yml](./cordis.yml)

第 03 课的服务是"点对点"：我知道你叫 `counter`，我直接调你。
但很多时候，发出通知的插件**根本不知道有谁在听**。工具跑完了要通知界面刷新、模型返回了要通知日志落盘——用服务就得先知道对方存在。

这就是**事件**：喊一嗓子，谁爱听谁自己挂上来。

## 本课代码

[stats.ts](./stats.ts) 负责计数，每次变化时广播：

```ts
bump(name: string) {
  const next = (this.counts.get(name) ?? 0) + 1
  this.counts.set(name, next)
  this.ctx.emit('stats/report', name, next)   // ← 广播
}
```

[main.ts](./main.ts) 收听：

```ts
ctx.on('stats/report', (name, count) => {
  console.log(`[stats] ${name} -> ${count}`)
})
```

输出：

```
[stats] tool_call -> 1
[stats] tool_call -> 2
[stats] prompt -> 1
```

`emit` 不等待、不收集返回值。它只是同步地把消息递给每个监听器，然后继续往下走。
就算一个监听器都没有，`emit` 也不会报错——喊进空房间而已。

## interface Events：事件的类型声明

和第 03 课的 `declare module` 是同一招，只是这次合并的是 `Events` 接口：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context { stats: StatsService }        // 上一课的
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}
```

有了它，`ctx.emit('stats/report', ...)` 和 `ctx.on('stats/report', ...)` 都有完整类型检查：参数个数错了、类型错了，`tsc` 直接报错。

事件名约定用 `命名空间/动作` 的形式（`stats/report`、`session/event`），扁平命名空间也能保持可读。

**消费方怎么看到这个声明？** 注意 [main.ts](./main.ts) 第一行：

```ts
import type {} from './stats.ts'
```

这个 `import type {}` 运行时不导入任何东西（{} 是空的），它的唯一作用就是让 TypeScript 加载 stats.ts 里的声明合并。
你在第 0 篇速查里见过 `import type`，这里是它的实战：**只借类型，不产生依赖。**

## ctx.on 也是 effect

监听器随插件卸载自动移除。你写过 `removeEventListener` 吗？在 Cordis 里不存在这个动作。
监听器注册在 reporter 插件上，reporter 一卸载，收听关系一起消失——不会收到"来自已死插件的幽灵消息"。

## 五种分发模式

`emit` 只是其中一种。事件用哪种模式是事件自己的约定，决定了监听器能不能返回值、能不能互相打断：

| 模式 | 调用 | 语义 |
|---|---|---|
| emit | `ctx.emit(名, ...参数)` | 同步广播，不等不收 |
| parallel | `await ctx.parallel(名, ...参数)` | 所有监听器并发跑，一起等完 |
| serial | `await ctx.serial(名, ...参数)` | 挨个跑；第一个有返回值的胜出，后面不跑 |
| bail | `ctx.bail(名, ...参数)` | serial 的同步版 |
| waterfall | `await ctx.waterfall(名, ...参数, next)` | 环绕中间件，见下 |

什么时候用哪个？想同时通知多方 → `emit`；想收集多方结果 → `parallel`；想"谁先答算谁的" → `serial`。

## waterfall：能改结果，也能掀桌子

waterfall 是五种里最特殊的，也是 harness 里最有权力的。每个监听器收到参数**和一个 `next()` 函数**：

- 调 `next()` = 把链子往下传，还能拿到下游的返回值加工
- **不调 `next()` 直接返回 = 短路（否决）**，后面全都不跑

看 [waterfall-demo.ts](./waterfall-demo.ts)（把 cordis.yml 临时改成只加载它再跑）：

```ts
ctx.on('demo/transform', async (input, next) => {
  const downstream = await next()
  return downstream.toUpperCase()      // 包住下游
})

ctx.on('demo/transform', async (input, next) => {
  if (input.includes('blocked')) return '** blocked **'   // 短路！
  return next()
})

ctx.waterfall('demo/transform', 'hello', async () => 'hello')       // → HELLO
ctx.waterfall('demo/transform', 'blocked words', async () => '...')  // → ** BLOCKED **
```

第二行的 `blocked words` 走完整条链：监听器 1 调 `next()` → 监听器 2 发现 `blocked`，**不调 next 直接返回** → 最内层的默认逻辑（传给 waterfall 的那个函数）从未运行 → 返回值往回走时，监听器 1 再把它转成大写。

**铁律：只负责观察的 waterfall 监听器，必须调 `next()`。**
一个日志监听器忘了调 `next()`，就会悄无声息地吞掉所有下游行为——这是 deepseek-harness 仓库的常设规则。宁可直接 `await next(); return` 然后再记日志，也不要图省事。

harness 自己用 waterfall 处理"允许别的插件插嘴"的决策：`agent/request` 让插件改模型调用参数，`approval/request` 让策略插件代替用户点"同意"。第三篇我们会亲手用上它。

## 小结

- 事件 = 广播，发出方不需要知道谁在听
- `interface Events` 声明合并给事件加类型；`import type {}` 让消费方看到声明
- `ctx.on` 是 effect，插件卸载自动退订
- 五种模式：`emit` 广播 / `parallel` 并发收集 / `serial`·`bail` 首个胜出 / `waterfall` 可改写可否决
- waterfall 监听器要么调 `next()`，要么是**有意**短路

下一篇：[05 · 配置](05-config/main.md)
