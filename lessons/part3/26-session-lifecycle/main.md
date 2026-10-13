# 26 · Session 的一生

> 源码：[main.ts](./main.ts) · [session.ts](./session.ts) · [llm.ts](./llm.ts) · [mock-provider.ts](./mock-provider.ts) · [token-meter.ts](./token-meter.ts)　配置：[cordis.yml](./cordis.yml)

前面 25 课里，session 一直是个"很乖的笔记本"：你说一句它记一句，问它历史它老老实实折出来。直到本课，它才终于像个**有生命的东西**——会问世、会广播、会在入土前交代一声。

看一看本课的日志，和 25 课逐行对比：

```
=== 用户说：北京天气怎么样？ ===
[session 一生] #1 user/message 落定（累计 1 条）
[预算] 本次请求 ≈ 163 token（消息 10 + 工具清单 153，窗口 320，阈值 256）
[session 一生] 落盘关卡：日志已全部在盘上
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[session 一生] #2 tool/call 落定（累计 2 条）
[工具返回] 北京：晴，12°C
[session 一生] #3 tool/result 落定（累计 3 条）
[session 一生] 落盘关卡：日志已全部在盘上
```

多出来的那三行，就是本课的全部内容。它们不是你调用 `list()` 看出来的——**是 session 自己喊出来的。**

**先记住本课最重要的一句话：session 不是一个被查询的对象，它是一个会广播的生命周期。**

## 四个事件，一生的四个阶段

真身 [packages/core/session/src/index.ts](../../../deepseek-harness/packages/core/session/src/index.ts) 定义了四个事件，本课一字不改地搬过来：

```ts
interface Events {
  'session/created'(session: Session, restored: number): void
  'session/event'(session: Session, line: SessionLine): void
  'session/flush'(session: Session): Promise<void> | void
  'session/disposed'(session: Session): void
}
```

按时间顺序排一遍，就是一个会话从问世到入土的完整轨迹：

| 事件 | 时机 | 模式 | 语义 |
| --- | --- | --- | --- |
| `session/created` | 构造完，头行已落盘 | `emit` | 问世。`restored` 说明它带了 12 条旧账 |
| `session/event` | 每 `append()` 一行，**落盘之后** | `emit` | 一条记录落定 |
| `session/flush` | 每次 `flush()`，缓冲推盘之后 | `parallel` | 落盘关卡。**await 型** |
| `session/disposed` | `dispose()`，一生只此一次 | `emit` | 入土 |

注意第四列最后那个词：**"落盘之后"**。这个顺序不是随手排的：

```ts
append(record: SessionRecord, op: SurfaceOp = 'append'): number {
  this.seq += 1
  const line = this.toLine(this.seq, record, op)
  this.records.push(line)
  // 追加写：只往文件末尾加字节，不动已有内容
  appendFileSync(this.file, `${JSON.stringify(line)}\n`)
  // 先落盘、后广播：监听器看到的每一行都已经是既成事实
  this.ctx.emit('session/event', this, line)
  return line.seq
}
```

监听器在 `session/event` 里伸手去读文件，那一行**一定已经在盘上**。反过来（先广播后落盘）的话，监听器读到的就是半个事实——它以为写完了，其实还在缓冲区里。

`session/created` 同理，它排在头行写入之后：

```ts
ownedFiles.add(this.file)
// 头行已在盘上，事件才可以广播——监听器伸手能读到 header
this.ctx.emit('session/created', this, this.restoredCount)
```

### `session/flush` 为什么是 await 型

这是四个事件里唯一一个 `@mode parallel` 的。差别在第 04 课那张表里：`emit` 是同步广播、不等不收；`parallel` 是并发收集、一起等完。

所以 `flush()` 的写法是这样：

```ts
flush(): void {
  const header = `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION })}\n`
  const body = this.records.map((line) => `${JSON.stringify(line)}\n`).join('')
  writeFileSync(this.file, header + body)
  void this.ctx.parallel('session/flush', this)
}
```

它**不是** `await` 这个 Promise——教学版的 `flush()` 返回 `void`。但事件是 `parallel` 发的，所以真身那个"关卡"的形状在这儿：**调用方可以选择等所有监听器做完。**

真身 [checkpoint-policy](../../../deepseek-harness/packages/session/session-checkpoint-policy) 就是这个"选择等"的一方。它是个策略插件，挂在两个位置：**模型请求构造前**、**工具 body 执行前**。每到一处就 `await session/flush`——不等到日志全部落盘，请求不发、工具不跑。

本课把那个位置直接写进了 `run()`：

