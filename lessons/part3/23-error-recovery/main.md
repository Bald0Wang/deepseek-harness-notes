# 23 · 错误恢复：失败也是一次结果

> 源码：[main.ts](./main.ts) · [mock-provider.ts](./mock-provider.ts) · [calc.ts](./calc.ts) · [session.ts](./session.ts)　配置：[cordis.yml](./cordis.yml)

上一课结束时，让模型算 `7*6`，它是这么答的：

```
=== 用户说：帮我算 7*6 ===
[模型决定] 调用 calc，参数 {"a":7,"b":6}
[工具返回] 不支持的运算符：undefined
[模型回答] 算好了：7 * 6 = undefined
```

工具明明失败了，模型却说"算好了"。这不是模型在撒谎——**它根本不知道刚才失败了**。日志里那行 `[工具失败]` 是打给人看的，模型一个字都没看见。

第 11 课就给过预告：「第 23 课我们会把这个失败变成真正有用的错误恢复」。本课还债。

**先记住本课最重要的一句话：失败也是一次结果，模型有权看见它、换一个办法。**

## 失败为什么必须回到对话里

先想清楚上一课错在哪。看 [main.ts](./main.ts) 里 `executeTool()` 的失败分支：

```ts
// 上一课
if (result.ok) { ...再问模型一次... return }
console.log(`[工具失败] ${result.error}`)
ctx.session.append({ type: 'tool/result', data: { ..., isError: true } })
// 没了。这一轮到此为止。
```

三行，行行都对，但合起来漏了最关键的一件：**没有再问模型一次。**

日志里多了一行 `isError: true`，`deriveMessages()` 也会把它折进去——但那要等**下一轮用户开口**才用得上。这一轮里，模型既没看见失败，也没机会补救，`run()` 直接返回了。

后果不是"少打印一行"，而是模型会**重复同一个动作**。真模型看不到失败结果时，它以为工具成功了（或者以为这轮已经结束），下一轮用户再提同样的要求，它大概率还是吐同样漏了参数的调用——一遍，又一遍。

所以恢复的第一步朴素得近乎无聊：**失败之后，也再问模型一次。**

```ts
// 本课
console.log(`[工具失败] ${result.error}`)
ctx.session.append({
  type: 'tool/result',
  data: { callId: call.id, name: call.name, value: result.error, isError: true },
})
const recovery = await stream(ctx, { messages: ctx.session.deriveMessages() })
```

关键在 `ctx.session.deriveMessages()` 这行——**折历史的函数一次都没改，改的是"失败之后还折不折"**。上一课的失败路径里没有它，本课补上了。于是模型这一次看见的是：

```
[user] 帮我算 7*6
[assistant] calc({"a":7,"b":6})
[tool] invalid arguments: $.op 是必填项，但没有提供
```

它看见了失败。于是有了补救的机会。

## 什么样的失败，模型学得会

不是所有失败都值得喂回去。看这一课的剧本，模型第一次调用故意漏了 `op`：

```ts
// mock-provider.ts
if (input.includes('算') || input.includes('+')) {
  // 注意这里**故意漏了 op**：模型不是永远正确的，漏参数是最常见的错。
  // 漏掉的参数会被第 11 课的校验器拦住，错误信息原样喂回给模型。
  return toolCallResponse('call-3', 'calc', { a: 7, b: 6 })
}
```

上一次课这里返回的是 `[工具返回] 不支持的运算符：undefined`——因为 [calc.ts](./calc.ts) 的 `op` 没写 `required`，校验器放行了漏参数，让漏掉的参数一路走到 `default` 分支。这句话模型看不懂，也学不会：它不知道该补什么。

改一个词就够：

```ts
// calc.ts
op: { type: 'string', required: true, enum: ['+', '-', '*', '/'], description: '运算符' },
```

现在漏参数被第 11 课的校验器拦住了，失败变成：

```
invalid arguments: $.op 是必填项，但没有提供
```

**哪个字段、缺了什么、期望是什么，全在句子里。** 模型看见它就知道该干什么——把 `op` 补上。

这就是"模型学得会的失败"和"学不会的失败"的分界线：**报错必须指认缺的是什么，而不是描述症状。** `不支持的运算符：undefined` 描述症状（undefined 没法运算），`$.op 是必填项` 指认缺失（补上 op）。前者模型只能猜，后者模型照着做。

