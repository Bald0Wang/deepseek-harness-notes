# 01 · 第一个插件

```bash
cd lessons/part1/01-first-plugin
node --import tsx/esm ../../../launcher.ts
```

预期输出：

```
hello from my first plugin
```

## 发生了什么

`launcher.ts` 做了三件事：创建一个根 `Context`（也就是 `ctx`）、挂上 Loader 插件、告诉 Loader 去读当前目录的 `cordis.yml`。然后 Loader 读到：

```yaml
- name: './main.ts'
```

`name` 是一个模块路径。Loader 加载这个模块，发现它导出了一个 `apply` 函数，于是调用它，把 `ctx` 作为第一个参数传进去。

**一个 Cordis 插件，就是这样一个模块。** 它不做初始化、不注册路由、不 `new` 任何东西。它只描述"我要往这个应用里贡献什么"。

## 代码逐行

```ts
import type { Context } from '@deepseek-ai/cordis'
```

`import type` 只导入类型（见[第 0 篇](../part0-typescript-primer/README.md)）。`Context` 在这里纯粹用来给 `ctx` 写标注。

```ts
export const name = 'hello'
```

可选的显示名，只出现在诊断信息里。和 YAML 里的 `name` 是两回事。

```ts
export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

插件主体。`apply` 是**对象插件**形状要求的方法名；Loader 加载的模块如果导出 `apply`，就按对象插件处理。

## 另外两种插件形状

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. 对象插件（本课）
export function apply(ctx: Context) {}

// 2. 函数插件：不需要 apply 方法，Loader 找不到 apply 时会尝试把默认导出当函数
export default function (ctx: Context) {}

// 3. 类插件：Service 子类（第 03 课讲）
export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }
}
```

日常开发 99% 用对象插件，因为它能同时携带 `name`、`inject`、`Config` 等元数据。

## 让它炸一次

把 `apply` 改成：

```ts
export function apply(ctx: Context) {
  throw new Error('apply exploded')
}
```

再运行，进程直接挂掉并打印你的错误。**插件加载失败是响亮的失败，不是一个被跳过的条目**——这是 Harness 的一条核心原则：配置错误必须在加载时暴露，不能带病启动。

## 一个坑

YAML 里的路径拼错时（比如 `./mian.ts`），Loader 不会让进程崩溃，而是通过 logger 报告，而 logger 此时可能还没挂上控制台输出——你看到的将是"什么都没发生"。遇到这种情况先检查拼写。

## 小结

- 插件 = 一个导出 `apply(ctx)` 的模块
- `ctx` 是插件唯一需要的东西，所有能力都从它这里进出
- 应用由 `cordis.yml` 组合而成，代码里没有 bootstrap

下一篇：[02 · 注册即效果](02-lifecycle/main.md)
