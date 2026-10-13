# 第 0 篇 · 热身：给 JS 学习者的 TypeScript 速查

在读第一节课之前，花五分钟看完这一页。TypeScript 是 JavaScript 的"超集"——所有合法 JS 都是合法 TS，TS 只多做了一件事：**给值标注类型**。类型标注在运行时会被完全擦掉，不影响程序行为。

## 1. 类型标注

```ts
const name: string = 'cordis'
const count: number = 42
const ready: boolean = true
const tags: string[] = ['a', 'b']
```

和 JS 的区别只是多了 `: 类型`。写错了会报错：

```ts
const name: string = 42  // 错误：不能把数字赋值给 string
```

## 2. 函数标注

```ts
function greet(who: string): string {
  return `Hello, ${who}!`
}
```

`who: string` 是参数类型，`(): string` 是返回值类型。

## 3. interface：描述对象的形状

JS 里一个对象长什么样只能靠自觉；TS 可以声明：

```ts
interface Config {
  greeting: string
  targets: string[]
}

const config: Config = { greeting: 'Hello', targets: ['world'] }
```

少了字段、多了字段、类型不对，都会报错。

## 4. type：给类型起别名

```ts
type Mode = 'native' | 'ptc'
const mode: Mode = 'native'  // 只能是这两个字符串之一
```

这种 `'a' | 'b'` 的写法叫**联合类型**，表示"只能是这几个值之一"。

## 5. import type：只导入类型

```ts
import type { Context } from '@deepseek-ai/cordis'
```

`import type` 导入的**只有类型信息**，编译后这行会整个消失。所以一个文件如果只是为了拿 `Context` 这个类型来写标注，加 `import type` 不会带来任何运行时依赖。

对比：`import { Service } from '@deepseek-ai/cordis'` 导入的是**真实的值**（一个类），这行会保留。

**判断方法**：如果导入的东西你只用来写 `: Xxx` 标注，就用 `import type`；如果你要 `new Xxx()` 或者调用它，就用普通 `import`。

## 6. 声明合并（declare module）

这是本教程最重要、也最"魔法"的一个 TS 特性。Cordis 允许你**给已经存在的接口追加字段**：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}
```

这段代码的运行时效果是**零**——它不生成任何 JS。它的作用是告诉 TypeScript："`ctx` 对象上现在多了一个叫 `greeter` 的属性。" 之后你写 `ctx.greeter` 就能通过类型检查。

真正让 `ctx.greeter` 有值的是另一段代码（插件里 `super(ctx, 'greeter')` 注册了一个服务）。声明合并管编译期，注册管运行期，两者配合。第一节课就会遇到它。

## 7. 泛型（第一次见到时够用的程度）

```ts
Schema.object({ greeting: Schema.string() })
```

`Schema.object(...)` 返回一个"校验器"。当你把它标注为 `Schema<Config>`，TS 会记住"这个校验器校验的是 Config 形状的对象"，之后 `config.greeting` 的类型自动就是 `string`。

现在你不需要会写泛型，能认出 `<Config>` 是"把一个类型参数传进去"就行。

## 8. async / await 你已经会了

TS 的异步和 JS 完全一样。唯一常见的标注是：

```ts
async function load(): Promise<string> {
  return 'done'
}
```

`Promise<string>` 表示"最终会给出一个 string 的异步操作"。

## 9. 可选与空值

```ts
interface ToolSchema {
  name: string          // 必须有
  description?: string  // 可以有，也可以没有
}
```

`?` 表示可选。访问可选属性时它的类型是 `string | undefined`。

---

学完这页，你已经掌握了阅读本教程全部代码所需的 TS 知识。**现在去第一篇。**