```ts
await compactIfNeeded(options)
measureRequest(options)

// 本课新增：请求出门之前，先让日志落盘。
//
// 真身 checkpoint-policy 把这个动作做成**策略插件**，
// 在 llm/stream 构造前 await `session/flush`——agent loop
// 自己一行都不写。教学版直接调 `ctx.session.flush()`，
// 效果一样：`session/flush` 事件被 parallel 出去，
// 所有监听器做完，请求才发。
if (FLUSH_BEFORE_REQUEST) {
  ctx.session.flush()
}
```

为什么非做不可？**因为请求一离开进程，我们就把控制权交出去了**：网络可能断、进程可能被杀、机器可能断电。到那时候，能证明"我们问过什么"的只有盘上那条日志。没落盘的那部分，就是查无实据。

教学版的写本来就是同步的，所以这三次 `flush()` 在日志里只表现为三行「落盘关卡」。**关卡的位置比关卡的实现更值得看**——真身那三行 `flush()` 一次都不能少。

## 听不到的那一个

`session/created` 的监听器写了，但本课的剧本里它**一次都不会响**。日志第一行是：

```
=== 没有找到历史，开一个新会话 ===
```

不是「问世（恢复 0 条）」。原因是加载顺序：`cordis.yml` 里 provider 先、agent 后，session 在 provider 加载时就构造了，而 `ctx.on('session/created', ...)` 要到 agent 的 `apply()` 才注册。

**监听只能从现在开始，之前发生的事要靠别的方式补。**

补的方式就是 `restoredCount`——一个字段，`run()` 开头直接读：

```ts
const restored = ctx.session.restoredCount
if (restored > 0) {
  console.log(`=== 从磁盘恢复了 ${restored} 条记录，seq 接着 #${...} 往下编 ===`)
}
```

这是 cordis 的一条通用事实，不止 session：**任何"问世早于你"的服务，都得同时给一个可查询的当前状态。** 事件负责讲故事，字段负责查户口。两样都要有。

本课留着那个空听的监听器，就是为了让这件事在代码里有个对照物。

## 入土：显式 dispose

剧本跑完，`main.ts` 末尾多了一句：

```ts
ctx.session.dispose()
```

换来日志最后一行：

```
[session 一生] 入土（一生共 12 条记录）
```

`dispose()` 只做两件事：

```ts
dispose(): void {
  if (this.disposed) return
  this.disposed = true
  ownedFiles.delete(this.file)
  this.ctx.emit('session/disposed', this)
}
```

**幂等**——第二次调用直接 return。因为收尾的路径有两条：剧本末尾显式调用一次，插件卸载时 `ctx.effect` 的清理钩子还会调一次。两条都通向同一个 `dispose()`，不幂等就会把一个会话埋两遍。

```ts
// 收尾：进程要退了，把 session 埋了。
ctx.effect(() => () => { ctx.session.dispose() }, 'session.dispose')
```

为什么用 `ctx.effect` 而不是 `ctx.on('dispose')`？**cordis 没有 `dispose` 这个事件。** 清理的钩子是 `ctx.effect(() => () => ...)` 的返回值：插件卸载时它逆序执行。这就是第 02 课的「注册即效果」——注册一个动作，同时注册它的撤销。

### 为什么不用 `ctx.root.fiber.dispose()`

教学版第一版就是这么写的，结果跑出来一片空白。原因是：**根 fiber 一拆，上面的监听器跟着被摘掉**，`session/disposed` 发出来的时候已经没人听了。

更麻烦的是它挂在 launcher 里——`launcher.ts` 是所有课目共享的根文件，那行 `await ctx.root.fiber.dispose()` 一加，25 课也跟着空跑。**一个插件不该拥有销毁整个应用的权利**，哪怕只是教学版。

改成显式 `ctx.session.dispose()` 之后，时机完全确定：发事件的那一刻，听事件的四条监听器全都活着。

### 一个真实的坑：私有字段穿过 Proxy

第一版 `dispose()` 用的是 `#disposed`，跑出来直接崩：

```
TypeError: Cannot read private member #disposed from an object whose class did not declare it
    at Proxy.dispose (session.ts:358:14)
```

因为服务是从 `ctx.session` 读的，那是 cordis 的 Proxy。私有字段（`#x`）在规范层面绑在**具体的对象实例**上，而 Proxy 的 `get` 拦截器拿到的是 receiver 不是 target——字段就读不到了。

TypeScript 的 `private` 只是编译期的事，运行时就一个普通属性，Proxy 照样转发。所以：

```ts
/**
 * 已经广播过 `session/disposed` 了吗。收尾只能发生一次。
 *
 * 为什么不用 `#disposed`：服务是从 `ctx.session` 读的，那是 cordis
 * 的 Proxy——私有字段穿过 Proxy 就读不到了（`get` 拦截器拿到的
 * receiver 不是原对象）。TypeScript 的 `private` 只是编译期的事，
 * 运行时就一个普通属性，Proxy 照样能转发。
 */