顺带说一句，`ToolResult` 这个判别联合从第 19 课就在，`isError` 字段也一直在——本课一行类型都没加。**新加的全是"什么时候用它"。**

## 模型换了个办法

失败喂回去之后，模型的反应要演出来。[mock-provider.ts](./mock-provider.ts) 的 `decide()` 加一个分支：

```ts
// 恢复路径：模型看见了**失败**的工具结果（isError: true）。
// 上一课走到这里就只剩 default 分支——模型压根不知道刚才失败了，
// 只会顺着自己的思路说下一句。本课它能看见失败，于是补上漏掉的参数重试。
if (input.includes('必填项')) {
  return toolCallResponse('call-3-fix', 'calc', { a: 7, b: 6, op: '*' })
}
```

它补上了 `op`。于是 `executeTool()` 拿到的不再是文本，而是**又一次工具调用**——递归来了：

```ts
const recovery = await stream(ctx, { messages: ctx.session.deriveMessages() })
switch (recovery.kind) {
  case 'text':
    ctx.session.append({ type: 'assistant/message', data: { text: recovery.text } })
    break
  case 'tool-call': {
    // 模型换了个办法。递归要有个头——超过重试上限就收手，
    // 否则一个坏工具能让它绕到天荒地老。
    if (depth >= MAX_RECOVERY_DEPTH) { ...收手... }
    ctx.session.append({
      type: 'tool/call',
      data: { callId: recovery.id, name: recovery.name, arguments: JSON.stringify(recovery.args) },
    })
    await executeTool(recovery, depth + 1)
    break
  }
}
```

跑一遍。`rm -rf .sessions && node --import tsx/esm ../../../launcher.ts`：

```
=== 用户说：帮我算 7*6 ===

[模型决定] 调用 calc，参数 {"a":7,"b":6}
[工具失败] invalid arguments: $.op 是必填项，但没有提供

[工具返回] 7 * 6 = 42
[模型回答] 算好了：7 * 6 = 42
```

日志里那四行，是这一课的全部主题：

```
#6 [tool/call] calc({"a":7,"b":6})
#7 [tool/result] 失败：invalid arguments: $.op 是必填项，但没有提供
#8 [tool/call] calc({"a":7,"b":6,"op":"*"})
#9 [tool/result] 7 * 6 = 42
```

失败进了日志（#7），模型看见了它，换了个办法（#8），成功了（#9）。**日志条数从上一课的 11 条变成 13 条**——多出来的两条（#7、#8）就是恢复本身。

## 恢复要有边界

上面这条路走得太顺了：失败一次，重试一次，成功。但真世界里模型可能连着失败——所以三个边界常量必须摆上。

### 一、等待要有上限

```ts
/**
 * 一次工具调用的时限，毫秒。
 *
 * 真身是 guard/timeout-policy：每个工具自己声明 `timeoutMs`，
 * 包装器 armed 这个期限，到点把 signal abort 掉，再把结果替换成
 * 一条结构化的 TOOL_TIMEOUT。教学版没法让假工具挂住，所以用
 * 一个统一的常量——但它演示的是同一件事：**等待必须有上限。**
 */
const TOOL_TIMEOUT_MS = 500
```

用法在 `executeTool()` 开头：

```ts
const abort = new AbortController()
const timer = setTimeout(() => { abort.abort() }, TOOL_TIMEOUT_MS)
let result: ToolResult
try {
  result = await ctx.tools.call(call.name, call.args, abort.signal)
} catch (error) {
  result = { ok: false, callId: call.id, name: call.name, error: describeError(error) }
} finally {
  clearTimeout(timer)
}
```

三个细节值得说：

**`finally` 里 `clearTimeout(timer)`。** 到点前成功返回，计时器必须撤掉。漏了这一行，每个调用都会留下一个 500ms 后触发的僵尸 timer，进程退出前还会抖一下。

**`catch` 把异常也变成失败。** `ctx.tools.call()` 契约上是"任何失败都收进 ToolResult，不往外抛"，但这里有第二层保险：连注册表都没走完的错（比如 `args` 传了个让 JSON.stringify 炸的值）也按失败处理，**不能让它炸掉 loop**。

