# DeepSeek Harness 实战教程（给 JS 学习者的 TypeScript 插件开发课）

> 🌐 **[在线交互版（GitHub Pages）](https://bald0wang.github.io/deepseek-harness-notes/)** —— 27 课代码直接在浏览器里运行：
> 每课一个「▶ 运行」按钮，终端实时输出，自动与本仓库在 Node 下的真实运行结果比对；
> 第 27 课可填入 `DEEPSEEK_API_KEY` 体验真 API（Key 只存你的浏览器 localStorage）。
> 教程内容与源码来自 [Relph1119/deepseek-harness-notes](https://github.com/Relph1119/deepseek-harness-notes)。

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

## 先看全景：27 课在造什么

很多人读到一半会迷路：这一课到底在 Agent 的哪一块？下面这张表是整门课的“运行时解剖图”——六层从下往上长，每一课都能在里面找到位置。

| 运行时器官 | 它负责什么 | 课节 | 学完你手里有什么 |
|---|---|---|---|
| 🧩 装配 | `cordis.yml` 决定加载谁、给谁什么配置 | [01](lessons/part1/01-first-plugin/main.md) · [06](lessons/part1/06-composition/main.md) · [20](lessons/part3/20-capability-negotiation/main.md) · [21](lessons/part3/21-directory-as-plugin/main.md) | 一个完全由配置组合出来的应用 |
| ⚙️ 内核 | 插件、effect、服务、事件、配置、状态机 | [02](lessons/part1/02-lifecycle/main.md) ~ [05](lessons/part1/05-config/main.md) · [08](lessons/part1/08-diagnostics/main.md) | 可卸载、可替换、可诊断的插件系统 |
| 🔌 接缝 | 定义 / 提供 / 消费三个角色分开 | [07](lessons/part1/07-capability-seam/main.md) · [09](lessons/part1/09-fake-llm/main.md) ~ [11](lessons/part2/11-tool-validation/main.md) · [19](lessons/part3/19-tool-registry/main.md) | `ctx.llm`、`ctx.tools`、`ctx.session` 三条接缝 |
| 🔁 循环 | 模型说 → 调工具 → 结果回喂 → 再说 | [12](lessons/part2/12-connect-llm-and-tools/main.md) · [13](lessons/part2/13-tool-failure/main.md) · [22](lessons/part3/22-streaming-loop/main.md) · [23](lessons/part3/23-error-recovery/main.md) | 一个流式、能恢复的 agent loop |
| 🧠 记忆 | append-only 日志 → 折叠 → 压缩 → 恢复 | [14](lessons/part2/14-session-log/main.md) ~ [17](lessons/part2/17-resume-session/main.md) · [24](lessons/part3/24-context-budget/main.md) · [25](lessons/part3/25-real-compaction/main.md) | 断线能续、超长能压的会话 |
| 🐚 外壳 | system prompt、生命周期事件、真 provider | [18](lessons/part2/18-system-prompt/main.md) · [26](lessons/part3/26-session-lifecycle/main.md) · [27](lessons/part3/27-real-api/main.md) | 能接真 API 的产品外壳 |

**三条捷径**（不想按顺序读时）：

- 只想让 Agent 会动手：[09](lessons/part1/09-fake-llm/main.md) → [10](lessons/part2/10-what-is-a-tool/main.md) → [11](lessons/part2/11-tool-validation/main.md) → [12](lessons/part2/12-connect-llm-and-tools/main.md) → [13](lessons/part2/13-tool-failure/main.md)
- 只想让 Agent 记得住：[14](lessons/part2/14-session-log/main.md) → [15](lessons/part2/15-fold-messages/main.md) → [16](lessons/part2/16-compaction/main.md) → [17](lessons/part2/17-resume-session/main.md) → [18](lessons/part2/18-system-prompt/main.md)
- 只想看怎么装成产品：[19](lessons/part3/19-tool-registry/main.md) → [21](lessons/part3/21-directory-as-plugin/main.md) → [22](lessons/part3/22-streaming-loop/main.md) → [26](lessons/part3/26-session-lifecycle/main.md) → [27](lessons/part3/27-real-api/main.md)

> 浏览器交互版（`docs/`）把这张表画成了可点击的全景图：「课程全景地图」；每一课顶部还有本课的定位卡和结构图，底部有生活类比和易懵点。

## 两种读法，由你挑

课程代码采用**累积式**：前一课的代码在下一课里保持完整，只追加新内容。所以越往后单文件越长——这不是失控，是一个刻意的选择，两种读法都成立：

- **顺着读**：你能清楚看到每一次"长大"发生在哪。`main.ts` 从 7 行一路长到 927 行，就是一个小 Agent 长成完整运行时的全过程。适合想看"一个东西是怎么被一行行攒出来的"。
- **跳着读**：只想看某个机制（比如压缩、恢复、真 API），直接进那一课，它的目录是**自包含**的——该课的代码就是截至该课的完整状态，跑起来不需要前一课的产物。

第 0 篇是给 JS 学习者的 TS 速查，不写代码，读第一节课之前先看它。

## 对应版本

本教程照着 **DeepSeek Harness `v0.2.1-alpha.1`**（tag `dsh-v0.2.1-alpha.1`，提交 `5badb150`，2026-10-03）复刻。各课 `.ts` 注释与讲解里引用的真身路径，都以这个版本的源码为准；教程内提到的行号，同样对应这一版。

教程本身不依赖真身仓库——所有依赖从 `node_modules` 解析，`npm install` 后离线可跑。真身仓库只是给你对照源码用的。

harness 的公开 API 处于 pre-stable 阶段，后续版本可能改名、挪位、改行为。如果你拿一个更新的版本来对，发现某条路径或行号对不上，先确认对方版本，别急着怀疑教程。

## 环境要求

- Node.js `^22.19 || >=24`（[下载](https://nodejs.org/)）
- 学过 JavaScript：变量、函数、数组、`async/await`
- **不需要** API Key：所有课节用脚本化的假模型（MockAdapter）驱动，离线可跑。唯一例外是第 27 课——它接的是真 API，读不到 Key 时会**自动回落**到假模型，所以照样跑得过

## 开始

```bash
cd deepseek-harness-notes
npm install
```

安装完成后，每一课都从该课所在目录运行：

```bash
cd lessons/part1/01-first-plugin
node --import tsx/esm ../../../launcher.ts
```

输出应该包含 `hello from my first plugin`。接着读该目录下的 `.md`。

> 每一课的 `.md` 里都写明了预期输出。如果实际输出对不上，先检查 Node 版本和是否执行了 `npm install`。

## 浏览器交互版与部署

`docs/` 是完整的静态站点：每一课都能在浏览器里直接运行（Cordis 运行时和 Node 内置模块都有浏览器 shim），旁边还有 Node 参考输出可以对照。站点在课程内容之外加了几层导航：

- **课程全景地图**：把 27 课放回“装配 → 内核 → 接缝 → 循环 → 记忆 → 外壳”六层运行时里，并给出四条学习路线、27 课速查、术语小抄和最容易混的八个概念。
- **每课定位卡**：上一课留下什么 → 本课给你什么 → 下一课拿它做什么；外加本课对应的 DSH 真身模块。
- **本课结构图**：把这一课的机制画成可读的节点链路（分支课会画成分支图），先看骨架再读正文。
- **生活类比与易懵点**：恋爱 / 游戏 / 追剧三种场景轮换，把抽象机制翻译一遍；读完再看“容易懵的点”。
- 侧栏搜索、学习进度、继续上次、键盘 `←` `→` 翻课。

本地构建与预览：

```bash
npm install
npm run build:site
python3 -m http.server -d docs 8000
# 打开 http://localhost:8000
```

部署到 GitHub Pages：仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**，然后推送 `main`。`.github/workflows/pages.yml` 会安装依赖、构建 `docs/` 并发布。也可以手动执行 `npm run build:site`，把生成的 `docs/` 提交到仓库后用 “Deploy from a branch” 发布。

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
