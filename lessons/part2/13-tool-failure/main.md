# 13 · 工具失败了怎么办

> 源码：[main.ts](./main.ts) · [weather.ts](./weather.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [provider.ts](./provider.ts) · [define-tool.ts](./define-tool.ts) · [json-schema.ts](./json-schema.ts) · [llm.ts](./llm.ts)　配置：[cordis.yml](./cordis.yml)

第 12 课的 `executeTool` 只有四行：

```ts
const result = await ctx.tools.call(call.name, call.args)
if (result.ok) {
  console.log(`[工具返回] ${String(result.value)}`)
} else {
  console.log(`[工具失败] ${result.error}`)
}
```

能跑。但"失败"这两个字盖住了三种完全不同的情况：

1. **工具不存在**——模型编了个名字，或者工具插件被卸载了
2. **参数不合法**——模型漏传了必填字段
3. **工具自己炸了**——网络超时、API 限流、空指针

它们都长着同一张脸（`{ ok: false, error: string }`），但**处理方式完全不同**。本课把这三件事分开。

## 先看它们长什么样

[main.ts](./main.ts) 触发四轮，一轮成功，三轮失败：

```
=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C

=== 用户说：上海天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"unit":"celsius"}
[参数不合法] invalid arguments: $.city 是必填项，但没有提供
[模型回应] 我不知道怎么回答"请根据失败原因重新尝试。"，但我可以查天气。

=== 用户说：火星天气如何？ ===
[模型决定] 调用 get_weather，参数 {"city":"火星"}
[工具异常] 气象服务连接超时（30s）
[重试也失败] 气象服务连接超时（30s）

=== 用户说：帮我搜索上海天气 ===
[模型决定] 调用 search_weather，参数 {"city":"上海"}
[工具不存在] search_weather
[模型回应] 我不知道怎么回答"请根据失败原因重新尝试。"，但我可以查天气。
```

注意最后两轮的顺序：崩溃的那轮 `[重试也失败]` 出现在它自己的轮次里，没有插到别的轮次中间。这不是巧合，下面会讲为什么。

## 三种失败，三条路

[main.ts](./main.ts) 的 `executeTool` 现在长这样：

```ts
const result = await ctx.tools.call(call.name, call.args)
if (result.ok) {
  console.log(`[工具返回] ${String(result.value)}`)
  return
}

const kind = classifyFailure(result.error)
switch (kind) {
  case 'unknown-tool':
    console.log(`[工具不存在] ${call.name}`)
    reportToModel(`工具 ${call.name} 不存在。可用的工具：${...}`)
    break
  case 'invalid-args':
    console.log(`[参数不合法] ${result.error}`)
    reportToModel(result.error)
    break
  case 'crashed':
    console.log(`[工具异常] ${result.error}`)
    await retry(call)
    break
}
```

三种失败各自的处置逻辑：

| 失败 | 谁的错 | 该怎么办 |
|---|---|---|
| 工具不存在 | **模型**的错 | 把名册递给它，让它重新挑 |
| 参数不合法 | **模型**的错 | 把报错递给它，让它重写参数 |
| 工具自己炸了 | **工具**的错 | 等一下再试一次 |

前两种是模型的问题，错误信息必须**回到模型面前**。第三种是工具的问题，跟模型无关，重试就行。

这就是分开的意义：如果把三种都当成"模型的问题"去重试，参数写错时你会白白多调一次；如果把三种都当成"工具的问题"，模型编了个假工具名时你会去重试一个压根不存在的工具，永远失败。

## reportToModel：把错误喂回去

```ts
function reportToModel(message: string) {
  const follow = collect(ctx.llm.stream({
    messages: [
      { role: 'user', content: '（系统提示）' },
      { role: 'assistant', content: `工具调用失败：${message}` },
      { role: 'user', content: '请根据失败原因重新尝试。' },
    ],
  }))
  void follow.then((turn) => {
    if (turn.kind === 'text') console.log(`[模型回应] ${turn.text}`)
  })
}
```

真模型收到这段，会重新组织一次工具调用——换个名字，或者补上漏掉的参数。我们的假模型只会复读一句"我不知道怎么回答"，但**接口是对的**。

关键点：错误信息不能只打在屏幕上。屏幕是给人看的，模型看不见。要让模型改，就得让错误进它的 messages。这也是第 14 课"模型看得见的东西全在日志里"的前奏——日志记的是事实，请求是从事实里折出来的。

## retry：工具自己炸了才重试

```ts
async function retry(call: Extract<ModelTurn, { kind: 'tool-call' }>) {
  await new Promise((resolve) => setTimeout(resolve, 100))
  const again = await ctx.tools.call(call.name, call.args)
  if (again.ok) {
    console.log(`[重试成功] ${String(again.value)}`)
  } else {
    console.log(`[重试也失败] ${again.error}`)
  }
}
```

火星那轮走的就是这条路，两次都超时。重试是"工具暂时不可用"的标准应对——但它有个前提：**这个调用是幂等的**。查天气重试一次没代价；如果工具是"给用户转账一块钱"，重试就是转两笔。真实项目里要不要重试、重试几次、隔多久，得看工具自己声明，不能一刀切。

## 一个刻意的取舍：字符串匹配

`classifyFailure` 靠 `error.startsWith('工具不存在')` 这种字符串匹配判断失败类型。**这是教学简化，别学。**

harness 真身不看字符串。它给每种失败配了结构化的错误码——[packages/core/tools/src/index.ts 第 489 行](../../../deepseek-harness/packages/core/tools/src/index.ts#L489)：

```ts
export interface ToolErrorInfo {
  name: string
  code: string
  reason?: string
}
```

注释写得很清楚：`Internal error class/code used by policy and durable diagnostics`——**内部路由用的**。重试策略、沙箱判定、重放逻辑都读这个 `code`，不读人类可读的 message。原因很实在：message 是给人看的，随时可能改文案、加翻译；`code` 是给机器读的，稳定才有人敢依赖。

而且真身的失败比我们的三种更细，光是"模型请求了不存在的工具"就单独抛了个类——[同文件第 510 行](../../../deepseek-harness/packages/core/tools/src/index.ts#L510) 的 `ToolNotFoundError`，注释说明它继承 `HarnessError` 并带 `code: 'UNKNOWN_TOOL'`，为的是让"工具不存在"和"工具自己抛错"在重试代码里可区分。

我们这里只有一句 `error: string`，所以就按前缀分。够用，但要知道它便宜在哪。

## 为什么失败不抛异常

注意 `executeTool` 里一个 `try/catch` 都没有。因为 [tools.ts](./tools.ts) 的抽象方法早就承诺了：

```ts
/** 执行一个工具；任何失败都收进 ToolResult，不往外抛。 */
abstract call(name: string, args: unknown): Promise<ToolResult>
```

实现这个承诺的是 [provider.ts](./provider.ts) 的 `MapTools.call`：

```ts
const definition = this.definitions.get(name)
if (!definition) {
  return { ok: false, callId, name, error: `工具不存在：${name}` }
}
try {
  const value = await definition.execute(...)
  return { ok: true, callId, name, value }
} catch (error) {
  return { ok: false, callId, name, error: ... }
}
```

工具不存在、参数校验失败（`ToolArgsError` 从 `execute` 里抛出）、工具自己抛异常——三种都在这里被接住，变成 `{ ok: false, error }`。

**失败是返回值，不是异常。** 所以才能被 `switch`，才能按类型分流。如果它抛出来，你就得在调用处写 `try/catch`，然后靠 `instanceof` 猜是哪种失败——那正是我们不想回到的地方。

harness 真身也是这个路子，只是壳子更讲究：成功失败分成两个接口（[第 572 行](../../../deepseek-harness/packages/core/tools/src/index.ts#L572) 和 [第 585 行](../../../deepseek-harness/packages/core/tools/src/index.ts#L585)），靠 `isError` 这个布尔字面量区分——`isError: false` 的那个连 `error` 字段都不允许有（`error?: never`）。类型层面保证"成功的结果不可能带错误信息"，比我们的 `ok: boolean` 更严。

## 关于最后那个交错问题

你可能会问：火星那轮等了 100ms 才重试，为什么没插进后面的轮次？

因为 [main.ts](./main.ts) 的四个 `setTimeout` 间隔是这么排的：50 / 150 / 400 / 700。火星那轮在 400ms 触发，重试要 100ms，600ms 时已经打完；下一轮 700ms 才开始。

这是本课一个真实的工程细节：**异步任务的等待时间会打乱你的输出顺序。** 第一版代码里四轮挤在 50~200ms，火星那轮的 `[重试也失败]` 就跑到了最后一行——程序没错，但输出读起来像乱码。调大间隔不是掩盖问题，是让演示可读。

真身里没有这个问题，因为它有真正的 loop 和 await 链，一轮处理完才开下一轮。我们用 `setTimeout` 模拟，就得自己管好节奏。

## 动手改一改

**实验一：把三种失败合成一种。** 把 `executeTool` 的 switch 改成 `console.log(`[工具失败] ${result.error}`)`，跑一遍。功能上"什么都没变"——四种结局都还能在屏幕上看到。但模型再也收不到任何反馈了，它不知道自己做错了什么。**分类型不是为好看，是为了让错误找到该去的地方。**

**实验二：让参数不合法也重试。** 把 `case 'invalid-args'` 改成 `await retry(call)`。跑一遍，看它多打一次 `[参数不合法]`。这就是把模型的错当成工具的错的后果——重试一次，错得一模一样，纯浪费。

**实验三：让工具"时好时坏"。** 把 [weather.ts](./weather.ts) 的火星分支改成：

```ts
if (city === '火星') {
  attempts += 1
  if (attempts === 1) throw new Error('气象服务连接超时（30s）')
  return '火星：沙尘暴，-60°C'
}
```

再跑，火星那轮会变成 `[工具异常]` → `[重试成功] 火星：沙尘暴，-60°C`。**重试的价值就在这：暂时性的失败能救回来。** 注意 `attempts` 得声明在 `apply` 外面或模块级，否则每次调用都重置。

## 小结

- 工具失败不是一个东西，是三种：工具不存在、参数不合法、工具自己炸了
- 前两种是模型的错——错误信息要**回到模型面前**（`reportToModel`），让它自己改
- 第三种是工具的错——等一下再试（`retry`），但只对幂等调用安全
- `ctx.tools.call` 承诺不抛异常，任何失败都是 `{ ok: false, error }` 返回值，所以才能 switch
- 我们用字符串前缀分类型是教学简化；真身用结构化的 `info: { name, code }`，重试/沙箱/重放代码都读 code 不读 message
- 异步等待会打乱输出顺序，演示代码要自己管好 `setTimeout` 的间隔

下一篇：[14 · session log：把发生过的事写进磁盘](14-session-log/main.md)
