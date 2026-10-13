# 19 · 工具注册表：让插件自己把工具递上来

> 源码：[provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [calc.ts](./calc.ts) · [session.ts](./session.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [json-schema.ts](./json-schema.ts) · [llm.ts](./llm.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 10 课结束时，我们手里有一个 `get_weather`，和一条"注册表"。

回头看 [cordis.yml](./cordis.yml)，它长这样：

```yaml
- name: './provider.ts'
- name: './weather.ts'
- name: './session.ts'
- name: './mock-provider.ts'
- name: './main.ts'
```

工具从哪来？写死在 `weather.ts` 里。想加第二个工具怎么办？**再写一个 `calc.ts`，再在 yml 里加一行。** 这就是本课要验证的事——加一个工具，`main.ts` 一行都不用改。

先跑起来看效果：

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

`#6` 那一行：模型**自己选了** `calc`，而 `main.ts` 里没有任何一个地方提到过 `calc` 这个名字。

## 一个工具 = 一个插件

[calc.ts](./calc.ts) 和 [weather.ts](./weather.ts) 的骨架一模一样：

```ts
export const name = 'calc-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'calc',
    description: '算一道四则运算。支持加减乘除。',
    parameters: {
      a: { type: 'number', required: true, description: '左操作数' },
      b: { type: 'number', required: true, description: '右操作数' },
      op: { type: 'string', enum: ['+', '-', '*', '/'], description: '运算符' },
    },
    execute(args) { /* ... */ },
  }))
}
```

区别只有名字、说明、参数和执行体。**这就是"工具即插件"**：一个插件想提供工具，就在 `apply` 里 `ctx.tools.register(...)` 一次，剩下的（校验、注册表、日志、模型请求）它一概不用管。

harness 真身的工具全是这么递上来的——[packages/web/tool-web/src/search.ts](../../../deepseek-harness/packages/web/tool-web/src/search.ts) 的 `web_search`、[packages/fs/src/tools.ts](../../../deepseek-harness/packages/fs/src/tools.ts) 的 `read_file`，都是插件 `apply` 里的一次 `ctx.tools.register(defineTool({...}))`。真身比我们多几个字段（`output.schema`、`timeoutMs`、`presentResult`），骨架相同。

## schemas()：什么能出门，什么不能

现在注册表里有两个工具。`main.ts` 要把它们递给模型——但不是把 `ToolDefinition` 整个塞过去。

[provider.ts](./provider.ts) 里新增的方法：

```ts
schemas(): ToolSchema[] {
  // 只挑三个字段——execute 留在本地，不随请求出门
  return [...this.definitions.values()].map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }))
}
```

`ToolSchema` 是 `ToolDefinition` 的**白名单投影**：

| 字段 | 出门？ | 为什么 |
|---|---|---|
| `name` | 是 | 模型要靠它指名调用 |
| `description` | 是 | 模型据此决定用不用 |
| `parameters` | 是 | 模型据此决定传什么 |
| `execute` | **否** | 它是本地函数，序列化不了，也不该被模型看见 |

harness 真身的注释把这个词说明白了——[packages/core/tools/src/index.ts 第 1260 行](../../../deepseek-harness/packages/core/tools/src/index.ts#L1260)：

> Project visible definitions onto the **allowlisted** model-facing schema fields, excluding execution and presentation callbacks

`schemas()` 是 `list()` 的模型侧投影：`list()` 给本地代码看（比如第 08 课的诊断），`schemas()` 给出模型的请求看。**同一个注册表，两个视角。**

## 为什么启动时不能假设"工具已经齐了"

这是本课最反直觉的一处。看 `main.ts` 里工具清单怎么打印的：

```ts
let scheduled = false
ctx.on('tools/change', () => {
  if (scheduled) return
  scheduled = true
  setTimeout(printTools, 0)
})
```

为什么不直接写在 `apply` 函数体里？

```ts
export function apply(ctx: Context) {
  // 错：这里打印只会看到空表
  for (const schema of ctx.tools.schemas()) console.log(schema.name)
}
```

因为**插件的加载顺序由依赖拓扑决定，不是 cordis.yml 的书写顺序**。我们实测过 fiber 的加载序列：

```
provider → session → agent → weather-tool → calc-tool
```

`agent` 声明了 `inject: ['llm', 'tools', 'session']`——它要的三个服务必须先把 provider 建好，所以拓扑把它往前排。而 `weather-tool` / `calc-tool` 只 inject 了 `tools`，拓扑上没人催它们，就按 yml 里的顺序落到最后。

也就是说：**`agent` 的 `apply` 函数体执行的那一刻，注册表恰好是空的。** 而这个顺序由依赖关系决定，写 yml 的人控制不了。所以"现在有哪些工具"这件事，只能等注册表通知，不能自己数。

那为什么还要 `setTimeout` 包一层？因为插件是一个个加载的，weather-tool 注册时响一次，calc-tool 注册时又响一次。每次响都打印，就会打出两份不完整的清单。所以：**每次变化只重新排一次打印，等本轮事件循环安静下来再打。**

## tools/change：注册表对外广播的事件

[provider.ts](./provider.ts) 的 `register()` 里多了两行：

```ts
return this.ctx.effect(() => {
  this.definitions.set(definition.name, definition)
  // 注册即广播：谁想知道"现在有哪些工具"，挂这个事件就行
  this.ctx.emit('tools/change')
  return () => {
    this.definitions.delete(definition.name)
    this.ctx.emit('tools/change')
  }
}, `tools.register(${definition.name})`)
```

摘除时也广播。第 04 课我们说过，事件的价值在于**松耦合**：注册表不需要知道谁在听，听的人也不需要知道有几个插件在注册。加第三个、第十个工具，这里的代码一个字都不用改。

harness 真身在 [packages/core/tools/src/index.ts 第 208 行](../../../deepseek-harness/packages/core/tools/src/index.ts#L208) 也叫 `tools/change`，注释说明了它为什么不过滤：

> An UNFILTERED registry-subject notification, deliberately not scope-filtered dispatch: a global change concerns every agent's next assembly

翻译：注册表是全局的，它一变，**每个 agent 的下一次组装都受影响**，所以不该按 scope 过滤掉任何监听者。

## harness 的 register() 比我们严

我们的 `register()` 只做三件事：塞进 Map、广播、返回摘除函数。harness 真身的 [packages/core/tools/src/index.ts 第 1063 行](../../../deepseek-harness/packages/core/tools/src/index.ts#L1063) 在这个位置上有三道校验：

```ts
// 缺 output.schema / output.render 之一 → TypeError
// timeoutMs 不是正有限数    → TypeError
// name === 'run_code'       → TypeError（保留名，PTC 用）
```

`run_code` 是保留名——它属于 `packages/core/tools/src/ptc.ts` 的 `RUN_CODE_NAME`。这跟我们第 05 课"配置校验失败要炸"是同一条规矩：**接缝上收到的坏数据，要在最早的那一刻拒绝。**

还有一处值得看：`schemas()` 返回的是**深拷贝**（`snapshotJsonValue`），不是活引用。调用方拿到手怎么改都影响不到注册表——**递出门的东西，就不再是家里的东西。**

另外 `guard()`（第 1136 行）的 `notify` 是 `false`：守卫变化**不**广播 `tools/change`，因为可见工具集没变。

## 两次运行：接着上次继续

清掉 `.sessions` 跑一次之后，**再跑一次**（不删 `.sessions`）：

```
=== 从磁盘恢复了 11 条记录，seq 接着 #11 往下编 ===
=== 模型看到的历史 ===
[assistant] （摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。
=== 模型能选的工具 ===
- get_weather：查询一个城市的天气。需要城市名。
- calc：算一道四则运算。支持加减乘除。

=== 用户说：刚才我问了什么？ ===
[模型回答] 你问了我北京天气，我查完还提醒了你带伞。

=== 日志全量（13 条）===
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
#12 [user/message] 刚才我问了什么？
#13 [assistant/message] 你问了我北京天气，我查完还提醒了你带伞。

=== 模型看到的历史（折叠后 3 条）===
[assistant] （摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。
[user] 刚才我问了什么？
[assistant] 你问了我北京天气，我查完还提醒了你带伞。
```

三件事同时发生：**磁盘上的历史被接上了**（第 15 课）、**压缩在重启后依然生效**（第 14 课）、**两个工具又递上来了**（本课）。三个机制互不打扰，这就是插件化的回报。

注意 `=== 模型能选的工具 ===` 出现在"用户说"之前——因为 `tools/change` 在插件加载阶段就响完了，而第一轮对话排在 `setTimeout(…, 50)`。

## 假模型的"大脑"也升级了

[mock-provider.ts](./mock-provider.ts) 的 `decide()` 多了两个分支：

```ts
// 新增：模型"选"了另一个工具。它不需要认识 calc 的实现，
// 只要注册表里有这个名字，loop 就能把它调起来。
if (input.includes('算') || input.includes('+')) {
  return toolCallResponse('call-3', 'calc', { a: 7, b: 6, op: '*' })
}
// 工具结果又喂回来了：算数结果是 "7 * 6 = 42" 这种形状。
// 注意上面那句不能写成 includes('*')——那会把结果也当成"要算数"。
if (/^[\d.]+\s*[-+*/]\s*[\d.]+\s*=/.test(input)) {
  return textResponse(`算好了：${input}`)
}
```

那行注释不是废话：把"要算数"的分支写成 `input.includes('*')`，工具结果 `7 * 6 = 42` 里的 `*` 会再次触发它，`decide` 又返回一次工具调用，而 `executeTool` 只接 `follow.kind === 'text'`——那一轮就静默丢空了。**假模型也是模型，得按"请求即历史"的规矩推理。**

真模型靠训练学会"什么时候该调哪个工具"，我们靠 if。但消费方感知不到差别——`collect()` 收到的 chunk 序列，和真模型的形状完全一致。

## 动手改一改

**实验一：摘掉 calc，看只剩一个工具。** 把 [cordis.yml](./cordis.yml) 里的 `- name: './calc.ts'` 注释掉，再跑：

```
=== 模型能选的工具 ===
- get_weather：查询一个城市的天气。需要城市名。
```

注意 `main.ts` 一个字没改。然后取消注释，第二个工具自己回来了——**这就是插件化的全部意义。**

**实验二：注册一个重名工具。** 复制一份 `calc.ts`，把 `name` 改成 `calc-tool`（重名）、工具名保持 `calc`，加进 yml 再跑。Map 会静默覆盖，`list()` 里仍然只有一个 `calc`。

harness 真身在这里会抛错——它的 `register()` 第一道校验就是重名。我们的教学版没有这道校验，所以你能看见"静默覆盖"长什么样。**记住这个差别：接缝上能拒绝的坏数据，越早拒绝越好。**

**实验三：让摘除也广播。** 在 `main.ts` 里加一行监听，然后跑一次后立刻删掉 `calc.ts`：

```ts
ctx.on('tools/change', () => {
  console.log(`[tools/change] 现在有 ${ctx.tools.list().length} 个工具`)
})
```

把它和 `printTools` 的监听放一起，你会看到两条监听各响一次。事件的价值不在"能收到"，而在**收的人不需要认识发的人**。

## 小结

- 工具是插件递上来的：一个插件一次 `ctx.tools.register(defineTool({...}))`，loop 一行不改
- `schemas()` 是 `list()` 的模型侧投影——白名单只放 `name`/`description`/`parameters`，`execute` 不出门
- 插件加载顺序由依赖拓扑决定，写 yml 的人控制不了；`apply` 函数体执行时注册表可能还是空的，所以"现在有哪些工具"只能等 `tools/change`
- `register()` 注册和摘除都广播；harness 的版本另有三道校验（`output`、`timeoutMs`、`run_code` 保留名）和深拷贝
- 模型选工具靠 `name`：只要注册表里有这个名字，它不需要认识实现

下一篇：[20 · 能力协商：缺什么，启动时就炸](20-capability-negotiation/main.md)