**`AbortController` 是"到点了"这件事的物化。** 真身用的是 [guard/timeout-policy](../../../deepseek-harness/packages/guard/timeout-policy/src/index.ts)，做法是在 `tools/execute` 这条 waterfall 上挂一个包装器：到点把 `exec.signal` 换成自己的期限，工具只需要 honor 传进来的 signal，不需要知道期限是谁定的。教学版没有 waterfall，直接把 `abort.signal` 递给 `ctx.tools.call()`——**signal 这个通道是同一套**，[provider.ts](./provider.ts) 里那三处 `signal?.aborted` 检查（调用前、execute 后、catch 里）就是工具侧 honor 它的样子。

### 二、重复检测

模型看不见失败时会重复同一个动作；看见了失败，也可能**换个说法再犯同样的错**。所以失败路径上挂一个计数器：

```ts
// 重复检测：同样的工具+同样的参数，连续第几次了？
const repeats = observeRepeat(call.name, JSON.stringify(call.args))
if (repeats >= REPEAT_THRESHOLD) {
  // 这不是一条"给模型看的结果"，是一条**旁白**：提醒它换个办法。
  // 真身叫 additionalContexts，带 source 标签，渲染时不会冒充用户说的话。
  const notice = `你已经用同样的参数连续调了 ${repeats} 次 ${call.name}，这没有进展。换个工具、换些参数，或者直接告诉用户你做不到。`
  console.log(`[循环提醒] ${notice}`)
  ctx.session.append({ type: 'notice/message', data: { text: notice } })
}
```

`observeRepeat()` 在 [main.ts](./main.ts) 末尾，逻辑就四行：记下"上一次调用的身份（工具名 + 参数串）"，和这次的比一比，一样就连贯计数 +1，不一样就重新从 1 开始。

真身 [guard/repeat-tool-reminder](../../../deepseek-harness/packages/guard/repeat-tool-reminder/src/index.ts) 比这讲究得多：它深排序 JSON 再序列化，所以 `{a:1,b:2}` 和 `{b:2,a:1}` 算同一次调用；默认阈值是 `[3, 5, 8]`，第一次温柔提醒，后面逐步升级到带工具名和参数详情的警告。**但核心判断和我们一模一样：同样的动作连续做，就是没有进展。**

### 三、重试上限

```ts
/** 失败后最多再让模型试几次。递归没有头就会绕到天荒地老。 */
const MAX_RECOVERY_DEPTH = 2
```

`executeTool(call, depth = 0)` 每递归一次 `depth + 1`，到顶就收手——收手也写进日志：

```ts
if (depth >= MAX_RECOVERY_DEPTH) {
  console.log(`[放弃恢复] 已经重试 ${MAX_RECOVERY_DEPTH} 次，收手`)
  ctx.session.append({
    type: 'notice/message',
    data: { text: `恢复重试达到上限（${MAX_RECOVERY_DEPTH} 次），本轮结束。` },
  })
  return
}
```

三个常量，三个不同的失败形状：**超时是工具不撒手，重复是模型不换招，深度是恢复本身不肯停。** 都要有头。

## 旁通行：日志里有，模型看不见

上面两次 `notice/message` 是这一课新加的记录类型。看 [session.ts](./session.ts)：

```ts
/** 一条旁白：循环写给自己的提醒，模型看不见。 */
'notice/message': { text: string }
```

关键在于它**没有**进 `SurfaceRecordType`：

```ts
export type SurfaceRecordType = 'user/message' | 'assistant/message' | 'tool/result'
```

`deriveMessages()` 的逻辑是"只走会产生消息的行"：

```ts
for (const line of this.records) {
  const op = line.surfaceOp
  if (op === undefined) continue          // 非消息行：跳过
  ...
}
```

旁白没有 `surfaceOp`（`toLine()` 里它连这个字段都不写），所以被这一行自动跳过——**日志里有它，模型请求里没有它。**

这不是偷懒，是两件事必须分开：

| | `tool/result`（isError） | `notice/message` |
|---|---|---|
| 谁写的 | 工具/注册表 | agent loop 自己 |
| 写给谁 | **模型** | 排障的人 |
| 内容 | 这次失败的事实 | "你已经重复 3 次了" |

"重复了 3 次"这种判断，模型不需要从日志里读——它下一轮自己会数。这句话的价值在**排查问题时**：为什么模型在这儿绕圈子？日志会告诉你它被提醒过。

`toChatMessage()` 里那个 `notice/message` 分支是死代码，注释写明了原因：

