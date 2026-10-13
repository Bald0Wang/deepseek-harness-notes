# 05 · 配置

> 源码：[main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

插件的行为总有些部分不该写死在代码里：问候语、目标列表、超时时间。
Cordis 的做法：**`cordis.yml` 里每个条目都能带一个 `config` 块，插件声明一个 schema，运行前先验证。**

## 本课代码

```ts
import Schema from '@deepseek-ai/schemastery'

// 接口给 TypeScript 看
export interface Config {
  greeting: string
  targets: string[]
}

// 同名 schema 给 Cordis 看
export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export function apply(ctx: Context, config: Config) {
  for (const target of config.targets) {
    console.log(`${config.greeting}, ${target}!`)
  }
}
```

配套的 `cordis.yml`：

```yaml
- name: './main.ts'
  config:
    targets: ['alpha', 'beta']
```

输出：

```
Hello, alpha!
Hello, beta!
```

注意 `greeting` 我们**根本没配**，但代码里照样能拿到 `'Hello'`——schema 的 `.default()` 补上了。
**`apply` 收到的 config 永远是完整、已验证过的。** 你不需要在函数体里写"如果用户没配就用默认值"。

## 一个名字，两个身份

注意 `Config` 出现了两次：一次是 `interface`，一次是 `const`。

```ts
export interface Config { ... }        // 编译后消失，给 tsc 用
export const Config: Schema<Config> = ...   // 运行时真实存在，给 Cordis 用
```

TypeScript 里类型和值在两个不同的世界，可以同名（叫"声明空间"和"值空间"）。所以这一行 `Schema<Config>` 同时用上了两者：泛型参数取接口，值是 schema。这是本仓库全体的约定写法，看着别扭，但它保证**类型和验证规则永远不会对不上**。

Schemastery 常用写法：

| 写法 | 含义 |
|---|---|
| `Schema.string()` | 必须是字符串 |
| `Schema.string().default('Hello')` | 可省略，缺省 `'Hello'` |
| `Schema.array(String)` | 元素为字符串的数组 |
| `Schema.number().min(0)` | 数字，最小 0 |
| `Schema.object({ ... })` | 对象，逐字段验证 |

## 让它炸一次

把 `cordis.yml` 改成：

```yaml
- name: './main.ts'
  config:
    targets: not-an-array
```

再跑，你会看到（教程的 launcher 已配置日志输出）：

```
[config-demo] ValidationError: invalid config:
  - $.targets expected array but got not-an-array (at targets)
[launcher] 插件加载失败（FAILED）：config-demo
```

退出码是 **1**。插件 fiber 进入 FAILED 状态，`apply` 一次都没被调用。

这就是 deepseek-harness 的铁律：**配置错误要大声失败（fail loud），绝不在配置不全时悄悄启动。**
对比一下 JS 世界里常见的"读不到配置就用默认值糊弄过去"——那种程序会带着错误假设跑很久，直到某个深夜才以奇怪的方式崩掉。

错误信息里的 `$.targets` 是 JSON Path：`$` 是整个 config，`targets` 是字段。深层嵌套的配置错在哪，一眼能看出来。

## 配置是入口，不是全局变量

注意 `config` 是通过 `apply(ctx, config)` 的**第二个参数**传进来的，不是从某个全局对象读的。这带来两个好处：

1. **插件可测试**：换份配置就是换个参数，不用改环境
2. **配置可被上层拦截**：`cordis.yml` 里父条目可以给子条目改配置，这也是 harness 能按 profile 覆盖设置的根基

配置块在 YAML 里是普通数据。唯一例外是 `!!js` 表达式——本教程用不到，知道有它就行（harness 用它读环境变量）。

## 小结

- `cordis.yml` 条目的 `config` 块是插件配置的入口
- 同名 `interface Config` + `const Config: Schema<Config>`：类型与验证规则一体两面
- `.default()` 让 `apply` 永远收到完整配置
- 验证失败 = FAILED + 退出码 1，`apply` 一次都不跑
- 配置经参数传入，可测、可被上层覆盖

下一篇：[06 · 组合](06-composition/main.md)
