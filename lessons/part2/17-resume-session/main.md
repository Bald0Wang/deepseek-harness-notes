# 17 · 断线重连：从磁盘恢复一个会话

> 源码：[session.ts](./session.ts) · [llm.ts](./llm.ts) · [mock-provider.ts](./mock-provider.ts) · [tools.ts](./tools.ts) · [define-tool.ts](./define-tool.ts) · [json-schema.ts](./json-schema.ts) · [provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 14 课结束时我们说过：再跑一次程序，日志会变成 12 条，前 6 条是上次的。当时的实现是"文件存在就整份读进来"，能跑，但有个没说破的隐患——**它不知道读进来的是什么**。

假设下个季度我们给 `SessionLine` 加了个必填字段。老文件里没有这个字段，读进来就是一堆 `undefined`。程序不报错，只是从此所有 `data.xxx` 都是 `undefined`，然后在某个毫无关系的角落崩掉，或者更糟——**不崩，静静地算错**。

本课补上这个缺口：文件得先自我介绍，我们核对完才肯用。

## 头行：文件的第一句话

现在新起的 session 文件，第一行是这样：

```jsonl
{"type":"session","version":1}
```

它没有 `seq`，没有 `time`，没有任何"发生过什么"的信息。它只回答一个问题：**这个文件是什么格式的。**

剩下的行才是记录。所以文件里混着两种行，得有个类型描述它：

```ts
export type SessionFileLine =
  | { type: 'session'; version: number }
  | SessionLine
```

harness 真身在 [packages/session/session-persistence-jsonl/src/format.ts](../../../deepseek-harness/packages/session/session-persistence-jsonl/src/format.ts) 里也叫 `HeaderLine`，`type` 字段值同样是 `'session'`。而且它的文件名带版本：`session.v4.jsonl`——**v4 就是 `SESSION_FORMAT_VERSION = 4`**（[packages/core/session/src/types.ts 第 89 行](../../../deepseek-harness/packages/core/session/src/types.ts#L89)）。格式升级时老文件原样留着，新文件用新名字，两边互不干扰。

我们的 `SESSION_FORMAT_VERSION = 1`，还处在"改一次就得重新来"的阶段，但机制是同一套。

## 拒绝加载，比猜着加载安全

`Session.load()` 现在干两件事：

```ts
static load(file: string): readonly SessionLine[] {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SessionFileLine)
  const [header, ...rest] = lines
  if (header.type !== 'session') {
    throw new Error(`session 文件第一行必须是头行，实际是 ${String(header.type)}`)
  }
  if (header.version !== SESSION_FORMAT_VERSION) {
    throw new Error(
      `session 格式版本不匹配：文件是 v${header.version}，本程序只会 v${SESSION_FORMAT_VERSION}`,
    )
  }
  // 剩下的都是记录行；头行在上面已经核对掉了
  return rest.filter(isSessionLine)
}
```

两处 `throw`，对应两种"这文件我不敢用"：

- 第一行不是头行 → 这压根不是我们这个程序写的文件
- 版本号对不上 → 是我們写的，但是另一个版本写的，字段含义可能已经变了

第二种是重点。**"可能已经变了"和"一定没变"之间，隔着一次崩溃排查。** 与其让程序带着一堆 `undefined` 跑三天然后在半夜崩，不如启动时就响亮地拒绝。这就是 harness 反复强调的那条：**misconfiguration fails loud**——配置对不上要在最早能发现的那一刻炸掉，不要静默跳过。

`rest.filter(isSessionLine)` 那行是给类型系统交代的：头行已经在上面核对过了，剩下的确实是记录。`isSessionLine` 是个类型谓词：

```ts
function isSessionLine(line: SessionFileLine): line is SessionLine {
  return line.type !== 'session'
}
```

`line is SessionLine` 这种返回值的函数叫**类型谓词**（type predicate）。它干的事比 `boolean` 多一点：告诉 TypeScript"我返回 `true` 的时候，参数就是 `SessionLine`"。这样 `filter` 的结果类型自动收窄成 `readonly SessionLine[]`，不用写任何断言。

## 新起还是恢复？

`JsonlSession` 的构造函数现在会记账：

```ts
readonly restoredCount: number

constructor(ctx: Context, config: { file: string }) {
  super(ctx)
  this.file = join(config.file, 'session.jsonl')
  mkdirSync(dirname(this.file), { recursive: true })

  // 恢复：接着磁盘上已有的行往下写，seq 继续往上加
  if (existsSync(this.file)) {
    const existing = Session.load(this.file)
    this.records.push(...existing)
    this.seq = existing.at(-1)?.seq ?? 0
    this.restoredCount = existing.length
  } else {
    this.restoredCount = 0
    // 新文件第一行写头行：以后谁来读这个文件，先核对版本
    appendFileSync(this.file, `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION })}\n`)
  }
}
```

