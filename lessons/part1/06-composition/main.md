# 06 · 组合与诊断

> 源码：[needs-timer.ts](./needs-timer.ts) · [diagnose.ts](./diagnose.ts) · [timer.ts](./timer.ts)　配置：[cordis.yml](./cordis.yml)

到这里，你已经会写单个插件了。但一个真正的应用是**几十个插件组成的树**。
`cordis.yml` 就是这份"配方"——它决定加载谁、给谁传什么配置、谁暂时不上场。

## 条目不只是 name

```yaml
- id: greeter            # 稳定身份
  name: './greeter.ts'
  config: { ... }        # 第 05 课的配置
- id: consumer
  name: './consumer.ts'
  disabled: true         # 保留条目，但不加载
```

- `id` 是条目的身份证。有它，loader 才能分清"这是改了配置"还是"删了旧的、加了新的"。**实践建议：正式项目里每个条目都写 `id`。**
- `disabled: true` 让插件保留在配置里但卸载。改回 `false`，它和所有因它而 PENDING 的插件一起复活。这是调试神器——怀疑某个插件有问题，先禁用它，而不是删掉那几行。

条目还可以嵌套成组，作为一个单元加载/卸载；`isolate` 甚至能让两个组各自拿到同一服务的不同实例（比如两个不同配置的 `shell`）。本教程用不到，知道有这些手段即可。

## 静默失败：最坑的那类 bug

第 03 课说过，`inject` 声明了依赖，服务不存在时插件会一直 **PENDING**——不报错、不输出、什么都不做。

如果整个应用"跑起来了但毫无反应"，九成是某个插件在 PENDING。看本课的 [needs-timer.ts](./needs-timer.ts)：

```ts
export const inject = ['timer']   // 但没有任何插件提供 timer！
```

跑一下（cordis.yml 里只有它和 diagnose）：

```
needs-timer is PENDING — a required service is missing
```

这个诊断来自 [diagnose.ts](./diagnose.ts)，核心就一段：

```ts
for (const runtime of ctx.registry.values()) {
  for (const fiber of runtime.fibers) {
    if (fiber.state === 0 /* PENDING */) {
      console.log(`${runtime.name} is PENDING — a required service is missing`)
    }
  }
}
```

`ctx.registry` 是全局插件登记册，你能随时翻看每个插件的状态。教程的 `launcher.ts` 启动时也会自动做这件事。

> 小坑：cordis 源码里 `FiberState` 是 `const enum`（编译时内联的枚举），发布成 npm 包后**没有真实导出**，`import { FiberState }` 会在运行时报 "does not provide an export"。所以本教程直接用数字：0 PENDING / 1 LOADING / 2 ACTIVE / 3 FAILED / 4 UNLOADING / 5 DISPOSED。harness 自己是 monorepo 源码，没这个问题。

## 补上提供方

[timer.ts](./timer.ts) 提供一个 `timer` 服务。在 `cordis.yml` 里加上它：

```yaml
- name: './timer.ts'
- name: './needs-timer.ts'
- name: './diagnose.ts'
```

再跑：

```
needs-timer loaded
```

PENDING 的插件**立刻**被唤醒，`apply` 终于执行。注意顺序无所谓——`timer` 写在后面也一样。

这正是 harness 的工作方式：配置里列一串插件，依赖关系自动决定启动顺序。你在 `cordis.yml` 里加一行 `dsh-bash-local`，几十个注入 `shell` 的插件会同时活过来。

## 热替换：卸载再加载

HMR（热模块替换）听着神秘，用你已经学过的知识就能解释：

1. 保存文件 → loader 发现条目变化
2. **卸载**旧 fiber（第 02 课：所有 effect 逆序回卷，定时器清掉、监听器退订）
3. 在新上下文里**加载**新代码（`apply` 重新运行）

所以只要你的插件守规矩——所有资源都用 effect 注册——热替换就是安全的。这也是第 02 课"注册即效果"的真正价值：它不是洁癖，是热替换能工作的前提。

harness 的 `dsh-hmr` 插件做的就是这件事，底层依赖你前几课学的全部机制。

## 小结

- `cordis.yml` = 应用配方：`name` / `id` / `config` / `disabled`
- 正式项目给每个条目写 `id`，loader 才能精准识别变更
- `disabled: true` 是比删行更安全的调试手段
- 应用没反应 → 查谁在 PENDING：遍历 `ctx.registry.values()` 看 `fiber.state`
- 热替换 = 卸载旧 fiber + 加载新代码，靠 effect 自动回卷保证安全

下一篇：[07 · 能力接缝](07-capability-seam/main.md)