```ts
case 'notice/message':
  // 走不到这里：旁白没有 surfaceOp，deriveMessages 已经把它过滤掉了
  return { role: 'assistant', content: line.data.text }
```

留着它不是为了运行——是为了 `switch` 穷尽。删掉这个分支，`SessionRecordMap` 一加新类型，编译器就不会提醒你补翻译了。

真身在这件事上的对应物叫 `additionalContexts`，带 `source: { kind: 'repeat-tool-reminder', form: 'notice' }` 标签——那个标签是承重的：没有它，这段文字会被当成**用户说的话**渲染进历史。教学版用"没有 surfaceOp"达到同一个效果：不产生消息，就不会被误认成谁说的话。

## 一个工程坑：跨课目的声明合并

这一课的 `session.ts` 改了 `SessionRecordMap`，`tools.ts` 改了 `call()` 的签名（多了 `signal`）。改完在仓库根跑 `npx tsc --noEmit`，报了五个错：

```
main.ts(212,59): error TS2554: Expected 2 arguments, but got 3.
session.ts(66,23): error TS2717: Property 'session' must be of type 'Session', but here has type 'Session'.
tools.ts(6,5): error TS2717: Property 'tools' must be of type 'Tools', but here has type 'Tools'.
```

`Session` 和 `Session` 不是同一个类型？看错误信息像玩笑，其实是真事。

根 tsconfig 的 `include: ["**/*.ts"]` 把 part1~part3 **所有课目**的 `.ts` 收进了同一个编译程序。而每个课目都有一份 `session.ts`，每份里都有：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context { session: Session }
}
```

声明合并的本意是"多处补充同一个接口"，但这里补充的是**互相冲突的定义**：23 课的 `call()` 有三个参数，22 课的副本只有两个；23 课的 `SessionRecordMap` 有五种记录，21 课的副本有四种。合在一起，TypeScript 谁都不放过，报 TS2717（后继必须是同一类型）。

解法是**让每个课目自己编译自己**。在课目里放一份 [tsconfig.json](./tsconfig.json)：

```json
{
  "compilerOptions": { "target": "ES2022", "module": "NodeNext", ... },
  "include": ["**/*.ts", "../../../launcher.ts"],
  "exclude": ["node_modules"]
}
```

两个要点：

**`include` 里的 `../../../launcher.ts` 不能省。** `plugin-directory.ts` 用 `ctx.loader.create()`，而 `ctx.loader` 的类型增强来自 `@deepseek-ai/cordis-plugin-loader`——那个 import 只在仓库根的 `launcher.ts` 里。不把它纳进程序，课目内编译会报 `Property 'loader' does not exist on type 'Context'`。三个 `../` 是因为课目在 `lessons/part3/23-error-recovery/`，比根深三级。

**`extends` 用不了。** 第一反应是 `"extends": "../../tsconfig.json"`，报 `TS5083: Cannot read file 'lessons/tsconfig.json'`——`extends` 的路径是**相对配置文件所在目录**解析的，不是相对 cwd。而 `include` 也是同一套基准。搞清这一点之后，索性写成自包含的全量配置，不再继承。

根配置那边加一行 exclude，两套编译各管各的：

```json
"exclude": ["node_modules", "lessons/part3/23-error-recovery"]
```

`npx tsc --noEmit -p tsconfig.json`（课目内）和 `npx tsc --noEmit`（仓库根）都 exit 0。

这件事值得单独一节，因为它揭示了一个通用规律：**声明合并是给"同一个接口的不同补充"用的，不是给"同一个名字的不同版本"用的。** 教学仓库里 20 多个课目共用一套 `Context` 增强，看起来该合并，实则每一课都在重写它。编译程序把 20 份定义搅在一起，谁都没法活。

## 动手改一改

**实验一：删掉失败后的那次 `stream()`。** 把 `executeTool()` 里 `const recovery = await stream(...)` 那几行注释掉，只留 append。跑。

输出退回上一课的样子：

```
[模型决定] 调用 calc，参数 {"a":7,"b":6}
[工具失败] invalid arguments: $.op 是必填项，但没有提供
```

然后这一轮直接结束，日志停在 #7——**没有 #8、没有 #9、没有 `[模型回答]`**。日志里躺着一次失败，对话里什么都没有。这就是"失败没回到对话里"的裸体样子。

**实验二：把 `op` 的 `required` 删掉。** [calc.ts](./calc.ts) 里 `op` 那行去掉 `required: true`。跑。

校验器放行漏参数，失败从 `$.op 是必填项` 变成 `不支持的运算符：undefined`。日志看着还挺像那么回事，但 `[模型回答] 算好了：7 * 6 = undefined`——**模型在胡说，而且它不知道自己胡说。** 同一行失败，一句能补救，一句不能。差别只在报错指认了什么。

**实验三：第二次跑，走恢复路径。** 不删 `.sessions`，再跑一遍：

```
=== 从磁盘恢复了 13 条记录，seq 接着 #13 往下编 ===
=== 模型看到的历史 ===
[assistant] （摘要）用户问了北京天气和一道乘法，模型分别调了 get_weather 和 calc。

