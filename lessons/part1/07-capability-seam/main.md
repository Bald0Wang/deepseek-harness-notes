# 07 · 能力接缝

> 源码：[notifier.ts](./notifier.ts) · [provider.ts](./provider.ts) · [provider-upper.ts](./provider-upper.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 03 课你学会了"一个插件提供服务，另一个插件消费"。本课讲 harness 里最重要的一条架构纪律——**能力接缝（capability seam）**，它决定一个项目能不能在半年后还改得动。

## 三个角色

一条接缝由三个角色组成，缺一不可：

| 角色 | 干什么 | 本课文件 |
|---|---|---|
| **Service Definition**（定义） | 定义能力的词汇：`ctx.notifier` 是什么、`send()` 的签名 | [notifier.ts](./notifier.ts) |
| **Service Provider**（提供方） | 具体实现，可以有好几个 | [provider.ts](./provider.ts)（控制台）、[provider-upper.ts](./provider-upper.ts)（全大写） |
| **Consumer**（消费方） | 只用抽象，不知道用的是哪个实现 | [main.ts](./main.ts) |

定义长这样：

```ts
export abstract class Notifier extends Service {
  constructor(ctx: Context) {
    super(ctx, 'notifier')
  }

  // 由提供方实现
  abstract send(message: string): void
}
```

`abstract` 是 TS 的关键字：这个类**不允许被 new**，只能被继承。`abstract send()` 表示"子类必须实现这个方法，否则 TS 报错"。
它既是插件（能 `ctx.plugin(ConsoleNotifier)`），又是服务（`ctx.notifier` 拿得到），还是抽象基类——这就是 harness 定义能力的标准长相。

> 注意 [notifier.ts](./notifier.ts) **不出现在 cordis.yml 里**。它只被 import，不被加载——它不是插件，是词汇表。

## 消费方只看抽象

[main.ts](./main.ts) 是全部三节课里最"无知"的代码：

```ts
export const inject = ['notifier']

export function apply(ctx: Context) {
  ctx.on('notifier/send', (message) => {
    ctx.notifier.send(message)     // 它只知道有这么个 send
  })
  ctx.emit('notifier/send', '构建完成')
}
```

它没有 import 任何提供方（只 `import type {}` 借类型声明）。

## 换实现，消费方零改动

现在见证奇迹。默认 cordis.yml 用控制台提供方：

```
[console] 构建完成
[console] 一切正常
```

把它换成 `./provider-upper.ts`（本课 md 里说明了怎么换，你也可以直接改 cordis.yml 第一行）：

```
[uppercase] 构建完成
[uppercase] 一切正常
```

**main.ts 一个字符都没动。** 这就是接缝的价值：加一种通知方式 = 新写一个文件 + 改一行配置。消费方、其他插件、测试，全都不受影响。

## harness 里的真实接缝

你在用的 deepseek-harness 就是按这个模式搭起来的：

| 接缝 | 定义 | 提供方 | 消费方 |
|---|---|---|---|
| shell | `dsh-shell` | `dsh-bash-local`、`dsh-bash-sandbox` | `dsh-tool-bash` |
| llm | `dsh-llm` | deepseek、openai 适配器 | agent loop |
| tools | `dsh-tools` | 各 `dsh-tool-*` | agent loop |
| session | `dsh-session` | 本地存储 | 几乎所有插件 |

`dsh-bash-local`（本机执行命令）和 `dsh-bash-sandbox`（沙箱里执行）**消费方完全一样**——所以 harness 能让你用一行配置切换"命令在哪跑"，安全策略升级时上层代码一行不改。

## 一条纪律

定义、提供方、消费方三个角色**必须齐全**。只写定义没有提供方 = 永远 PENDING（第 06 课）；只写提供方没有定义 = 没有类型保障；没有消费方 = 死代码。

角色需要独立演进时，harness 会把它们拆到不同包。第三篇我们会照着这个模式造 `llm` 接缝的简化版——那时候你会看到 agent loop 怎么只依赖抽象，从而同时支持真实 API 和我们的假适配器。

## 小结

- **能力接缝** = Service Definition + Provider（可多个）+ Consumer（可多个）
- 定义用 `abstract class extends Service`，既定义词汇又禁止直接实例化
- 定义文件只被 import，不进 cordis.yml
- 换提供方只改配置，消费方零改动——这是可替换性的来源
- 三个角色缺一不可

下一篇：[08 · 诊断与调试](08-diagnostics/main.md)
