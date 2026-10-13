# 第一篇 · Cordis 插件内核

> 目标：掌握 DeepSeek Harness 的地基。Harness 里"一切皆插件"这句话的"插件"，指的就是 Cordis 插件。

Cordis 是一个插件框架。它的世界观很小，只有三样东西：

1. **插件**（plugin）—— 一个函数或类，描述"我要贡献什么能力"
2. **上下文**（context，代码里叫 `ctx`）—— 一个共享的服务仓库，插件从这里拿能力、也往这里放能力
3. **组合**（composition）—— 一个 YAML 文件，列出这个应用要加载哪些插件

这三样东西构成了整个 Harness。后面两篇讲的所有高级功能（工具、记忆、Agent 循环），本质都是"往 ctx 里放一个服务 + 监听一个事件"。

| 课节 | 主题 | 一句话 |
|---|---|---|
| [01](01-first-plugin/main.md) | 第一个插件 | 插件就是一个导出 `apply` 的模块 |
| [02](02-lifecycle/main.md) | 注册即效果 | 所有注册都会随插件卸载自动回收 |
| [03](03-services/main.md) | 服务 | 把能力挂到 `ctx` 上给别人用 |
| [04](04-events/main.md) | 事件 | 不认识对方也能通信的五种模式 |
| [05](05-config/main.md) | 配置 | 坏配置在加载时就炸，不带病运行 |
| [06](06-composition/main.md) | 组合 | YAML 就是应用本身，还能热重载 |
| [07](07-capability-seam/main.md) | 能力接缝 | 定义 / 提供 / 消费，三个角色一套 seam |
| [08](08-diagnostics/main.md) | 诊断 | 插件没反应？先看它的 fiber 状态 |
| [09](09-fake-llm/main.md) | 造一个假 llm 服务 | 为第二篇的 MockAdapter 埋点 |
