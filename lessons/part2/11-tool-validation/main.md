# 11 · 给工具上校验

> 源码：[json-schema.ts](./json-schema.ts) · [define-tool.ts](./define-tool.ts) · [tools.ts](./tools.ts) · [provider.ts](./provider.ts) · [weather.ts](./weather.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

第 10 课的 `get_weather` 有个致命的漏洞：`execute(args)` 里的 `args` 是**模型随便生成**的。模型完全可能传出 `{}`、`{ city: 123 }`、`{ city: '北京', 乱七八糟: true }`——你不校验，这些脏数据就直接流进了你的业务代码。

本课补上 harness 里最要紧的一道防线。

## 先看事故现场

第 11 课的 `main.ts` 里有两次故意使坏：

```
=== 用户说：空参数 ===
[模型决定] 调用 get_weather，参数 {}
[工具失败] invalid arguments: $.city 是必填项，但没有提供

=== 用户说：单位用错 ===
[模型决定] 调用 get_weather，参数 {"city":"北京","unit":"kelvin"}
[工具失败] invalid arguments: $.unit 必须是 "celsius" / "fahrenheit" 之一
```

模型胡言乱语，`execute` 一行都没跑。**参数在到达你的代码之前就被拦下了。**

## 声明即校验

[weather.ts](./weather.ts) 里的 `parameters` 现在不只是"说明书"了，它是**可执行的校验规则**：

```ts
parameters: {
  city: {
    type: 'string',
    required: true,          // ← 必须有
    description: '城市名，例如 "北京"',
  },
  unit: {
    type: 'string',
    enum: ['celsius', 'fahrenheit'],   // ← 只能这两个值
    description: '温度单位，默认摄氏度。',
  },
},
```

同一份声明干两件事：**给人看**（进模型请求）、**给机器看**（校验）。

## 三步走：编译 → 校验 → 拦

### 第一步：编译

[json-schema.ts](./json-schema.ts) 的 `compileNode()` 把手写 DSL 变成一棵 schema 树。`required: true` 从"属性上的一个标记"被提出来，变成对象节点的 `required` 数组——这正是标准 JSON Schema 的样子：

```ts
// 手写
{ type: 'object', properties: { city: { type: 'string', required: true } } }

// 编译后
{
  type: 'object',
  properties: { city: { type: 'string' } },
  required: ['city'],
  additionalProperties: false,
}
```

> harness 真身在 [packages/core/tools/src/schema.ts](../../../deepseek-harness/packages/core/tools/src/schema.ts) 做同样的事，叫 `parameterSchemaSpecToJsonSchema()`。它只接受一个**受限子集**——一个标量 `type`、对象 `properties`/`required`、布尔 `additionalProperties`、数组 `items`、标量 `enum`/`const`。子集之外的关键字**直接拒绝**，而不是"接受但不校验"：那会给作者一种虚假的安全感。我们的教学版沿用同样的思路。

### 第二步：校验

`validateValue(schema, value)` 递归地走这棵树，把所有违规**一次性收集齐**（不是碰到第一个就返回）：

```ts
export function validateValue(schema: JsonSchemaNode, value: unknown, path = '$'): string[] {
  const violations: string[] = []
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        violations.push(`${path} 必须是字符串，收到 ${describe(value)}`)
        break
      }
      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        violations.push(`${path} 必须是 ${...} 之一`)
      }
      break
    // ... number / boolean / array / object
  }
  return violations
}
```

`$` 是 JSON Path 的根，`$.city` 就是"根下面的 city"。错误信息能指到确切位置。

### 第三步：拦

[define-tool.ts](./define-tool.ts) 把校验包在用户代码**外面**：

```ts
async execute(args: ToolArgs, exec: ToolRunContext): Promise<unknown> {
  const violations = validateValue(compiled, args)
  if (violations.length > 0) {
    throw new ToolArgsError(options.name, violations)
  }
  return options.execute(args, exec)   // ← 只有这里才是你的业务代码
}
```

harness 真身（[schema.ts 第 597 行](../../../deepseek-harness/packages/core/tools/src/schema.ts#L597)）一字不差：

```ts
async execute(args: unknown, exec: ToolRunContext): Promise<JsonValue> {
  const violations = validate(args)
  if (violations.length > 0) throw new ToolArgsError(violations)
  return userExecute(args as InferArgs<S>, exec) as Promise<JsonValue>
}
```

`ToolArgsError` 也是真身同款（[schema.ts 第 461 行](../../../deepseek-harness/packages/core/tools/src/schema.ts#L461)），带一个 `violations` 数组——上层可以逐条展示给模型看。

## 拦下来之后呢

`ToolArgsError` 从 `execute` 抛出，被第 10 课写的 `call()` 的 `try/catch` 接住，收进 `ok: false` 的结果壳：

```
[工具失败] invalid arguments: $.city 是必填项，但没有提供
```

这个壳会**原样喂回给模型**。模型看到"`$.city` 是必填项"，下一轮就知道该补上 `city` 了。

这就是整个闭环：

```
模型生成参数 → 校验 → [失败] → 错误喂回模型 → 模型重试
                    → [通过] → 你的 execute → 结果喂回模型
```

**模型犯错是常态，不是异常。** 工具系统的设计目标不是"让模型不犯错"，而是"让犯错的代价小到模型能自己纠正"。

## 开放对象 vs 封闭对象

注意 `compileParameters()` 的最后一行：

```ts
function compileParameters(spec: Record<string, SchemaSpec> | undefined): JsonSchemaNode {
  if (spec === undefined) return { type: 'object', additionalProperties: true }
  const node = compileNode({ type: 'object', properties: spec })
  // 顶层参数对象是"开放"的：模型可以额外带字段，不像 output schema 那样严苛
  node.additionalProperties = true
  return node
}
```

**参数对象是开放的**（`additionalProperties: true`）——模型多带一个无害字段，不该让整次调用失败。而**输出 schema 是封闭的**——工具返回什么必须严格符合声明，因为那是写进 session log、要能被复现的数据。

harness 对两者区别对待，我们的简化版照抄这个判断。

## 为什么不用 schemastery

你可能会问：第 05 课的配置校验用的是 schemastery，这里为什么自己写？

因为两者校验的东西不同：

| | 配置（第 05 课） | 工具参数（本课） |
|---|---|---|
| 谁生成 | 人写 YAML | **模型**在运行时生成 |
| 失败意味着 | 作者写错了，必须炸 | 模型没听懂，要能反馈 |
| 规则形态 | TS 类型 + schema 两份 | 一份声明，同时进模型请求和校验 |

工具参数必须是**模型能读懂的形式**（JSON Schema 是模型最熟的格式），而且失败时要能给出"哪里错了、怎么改"的反馈。schemastery 的 schema 不是给模型看的。所以 harness 给工具单独造了一套 JSON Schema DSL——我们在 [json-schema.ts](./json-schema.ts) 里复刻的正是它。

## 动手改一改

在 `weather.ts` 的 `parameters` 里加一条**嵌套校验**，试试数组和对象：

```ts
parameters: {
  city: { type: 'string', required: true, description: '城市名' },
  days: {
    type: 'array',
    items: { type: 'number' },
    description: '要查几天，例如 [1, 3, 7]',
  },
},
```

然后在 `main.ts` 的 `matchTool` 里加一条：`if (input === '数组用错') return { name: 'get_weather', args: { city: '北京', days: [1, '三', 7] } }`

跑起来你会看到：

```
[工具失败] invalid arguments: $.days[1] 必须是数字，收到 "三"
```

`$.days[1]`——精确到数组下标。这就是"违规一次性收集齐"的价值：模型能同时看到所有问题，不用一轮一轮试。

## 小结

- 模型生成的参数**不可信**，`execute` 之前必须校验
- 一份 `parameters` 声明两用：进模型请求 + 运行时校验
- `compileNode()` 把手写 DSL 编译成 JSON Schema，`validateValue()` 递归校验，违规一次收齐
- `ToolArgsError` 在用户的 `execute` 之前抛出，被 `call()` 收进结果壳，喂回给模型让它自我纠正
- 参数对象开放（`additionalProperties: true`），输出对象封闭——两者区别对待
- 不用 schemastery：工具参数要模型能读懂，配置校验要作者写类型，是两种不同的活

下一篇：[12 · 把假模型和工具接起来](12-connect-llm-and-tools/main.md)
