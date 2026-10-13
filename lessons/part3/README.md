# 第三篇 · 组装一个能跑的 Agent

> 目标：把前两篇的零件拼成一个真正能用的 Agent，再给它装上生产环境必备的几件外壳。

第二篇结束时，我们有了工具、日志、恢复能力，以及一个能中途改写的提示词，但它们还散落在各自的插件里，靠 `main.ts` 里几个 `setTimeout` 串起来。本篇做三件事：

1. **收拢成一个插件**（19~21）——工具注册表、能力协商、目录即能力
2. **跑通完整 loop**（22~25）——流式输出、错误恢复、上下文上限、真正的压缩
3. **装上外壳**（26~27）——观测一个 Session 的生死，接一次真实 API

| 课节 | 主题 | 一句话 |
|---|---|---|
| [19](19-tool-registry/main.md) | 工具注册表 | 插件自己把工具递上来，loop 不认识任何一个具体工具 |
| [20](20-capability-negotiation/main.md) | 能力协商 | 插件声明要什么，启动时才报缺，不是跑一半才崩 |
| [21](21-directory-as-plugin/main.md) | 目录即插件 | 一个文件夹就是一个插件，main.ts 不再是特例 |
| [22](22-streaming-loop/main.md) | 流式 loop | 模型的每个字都在路上，不是等它全说完 |
| [23](23-error-recovery/main.md) | 错误恢复 | 工具炸了、模型超时了，会话都不能死 |
| [24](24-context-budget/main.md) | 上下文预算 | 不是所有日志都进请求，得算 token 账 |
| [25](25-real-compaction/main.md) | 真正的压缩 | 让模型自己写摘要，替代我们写死的那句 |
| [26](26-session-lifecycle/main.md) | Session 的一生 | 从 create 到 dispose，每个阶段都有事件可听 |
| [27](27-real-api/main.md) | 接一次真实 API | 把 MockAdapter 换成 DeepSeek，只需要一个配置文件 |

## 读完你应该能

- 说清 Harness 里"插件"到底指什么，以及为什么连 Agent 自己都是插件
- 解释为什么 session log 必须是 append-only，以及压缩为什么不能是删除
- 把本教程的任何一个插件，对应回 Harness 源码里那个真实文件
- 给自己写一个新工具，而不必改 loop 的任何一行

**本篇是教程的最后一篇。** 到这里 27 课全部完结，没有第四篇。

## 与 Harness 真身的对照

本篇的每一节课都在复刻一个真实的设计决定。下面这张表是地图，课内会逐个展开：

| 课节 | 复刻的真身 |
|---|---|
| 19 | `packages/core/tools` 的注册表与 `defineTool` |
| 20 | `ctx.inject` 依赖声明与 fiber 状态机的 FAILED 传播 |
| 21 | Cordis 的目录加载（`packages/<group>/<pkg>/` 即一个插件） |
| 22 | `LlmAdapter` 的流式协议（text-delta / tool-call-delta / block-end / finish） |
| 23 | `packages/guard` 的循环守卫与失败重试 |
| 24 | `packages/compaction` 的上下文预算与触发策略 |
| 25 | `packages/compaction` 的摘要生成（由模型产出，不写死） |
| 26 | `SessionEventMap` 的 create / restore / dispose 生命周期事件 |
| 27 | `packages/llm` 的 provider 配置（baseUrl / apiKey / model） |