`restoredCount` 是 `Session` 上的抽象成员，不是 `JsonlSession` 私有的——因为**"有没有历史"这件事，启动逻辑需要知道**。

[main.ts](./main.ts) 的 `apply` 第一段就是它：

```ts
const restored = ctx.session.restoredCount
if (restored > 0) {
  console.log(`=== 从磁盘恢复了 ${restored} 条记录，seq 接着 #${ctx.session.list().at(-1)?.seq ?? 0} 往下编 ===`)
  console.log('=== 模型看到的历史 ===')
  for (const message of ctx.session.deriveMessages()) {
    console.log(`[${message.role}] ${message.content}`)
  }
  setTimeout(() => ctx.emit('agent/turn', '刚才我问了什么？'), 50)
} else {
  console.log('=== 没有找到历史，开一个新会话 ===')
  setTimeout(() => ctx.emit('agent/turn', '北京天气怎么样？'), 50)
  setTimeout(() => ctx.emit('agent/turn', '你好'), 100)
  setTimeout(() => ctx.emit('agent/compact', 1, 6, '（摘要）……'), 200)
}
```

两条路，问的问题都不一样：

- **新起**：问天气、问好，然后压缩一遍——把第 16 课的流程重放一次，好给下次留点东西
- **恢复**：先打印模型看得见的历史，然后问"刚才我问了什么？"

注意恢复路径里没有 `agent/compact`。历史已经在上一轮压缩过了，再折一次没意义。**恢复不是重放脚本，是接着往下活。**

还有一处细节：恢复路径打印历史用的是 `deriveMessages()`，不是 `list()`。第 15 课说过，`list()` 是人看的全量，`deriveMessages()` 是模型看的。启动时打印它，等于把"模型醒来第一眼看到什么"直接摊给你看——这个视角在排查"模型为什么答得莫名其妙"时极其好用。

## harness 的 resume 长什么样

我们这套是"读文件 → 填数组 → 继续追加"。harness 真身要处理的事情多得多。

恢复的入口是 [Session.fromRestore()](../../../deepseek-harness/packages/core/session/src/index.ts#L528)，注释写得很清楚：

> Restore a detached session by adopting an independently owned or deeply frozen seed.

翻译：**把一个独立持有的、或者深度冻结的种子数据，接管成一个活着的会话。** 关键词是 `adopting`（接管）而不是 `copying`（拷贝）——它不复制你的数据，它认下这份数据，从此对它负责。

种子从哪来？看 [`CreateSessionOptions`](../../../deepseek-harness/packages/core/session/src/types.ts#L138)：

```ts
seed?: readonly SessionEvent[]   // 初始重放或分叉时提供的历史
meta: {
  cwd?: string
  parentSession?: string
  createdAt: number
  isSeeded?: boolean
  origin?: string
  delegationDepth?: number
  agentPreset?: string
}
```

除了 `seed`（就是我们的"读文件"），`meta` 里那几个字段值得逐个看——**它们全是"我是谁、我从哪来"的血缘登记**：

| 字段 | 登记什么 |
|---|---|
| `cwd` | 这个会话当时在哪个目录干活 |
| `parentSession` | 我是从哪个会话分叉出来的 |
| `isSeeded` | 我的历史是外部喂进来的，还是自己长的 |
| `origin` | 我怎么被叫起来的（用户发起？定时任务？webhook？） |
| `delegationDepth` | 我是第几层子代理（0 = 主会话） |
| `agentPreset` | 我当时用的是哪套人设 |

这些信息在 `SessionHeader` 里（[types.ts 第 100~131 行](../../../deepseek-harness/packages/core/session/src/types.ts#L100)）。恢复一个会话时，光有事件流不够——**你还得知道它是在什么处境下产生的**。换个目录、换个预设、换个父会话，同一段日志的含义可能完全不同。

我们的教学版只存了 `version`，因为目前只有一件事需要登记。但那个字段的位置是留给这张表的：等哪天你要做分叉、委派、定时唤醒，就往头行里加。

## 跑起来

**第一次跑**（`.sessions` 是空的，走新起路径）：

```
=== 没有找到历史，开一个新会话 ===

=== 用户说：北京天气怎么样？ ===
[模型决定] 调用 get_weather，参数 {"city":"北京"}
[工具返回] 北京：晴，12°C
[模型回答] 北京：晴，12°C。出门看情况带把伞。

=== 用户说：你好 ===
[模型回答] 我不知道怎么回答"你好"，但我可以查天气。

=== 压缩：#1~#6 折成一条摘要 ===
摘要落成 #7，它顶掉了 #1~#6

=== 日志全量（7 条）===
#1 [user/message] 北京天气怎么样？
#2 [tool/call] get_weather({"city":"北京"})
#3 [tool/result] 北京：晴，12°C
#4 [assistant/message] 北京：晴，12°C。出门看情况带把伞。
#5 [user/message] 你好
#6 [assistant/message] 我不知道怎么回答"你好"，但我可以查天气。
#7 [assistant/message] （摘要）用户问了北京天气，模型调了 get_weather 拿到"北京：晴，12°C"，并提醒出门看情况带把伞。　← replace #1~#6

