# 03 · 服务

> 源码：[counter.ts](./counter.ts) · [main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

插件之间怎么共享能力？JS 里的答案是 `import`——但 import 是写死的，换实现就得改代码。
Cordis 的答案是**服务（Service）**：一个插件把能力以名字挂到 `ctx` 上，别的插件从 `ctx` 上取。
就像浏览器里的 `window.xxx`，只不过它有类型检查、有生命周期、能按需替换。

## 本课代码

[counter.ts](./counter.ts) 提供服务，[main.ts](./main.ts) 消费它：

```ts
// counter.ts
export class Counter extends Service {
  private count = 0
  constructor(ctx: Context) { super(ctx, 'counter') }   // ← 这一行完成注册
  increment() { return ++this.count }
  get value() { return this.count }
}

export function apply(ctx: Context) {
  ctx.plugin(Counter)   // 挂载这个服务
}
```

```ts
// main.ts
export const inject = ['counter']      // 声明依赖
export function apply(ctx: Context) {
  ctx.counter.increment()              // 直接用，不用 import
}
```

运行结果：`当前计数： 2`

## super(ctx, 'counter') 发生了什么

这一行做了两件事：

1. **运行时**：把这个 Counter 实例以名字 `counter` 挂到 `ctx` 上。之后任何插件都能写 `ctx.counter`。
2. **它是个 effect**：counter 插件一卸载，这个挂载自动消失。没有"忘了注销"这回事。

注意 `Counter` 类本身就是插件（第 01 课说的类形态）——`ctx.plugin(Counter)` 会 `new Counter(ctx)`，构造函数里的 `super()` 顺带完成注册。一个类身兼两职：既是插件入口，又是服务本体。

## declare module：让 ctx.counter 通过类型检查

这段代码看着像在"重新定义" cordis 的模块，运行时却什么也不做：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    counter: Counter
  }
}
```

这叫**声明合并**。TypeScript 看到它，就认为 `Context` 接口多了一个 `counter` 属性，于是 `ctx.counter.increment()` 能通过编译。删掉它？代码照样能跑，但 `tsc` 会报错"Context 类型上不存在 counter"。

这是本教程最重要的 TS 语法，第 0 篇速查里有详解。记住：**`declare` 开头的块都是给编译器看的，不会生成一行 JS。**

## inject：声明"我需要谁"

```ts
export const inject = ['counter']
```

Cordis 看到这句话，会让本插件保持 **PENDING（等待）**状态，直到 counter 服务真的出现才运行 `apply`。

这意味着 `apply` 里你可以放心写 `ctx.counter.increment()`，它一定在。不用写 `if (!ctx.counter) return` 这种防御代码——框架替你保证了。

**验证一下**：把 [cordis.yml](./cordis.yml) 里的 `- name: './counter.ts'` 那行删掉再跑：

- 没有任何输出
- 进程安静地退出，退出码 0
- 不报错，不半途运行

这不是失败，这是设计：缺依赖时"什么都不做"比"跑一半崩掉"更安全。真实项目里，如果应用跑起来却什么都没发生，第一个要查的就是"谁在 PENDING"（第 07 课教你怎么查）。

## 顺序无关

`cordis.yml` 里 counter 和 main 谁先谁后都行。决定启动时机的是依赖关系，不是文件顺序。把两行交换，结果一样。

## 服务名是全局扁平命名空间

`counter`、`greeter` 这类名字整个应用只有一个。deepseek-harness 里占用了 `tools`、`llm`、`session` 等名字——这就是为什么它敢让配置换掉某个服务的实现，消费方一行代码都不用改。

自己写插件时，起名带点前缀，别撞车。

## 小结

- **服务 = 挂到 ctx 上的具名能力**：消费方 `ctx.名字` 直接取，不 import
- `super(ctx, '名字')` 注册服务，随插件卸载自动消失
- `declare module` 让 `ctx.名字` 通过类型检查，纯编译期
- `inject: ['名字']` 声明硬依赖，缺了就一直 PENDING
- 加载顺序无关紧要，依赖关系才是王道

下一篇：[04 · 事件](04-events/main.md)
