# DeepSeek Harness 实战教程（给 JS 学习者的 TypeScript 插件开发课）

这是一套从零开始的渐进式教程，教你理解并复刻 **DeepSeek Harness** 的核心架构。你不需要预先学过 TypeScript——每一课只引入一个新概念，所有 TS 语法都在用到时现讲。

## 你将学到什么

DeepSeek Harness 是一个 AI Agent 运行时，它的设计哲学只有一句话：

> **一切皆插件（Everything is a plugin）**

工具、模型调用、记忆、文件访问，全部是通过插件注册进一个共享"上下文"（context）的能力。这套架构建立在一个叫 **Cordis** 的插件框架上。本教程会带你从 Cordis 的最小内核开始，一步步搭出一个能跑通完整对话循环的 Agent。

## 课程地图

| 篇章 | 课题 | 课节 | 代码体量 |
|---|---|---|---|
| [第 0 篇](lessons/part0-typescript-primer/README.md) | TypeScript 零基础速查 | 1 节 | 无代码 |
| [第一篇](lessons/part1/README.md) | Cordis 插件内核 | 9 节（01~09） | 7~57 行 |
| [第二篇](lessons/part2/README.md) | Harness 的工具与记忆 | 9 节（10~18） | 53~215 行 |
| [第三篇](lessons/part3/README.md) | 组装一个能跑的 Agent | 9 节（19~27） | 217~927 行 |

**共 27 课，到此完结，没有第四篇。**

## 两种读法，由你挑

课程代码采用**累积式**：前一课的代码在下一课里保持完整，只追加新内容。所以越往后单文件越长——这不是失控，是一个刻意的选择，两种读法都成立：

- **顺着读**：你能清楚看到每一次"长大"发生在哪。`main.ts` 从 7 行一路长到 927 行，就是一个小 Agent 长成完整运行时的全过程。适合想看"一个东西是怎么被一行行攒出来的"。
- **跳着读**：只想看某个机制（比如压缩、恢复、真 API），直接进那一课，它的目录是**自包含**的——该课的代码就是截至该课的完整状态，跑起来不需要前一课的产物。

第 0 篇是给 JS 学习者的 TS 速查，不写代码，读第一节课之前先看它。

## 环境要求

- Node.js `^22.19 || >=24`（[下载](https://nodejs.org/)）
- 学过 JavaScript：变量、函数、数组、`async/await`
- **不需要** API Key：所有课节用脚本化的假模型（MockAdapter）驱动，离线可跑。唯一例外是第 27 课——它接的是真 API，读不到 Key 时会**自动回落**到假模型，所以照样跑得过

## 开始

```bash
cd deepseek-harness-notes
pnpm install
```

安装完成后，每一课都从该课所在目录运行：

```bash
cd lessons/part1/01-first-plugin
node --import tsx/esm ../../../launcher.ts
```

输出应该包含 `hello from my first plugin`。接着读该目录下的 `.md`。

> 每一课的 `.md` 里都写明了预期输出。如果实际输出对不上，先检查 Node 版本和是否执行了 `pnpm install`。

## 目录约定

```
launcher.ts            教程专用启动器（等价于 harness 的 bin.js）
lessons/
  part0-typescript-primer/
    README.md          给 JS 学习者的 TS 速查
  part1/                Cordis 内核：插件、效果、服务、事件、配置
    01-first-plugin/
      main.ts          这一课的完整代码
      main.md          讲解
  part2/                工具与记忆：defineTool、session log
  part3/                组装 Agent：LlmAdapter、agent loop、MockAdapter、真 API
```

每课的 `.ts` 文件名统一为 `main.ts`，`.md` 与它同名。第 23 课起的课目自带 `tsconfig.json`，新课照此办理。