private disposed = false
```

这不是教学版的特殊问题。**任何会被包进 Proxy 的对象，都不要用私有字段存状态。**

## 单写者

构造时多了一道检查：

```ts
// 单写者：同一个文件在同一个进程里只许一个 session 持有。
if (ownedFiles.has(this.file)) {
  throw new Error(`session 文件已被占用：${this.file}（单写者，不能两个实例同时开）`)
}
```

为什么必须拦？因为两个 `JsonlSession` 交替 `appendFileSync` 同一个文件，会把彼此的行**从中间劈开**。读回来时整份日志都是坏的——而且不是当场坏，是等到下次恢复时才炸，那时候你根本不知道是哪一次写入劈的。

真身在进程内 claim 之上还有一层内核锁（Windows 上是命名信号量），防的是**另一个进程**。教学版不跨进程，只拦自己人打自己人。

## 区间锁：补上 25 课的接线

25 课结尾说过，`agent/compact-begin` / `agent/compact-end` 两条事件「已声明未接线」。本课接上：

```ts
ctx.on('agent/compact-begin', (fromSeq, toSeq) => {
  console.log(`[区间锁] #${fromSeq}~#${toSeq} 冻结，开始生成摘要`)
})
ctx.on('agent/compact-end', (fromSeq, toSeq, summarySeq) => {
  console.log(`[区间锁] 解冻：区间收成 #${summarySeq}，#${fromSeq}~#${toSeq} 就此退出模型视野`)
})
```

日志里长这样：

```
[预算告急] 历史 ≈ 271 token 超过阈值 256，折掉 #1~#9，保留最近 46 token
[区间锁] #1~#9 冻结，开始生成摘要

=== 摘要请求：让模型自己写 ===
...
=== 压缩：#1~#9 折成一条摘要 ===
[session 一生] #14 assistant/message 落定（累计 2 条）
摘要落成 #14，它顶掉了 #1~#9
[区间锁] 解冻：区间收成 #14，#1~#9 就此退出模型视野
```

真身在 begin 和 end 两端各挂一个断言：`assertSelectedSpanStable`（摘要生成期间，选中的区间一条都不许动）和 `assertWholeSurfaceUnchanged`（除了摘要那一行，别的地方也不许动）。

摘要要跑几百毫秒到几秒。这段时间里完全可能有别的轮次往日志里追加东西——**不锁，折的就不是当初选中的那段了。**

教学版的循环是串行 `await` 的，期间确实没有别人能插得进来，所以这两条事件现在是**纯观测**。但监听它们的位置，就是真身放不变量检查的位置。**看得见，比看不见好。**

## 跑一遍

`rm -rf .sessions && node --import tsx/esm ../../../launcher.ts`。

第一遍和 25 课逐字一致：三轮 163 / 197 / 246，12 条日志，压缩一次都没触发（246 < 256）。区别只在每行记录后面多一声 `落定`，每个请求前面多一行 `落盘关卡`。

不删 `.sessions` 再跑一遍。恢复 12 条，第四轮开口 271 超阈值：

```
=== 从磁盘恢复了 12 条记录，seq 接着 #12 往下编 ===
=== 模型看到的历史 ===
[user] 北京天气怎么样？
...

=== 用户说：刚才我问了什么？ ===
[session 一生] #13 user/message 落定（累计 1 条）
[预算告急] 历史 ≈ 271 token 超过阈值 256，折掉 #1~#9，保留最近 46 token
[区间锁] #1~#9 冻结，开始生成摘要
```

注意第二行：**恢复出来的历史，就是 25 课折完之后模型看见的那个形状。** 因为 `surfaceOp` 跟着行一起写进了盘，`deriveMessages()` 重放时照样挖得掉 `#1~#9`。**折叠不是记忆里的临时状态，是日志里的事实。**

最后一行：

```
[session 一生] 入土（一生共 12 条记录）
```

注意这个 12——恢复路径下本进程只追加了 3 条（#13~#15），但「一生共 12 条」说的是**日志里那一生**，不是这一次进程写的。因为 `events` 那个计数器在 `session/event` 里累加，而恢复时那 12 条不发事件（它们问世时我们还没监听）。**日志的一生比进程的一生长。**

## 动手改一改

**实验一：把 `ctx.session.dispose()` 删掉。** 跑第二遍。

日志正常跑完 15 条，但最后没有「入土」那一行。进程自然退出，fiber 不拆，`dispose()` 永远不调用。**日志停在盘上，屏幕上看不见一个会话的终点。**