=== 用户说：刚才我问了什么？ ===
[模型回答] 你问了我北京天气、让我算 7*6，还打了个招呼。
```

15 条日志。注意 `#7` 那条失败**还在文件里**——日志只增不减，恢复路径读的是磁盘，不是内存。模型这次只看得见摘要（`#13` 顶掉了 `#1~#12`），但它答得出"你问了我北京天气"——**它学到的不是记录，是摘要。**

## 对照真身

本课三个边界，真身都在 [packages/guard](../../../deepseek-harness/packages/guard) 里，而且都比我们重：

**超时。** [timeout-policy](../../../deepseek-harness/packages/guard/timeout-policy/src/index.ts) 挂在 `tools/execute` waterfall 上，`next()` 前后把 `exec.signal` 换成自己的期限。注意它替换结果时的判据——`timeoutOf(d.signal, TOOL_TIMEOUT)`，只有**自己的** timer 触发了才替换成结构化的 `TOOL_TIMEOUT`；外层别人的 deadline 先触发，读起来是普通的上游取消，不抢功。教学版没有 waterfall，一个 `setTimeout` 打天下。

**重复。** [repeat-tool-reminder](../../../deepseek-harness/packages/guard/repeat-tool-reminder/src/index.ts) 的注释里有一句值得抄下来：

> Observe-and-enrich, never veto

它挂在 `tools/post-execute` 上，**先数数，再 delegate，最后把提醒折进结果**——不管下游是放行还是拦截，提醒都照送。而且它数的是 `post-execute`：被拦掉的调用也过这条 waterfall，**模型死磕一个被拦的工具，正是最该打断的循环**。教学版在失败分支里数，漏掉了"成功但重复"和"被拦"两种形状。

**恢复本身。** 真身没有"重试上限"这个插件——`MAX_RECOVERY_DEPTH` 是我们的土办法。真身的对应物是 agent loop 自己的步数预算，以及 guard 家族里那些"这一轮不能再调工具了"的裁决。方向一致：**每一层都要有资格说"到此为止"。**

第 24 课讲上下文预算时，会见到这三个常量的另一副面孔：它们省下的不只是时间，还有**下一次请求要带的 token**。

## 小结

- **失败也是一次结果**：`tool/result` 的 `isError` 从第 19 课就在，本课一行类型没加——加的是"失败之后再问模型一次"
- 失败必须回到对话里，否则模型只会**重复同一个动作**——它看不见别的东西
- **模型学得会的失败指认缺失**（`$.op 是必填项`），学不会的失败描述症状（`不支持的运算符：undefined`）。`required: true` 一个词决定了是哪种
- 三个边界：超时（工具不撒手）、重复检测（模型不换招）、重试深度（恢复不肯停）。对照 [packages/guard](../../../deepseek-harness/packages/guard)
- `AbortController` + `finally` 里 `clearTimeout`；`catch` 把异常也收成失败，**不能炸掉 loop**
- 旁通行 `notice/message` 没有 `surfaceOp`，`deriveMessages()` 自动跳过——日志里有，模型看不见。`toChatMessage()` 里那个分支是死代码，留着让 switch 保持穷尽
- `compact` 的 endSeq 随记录数重数（本课 13 条，区间 `#1~#12`）——多写几轮这个数字就得重数，第 25 课会处理它
- 跨课目声明合并会撞车（TS2717）：课目级 tsconfig 隔离，根配置 exclude。`extends`/`include` 的相对路径都以**配置文件所在目录**为基准

下一篇：24 · 上下文预算
