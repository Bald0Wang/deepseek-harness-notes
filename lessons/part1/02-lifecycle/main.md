# 02 · 注册即效果

> 源码：[main.ts](./main.ts)　配置：[cordis.yml](./cordis.yml)

在 JS 里，你创建的资源（定时器、文件句柄、数据库连接）必须自己记得关。忘了关，就是内存泄漏。
Cordis 的核心承诺只有一句话：**你注册的一切，都会随插件卸载自动回收。**

## 本课代码

```ts
export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => console.log('A 心跳'), 100)
    return () => { clearInterval(timer); console.log('A 清理') }
  }, 'timer-A')
  // ...
}
```

运行（在本课目录下）：

```sh
node --import tsx/esm ../../../launcher.ts
```

输出末尾你会看到：

```
--- 主动卸载插件 ---
B 清理
A 清理
--- 卸载完成，进程退出 ---
```

## ctx.effect()：非托管资源的登记处

`setInterval` 是 Node 的东西，Cordis 不知道它的存在，自然也没法帮你清理。
`ctx.effect(执行体, 名字)` 就是为此设计的：

- `执行体` 立刻运行一次
- 它返回的**函数**就是"清理函数"（disposer）
- 插件卸载时，所有清理函数按**注册的相反顺序**执行

注意上面的输出：B 先清理、A 后清理。这就是"逆序"——后进先出，和叠盘子一样。
为什么逆序？因为后注册的资源往往依赖先注册的，先拆依赖方，安全。

第二个参数 `'timer-A'` 只是给人看的标签，不出现在输出里，但排查问题时有名字能救命。

## 哪些注册本身就是 effect

好消息是：大部分时候你不需要手动 `ctx.effect()`。以下写法返回的东西已经自带清理能力：

| 写法 | 卸载时自动发生 |
|---|---|
| `ctx.on('event', fn)` | 移除监听器 |
| `ctx.plugin(子插件)` | 卸载整棵子树 |
| `ctx.set('name', 值)` | 移除这个服务 |
| `ctx.effect(() => {...})` | 调用你返回的清理函数 |

只有 Cordis 管不到的外部资源（定时器、`fs.watch`、WebSocket、原生句柄……）才需要你手动包一层。
第 03 课我们会看到，连"服务"的注册也是自动回收的。

## 主动卸载：ctx.fiber

每个插件运行时都叫一个 **fiber**（纤维），`ctx.fiber` 就是当前插件自己的那一个。

```ts
await ctx.fiber.dispose()
```

调用后发生的事有严格顺序：

1. 状态变为 `UNLOADING`
2. 按逆序跑完所有清理函数（上面的 `B 清理` → `A 清理`）
3. 状态变为 `DISPOSED`，此后这个 fiber 不能重启

在真实项目里，卸载通常不是自己触发的，而是父插件被卸载、或者配置变了导致重载——你写的清理函数都会按同样的规则执行。这就是"注册即效果"：**你不用记住要关什么，系统会按注册顺序的逆序帮你关。**

## 一个反例：不加 effect 会怎样

把代码里的 `ctx.effect(() => {` 改成直接写 `const timer = setInterval(...)`（不 return 清理函数）：

- 卸载后 `A 心跳` **还在继续打印**
- `launcher.ts` 的主流程走完了，Node 却因为定时器不退出——你的程序"卡住"了

在 JS 里这叫"事件循环里有活没干完"。Cordis 用 effect 把这件事变得不可能忘记。

## 小结

- **注册即效果**：卸载 = 逆序执行所有清理函数
- `ctx.effect(执行体, 标签)` 包裹外部资源；返回清理函数
- `ctx.on` / `ctx.set` / `ctx.plugin` 等注册本身已是 effect，无需手包
- `ctx.fiber` 是当前插件的运行时；`dispose()` 走完整卸载流程

下一篇：[03 · 服务](03-services/main.md)