然后你会发现：`ownedFiles` 里那个文件路径也没被删。跑第三次——`session 文件已被占用`，崩。这就是幂等的反面：**不 dispose，连重跑都跑不了。**

**实验二：把 `dispose()` 里的 `if (this.disposed) return` 删掉。** 跑第二遍。

日志最后出现两次「入土」——一次来自剧本末尾的显式调用，一次来自插件卸载时 `ctx.effect` 的清理钩子。**一个会话被埋了两遍。** 真身在会话离开 store 时只广播一次，同样只此一次。

**实验三：把 `append()` 里两行的顺序对调**（先 `emit` 后 `appendFileSync`）。跑一遍。

日志一个字都不会变。但你在 `session/event` 的监听器里读一次文件，那一行**还不在盘上**——监听器伸手摸到的是半个事实。教学版的写是同步的，这个 bug 藏得很深；真身有写缓冲，对调之后监听器会稳定地读到旧内容。

**顺序即契约。**

**实验四：把 `ownedFiles.has()` 那道检查删掉。** 然后照下面这么写第二个 session：

```ts
export function apply(ctx: Context) {
  ctx.on('agent/turn', () => {
    // 恶意：同一个文件再开一个 session
    const other = new JsonlSession(ctx, { file: '.sessions/demo' })
    other.append({ type: 'user/message', data: { text: '另一个人写的' } })
  })
}
```

跑完再跑一次恢复——日志读不出来，`JSON.parse` 炸在某一行中间。**两行字被劈成两半，谁都拼不回去。** 这一课最该记住的事故形态：日志坏掉的时候，写它的那一刻早就过去了。

## 对照真身

**头行与版本。** 教学版的文件第一行是 `{"type":"session","version":1}`，真身叫 `HeaderLine`，`SESSION_FORMAT_VERSION = 4`。`Session.load()` 已经会核对版本，不符就抛错——**旧版本的日志宁可拒绝加载，也不要猜着读。** 猜着读会把格式差异翻译成语义差异，那种错你查不出来。

**分代文件名。** 真身不是一个大文件写到底，是 `session-<n>.jsonl` 一代一代滚。教学版只有一个文件——但"为什么分代"值得想：单文件越大，恢复时要读的越多，而大部分历史早就被 replace 折掉了。

**压缩。** 真身用 zstd。日志是文本，压下来通常只有几分之一。代价是读回来要先解压——**写的时候省的事，读的时候要还。**

**原子替换。** 真身的写不是 `appendFileSync`，是先写临时文件再 rename。rename 在同一文件系统上是原子的——**要么旧的整份在，要么新的整份在，不存在中间态。** 教学版的 append 反而天然安全（只往末尾加字节），但 `flush()` 那次整份重写不是，第一版就该用临时文件 + rename。

**恢复之外还要暴露什么。** 本课只给了 `restoredCount`。真身的 store 上还有：当前分代、被 replace 折掉的行数、最后一次 flush 的时间。**这些都是"这个会话现在什么状态"的答案**——和事件一样，都是给监听不到 `session/created` 的后来者的补偿。

**SessionEventMap 的版本机制。** 真身给每条事件标了 `ignorable`：新版本的 harness 加了一条事件，旧版本读到不认识的事件时可以**安全跳过**而不是拒绝整份日志。教学版没有这层——我们只有五种记录类型，判别联合写死。等哪天真身那种"事件表会演进"的形态出现在你项目里，记得这套机制在那儿等着。

## 小结

- **session 不是被查询的对象，是会广播的生命周期**：`created` / `event` / `flush` / `disposed` 四个事件覆盖一生
- 事件一律**先落盘、后广播**：监听器伸手摸到的必须是既成事实
- `session/flush` 是 `parallel`（await 型）：真身 checkpoint-policy 靠它在请求发出前强制日志落盘
- **听不到 `session/created`**：provider 先加载、agent 后加载，监听只能从现在开始，之前的事靠 `restoredCount` 这样的字段补
- 入土用显式 `ctx.session.dispose()`，不用 `ctx.root.fiber.dispose()`：后者会连带拆掉听事件的监听器，而且一个插件无权销毁整个应用
- **私有字段不能穿过 Proxy**：`#disposed` 换成 `private disposed`
- 单写者：两个实例同时追加一个文件，会把彼此的行从中间劈开
- 区间锁补上了 25 课的接线：教学版是纯观测，真身在两端放不变量断言
- **日志的一生比进程的一生长**：恢复路径下本进程只写 3 条，一生仍是 12 条

下一篇：27 · 接真 API：`DEEPSEEK_API_KEY`