=== 模型看到的历史（折叠后 1 条）===
[assistant] （摘要）用户问了北京天气，模型调了 get_weather 拿到"北京：晴，12°C"，并提醒出门看情况带把伞。
```

**紧接着再跑一次**（`.sessions` 还在，走恢复路径）：

```
=== 从磁盘恢复了 7 条记录，seq 接着 #7 往下编 ===
=== 模型看到的历史 ===
[assistant] （摘要）用户问了北京天气，模型调了 get_weather 拿到"北京：晴，12°C"，并提醒出门看情况带把伞。

=== 用户说：刚才我问了什么？ ===
[模型回答] 你问了我北京天气，我查完还提醒了你带伞。

=== 日志全量（9 条）===
#1 [user/message] 北京天气怎么样？
#2 [tool/call] get_weather({"city":"北京"})
#3 [tool/result] 北京：晴，12°C
#4 [assistant/message] 北京：晴，12°C。出门看情况带把伞。
#5 [user/message] 你好
#6 [assistant/message] 我不知道怎么回答"你好"，但我可以查天气。
#7 [assistant/message] （摘要）用户问了北京天气，模型调了 get_weather 拿到"北京：晴，12°C"，并提醒出门看情况带把伞。　← replace #1~#6
#8 [user/message] 刚才我问了什么？
#9 [assistant/message] 你问了我北京天气，我查完还提醒了你带伞。

=== 模型看到的历史（折叠后 3 条）===
[assistant] （摘要）用户问了北京天气，模型调了 get_weather 拿到"北京：晴，12°C"，并提醒出门看情况带把伞。
[user] 刚才我问了什么？
[assistant] 你问了我北京天气，我查完还提醒了你带伞。
```

注意第二次的 `seq`：从 `#8` 开始，接着上次的 `#7`。**序号跨进程连续**，因为它是从日志最后一行读出来的，不是从 0 数的。

还要注意第二次开头的"模型看到的历史"——只有 1 条，就是那条摘要。这就是第 16 课折叠机制的价值：如果当初直接把 `#1~#6` 删了，这次恢复出来的历史就什么都没有了；而因为它们还在文件里，`#7` 的 `replace` 标记才能在重启后继续生效。**压缩在重启后依然成立，靠的是日志没被删。**

## 动手改一改

**实验一：把版本号改掉，看它拒绝加载。** 跑完一次之后，把 `SESSION_FORMAT_VERSION` 从 `1` 改成 `2`，再跑。启动即崩：

```
session 格式版本不匹配：文件是 v1，本程序只会 v2
```

程序连 `apply` 都没进去。**这就是我们要的**——它没有"尽力猜猜老文件什么意思"，而是明确告诉你"我不敢用"。想升级格式？写迁移，或者像 harness 那样起个新文件名（`session.v4.jsonl`），老的原样留着。

**实验二：把头行删掉。** 用编辑器打开 `.sessions/demo/session.jsonl`，删掉第一行，再跑：

```
session 文件第一行必须是头行，实际是 user/message
```

注意报错说的是"实际是 `user/message`"——它把读到的那一行的 `type` 报出来了，而不是干巴巴一句"格式错误"。**报错信息要能指向原因**，这是第 07 课说过的事，这里再验证一次。

**实验三：在头行里加点血缘。** 给头行加上 `createdAt` 和 `cwd`，恢复时打印出来：

```ts
| { type: 'session'; version: number; createdAt: number; cwd: string }
```

```ts
console.log(`=== 这个会话创建于 ${new Date(header.createdAt).toLocaleString()}，目录 ${header.cwd} ===`)
```

跑两次，第二次会打印出第一次创建会话的时间。这就是 harness `SessionHeader` 那些字段的雏形——**恢复一个会话时，知道它"生前"的处境，和知道它说过什么同样重要。**

## 小结

- 头行（`type: 'session'` + `version`）是文件的自我介绍，不记录事件，只说明格式
- 版本对不上直接抛错：**拒绝加载比猜着加载安全**，misconfiguration fails loud
- `restoredCount` 让启动逻辑能区分"新起"和"恢复"，两条路径问的问题都不一样
- `deriveMessages()` 在启动时就把历史折出来——恢复的是"模型看得见的东西"，不只是字节
- 压缩在重启后依然生效，因为被顶掉的行还在文件里
- harness 的 resume 是 `Session.fromRestore()` 接管一份 seed，外加 `SessionHeader` 登记 `parentSession` / `isSeeded` / `delegationDepth` 等血缘

下一篇：[18 · system prompt：谁在给模型下指令](18-system-prompt/main.md)
