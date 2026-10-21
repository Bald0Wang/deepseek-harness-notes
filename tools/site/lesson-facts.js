// 27 课“知识蓝图”：每课在整门课里的位置、对应 DSH 真身、机制结构图、
// 生活类比、易懵点。数据由课程正文逐课提炼，直接编辑本文件即可；
// course-data.js 会引用它，构建时合并进 content.json。

export const LESSON_FACTS = [
  {
    "num": 1,
    "slug": "01-first-plugin",
    "title": "第一个插件",
    "oneLiner": "写一个导出 apply 的模块，让 Loader 加载并运行",
    "problem": "还没有任何插件，应用起不来；也不知道 Harness 里说的“插件”到底是什么形状。",
    "gives": "能写出一个被 cordis.yml 加载、导出 apply(ctx) 的最小插件。",
    "nextUses": "第 02 课给这个 apply 里的定时器加清理函数；第 03 课把 apply 换成在构造时挂服务的类插件。",
    "dsh": [
      {
        "path": "packages/boot/app-boot",
        "what": "负责创建根 Context、挂 Loader、按配置加载插件的启动胶水。"
      }
    ],
    "concepts": [
      {
        "term": "插件",
        "plain": "一个普通模块，导出 apply 函数（或默认函数、Service 子类），只描述自己要往应用里贡献什么。"
      },
      {
        "term": "Context",
        "plain": "代码里的 ctx，一个共享的能力仓库：插件从这里取服务，也往它上面挂服务。"
      },
      {
        "term": "cordis.yml",
        "plain": "列出应用要加载哪些插件的 YAML，是应用的组合清单，代码里没有 bootstrap。"
      },
      {
        "term": "apply",
        "plain": "Loader 调用的入口函数，第一个参数固定是 ctx，插件主体就写在这里。"
      }
    ],
    "flow": {
      "title": "从 launcher 到 hello 的加载链",
      "kind": "chain",
      "nodes": [
        {
          "t": "启动 launcher",
          "s": "new Context 建根上下文",
          "k": "in"
        },
        {
          "t": "挂 Loader 插件",
          "s": "ctx.plugin(Loader)",
          "k": "step"
        },
        {
          "t": "读 cordis.yml",
          "s": "条目 name 指向 ./main.ts",
          "k": "step"
        },
        {
          "t": "加载模块",
          "s": "发现模块导出了 apply",
          "k": "step"
        },
        {
          "t": "调用 apply(ctx)",
          "s": "把 ctx 作为第一个参数",
          "k": "step"
        },
        {
          "t": "打印 hello",
          "s": "插件贡献生效",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "YAML 路径拼错（比如 ./mian.ts）不会让进程崩，只会经 logger 报告，而 logger 可能还没挂上控制台，于是看起来“什么都没发生”。",
      "apply 里抛错会让进程直接挂掉：插件加载失败是响亮的失败，不是一个被跳过的条目。",
      "模块里 export const name = 'hello' 只是诊断用的显示名，和 YAML 里的 name（模块路径）是两回事。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "开服加载 MOD",
      "lines": [
        [
          "游戏主程序",
          "launcher.ts 创建根 Context"
        ],
        [
          "MOD 清单",
          "cordis.yml 列出要加载的插件"
        ],
        [
          "MOD 的入口函数",
          "模块导出的 apply(ctx)"
        ],
        [
          "主程序照清单喊入口",
          "Loader 加载模块并调用 apply"
        ],
        [
          "MOD 写错直接崩服",
          "加载失败不静默跳过"
        ]
      ]
    }
  },
  {
    "num": 2,
    "slug": "02-lifecycle",
    "title": "注册即效果",
    "oneLiner": "用 ctx.effect 登记定时器，卸载时自动逆序清理",
    "problem": "JS 里 setInterval 这类资源必须自己关，忘了就泄漏；Cordis 根本不知道它的存在。",
    "gives": "学会用 ctx.effect 包裹非托管资源，并理解卸载时清理函数按注册的相反顺序执行。",
    "nextUses": "第 06 课的热替换靠它保证旧 fiber 卸载时资源全部回卷；第 10 课工具注册也用它把摘除函数挂到插件上。",
    "dsh": [
      {
        "path": "packages/boot/hmr",
        "what": "热重载时卸载旧 fiber 再加载新代码，依赖的正是 effect 的自动回卷。"
      }
    ],
    "concepts": [
      {
        "term": "effect",
        "plain": "ctx.effect(执行体, 标签) 会立刻运行执行体，并收下它返回的清理函数。"
      },
      {
        "term": "disposer",
        "plain": "清理函数：插件卸载时被调用；不返回函数就表示没有要清理的东西。"
      },
      {
        "term": "fiber",
        "plain": "每个插件的运行时实例，ctx.fiber 就是当前插件那一个，可以调 dispose()。"
      },
      {
        "term": "逆序清理",
        "plain": "后注册的清理函数先执行，因为后注册的资源往往依赖先注册的，先拆依赖方更安全。"
      }
    ],
    "flow": {
      "title": "一次卸载的完整回卷",
      "kind": "chain",
      "nodes": [
        {
          "t": "apply 注册 effect",
          "s": "定时器立刻启动",
          "k": "in"
        },
        {
          "t": "收下清理函数",
          "s": "clearInterval 并打日志",
          "k": "step"
        },
        {
          "t": "ctx.fiber.dispose()",
          "s": "主动卸载当前插件",
          "k": "step"
        },
        {
          "t": "状态变 UNLOADING",
          "s": "开始逆序回卷",
          "k": "step"
        },
        {
          "t": "B 清理 → A 清理",
          "s": "后注册的先拆",
          "k": "step"
        },
        {
          "t": "状态变 DISPOSED",
          "s": "这个 fiber 不能再重启",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "不把 setInterval 包进 effect、也不返回清理函数，卸载后心跳还在打，Node 因事件循环里有活而不退出。",
      "清理顺序是注册的逆序：输出里 B 清理先于 A 清理，不是按名字或字母排。",
      "effect 第二个参数只是给人看的标签，不出现在输出里，但排查“这个资源谁注册的”时能救命。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "分手时的搬家清单",
      "lines": [
        [
          "同居时带进来的东西",
          "effect 里创建的外部资源"
        ],
        [
          "搬进来时登记一张清单",
          "注册时交回清理函数"
        ],
        [
          "谁后搬进来先搬走",
          "清理函数逆序执行"
        ],
        [
          "分手流程走完",
          "dispose 到 DISPOSED"
        ],
        [
          "没登记的行李留在屋里",
          "不包 effect 就泄漏"
        ]
      ]
    }
  },
  {
    "num": 3,
    "slug": "03-services",
    "title": "服务",
    "oneLiner": "把 Counter 挂到 ctx 上，别人 inject 后直接调用",
    "problem": "插件之间共享能力只能靠 import，实现写死；也没有地方声明依赖、等依赖就位。",
    "gives": "会用 Service 子类加 super(ctx, '名字') 注册服务，并用 inject 声明硬依赖。",
    "nextUses": "第 04 课的事件服务、第 07 课的接缝定义都长在这套服务机制上；第 09 课的 llm 也是一个服务。",
    "dsh": [
      {
        "path": "packages/llm/llm",
        "what": "把模型能力定义成 ctx.llm 服务，消费方只认名字不认实现。"
      }
    ],
    "concepts": [
      {
        "term": "Service",
        "plain": "继承 Service 的类，构造时 super(ctx, '名字') 把这个实例以该名字挂到 ctx 上。"
      },
      {
        "term": "inject",
        "plain": "插件导出的字符串数组，声明依赖哪些服务；缺一个就停在 PENDING，不运行 apply。"
      },
      {
        "term": "声明合并",
        "plain": "declare module 给 Context 接口补一个属性，只影响 tsc，不生成任何 JS。"
      },
      {
        "term": "扁平命名空间",
        "plain": "服务名全应用唯一，counter、tools、llm、session 都只此一家，自建服务要带前缀。"
      }
    ],
    "flow": {
      "title": "服务从注册到被消费",
      "kind": "chain",
      "nodes": [
        {
          "t": "counter 插件 apply",
          "s": "ctx.plugin(Counter)",
          "k": "in"
        },
        {
          "t": "new Counter(ctx)",
          "s": "构造时 super(ctx,'counter')",
          "k": "step"
        },
        {
          "t": "挂到 ctx 上",
          "s": "这一步本身是 effect",
          "k": "step"
        },
        {
          "t": "main 声明 inject",
          "s": "['counter'] 是硬依赖",
          "k": "step"
        },
        {
          "t": "服务就位才 apply",
          "s": "否则一直 PENDING",
          "k": "step"
        },
        {
          "t": "ctx.counter.increment()",
          "s": "不 import 提供方",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "cordis.yml 删掉提供方后，消费方没有输出、进程安静退出、退出码 0——它是 PENDING，不是加载失败。",
      "只写 declare module 不加 inject，运行时伸手会拿到 cannot get property \"counter\" without inject。",
      "服务名是全局扁平的，counter、tools 这类名字整个应用只有一个，自建服务别撞车。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "队伍面板上的公共技能",
      "lines": [
        [
          "角色把治疗术挂到面板",
          "super(ctx,'名字') 注册服务"
        ],
        [
          "队友直接点面板加血",
          "ctx.counter.increment() 直接用"
        ],
        [
          "入队要求队里有治疗",
          "inject 声明硬依赖"
        ],
        [
          "没治疗就在门口等",
          "缺服务保持 PENDING"
        ],
        [
          "角色退队技能也消失",
          "服务随插件卸载自动移除"
        ]
      ]
    }
  },
  {
    "num": 4,
    "slug": "04-events",
    "title": "事件",
    "oneLiner": "用五种分发模式让互不认识的插件通信",
    "problem": "服务是点对点的，发通知的插件不知道谁在听；日志、界面这类旁观者根本接不上。",
    "gives": "掌握 emit、parallel、serial、bail、waterfall 五种模式，以及 waterfall 的短路规则。",
    "nextUses": "第 10 课工具注册用 tools/change 广播；第 18 课提示词变更用 system-prompt/change 通知订阅方。",
    "dsh": [
      {
        "path": "packages/core/agent",
        "what": "定义 agent/request 等事件词汇，让插件用 waterfall 插嘴改模型请求。"
      },
      {
        "path": "packages/interaction/user-approval",
        "what": "approval/request 用 waterfall 让策略插件代替用户做同意决策。"
      }
    ],
    "concepts": [
      {
        "term": "emit",
        "plain": "同步广播给所有监听器，不等待、不收集返回值，没有监听器也不报错。"
      },
      {
        "term": "waterfall",
        "plain": "环绕中间件式分发，监听器收到参数和 next()，调 next 往下传，不调就直接短路。"
      },
      {
        "term": "interface Events",
        "plain": "声明合并给事件名补上参数类型，emit 和 on 两边都能被 tsc 检查。"
      },
      {
        "term": "import type {}",
        "plain": "空导入，只让 TypeScript 加载对方文件里的声明合并，运行时不引入任何东西。"
      }
    ],
    "flow": {
      "title": "五种分发模式的分岔",
      "kind": "split",
      "nodes": [
        {
          "t": "stats 服务 emit",
          "s": "发的人不关心谁在听",
          "k": "in"
        },
        {
          "t": "emit：同步广播",
          "s": "不等也不收返回值",
          "k": "step"
        },
        {
          "t": "parallel：并发收集",
          "s": "所有监听器一起等完",
          "k": "step"
        },
        {
          "t": "serial：首个胜出",
          "s": "有返回值就停",
          "k": "step"
        },
        {
          "t": "bail：同步首个",
          "s": "serial 的同步版",
          "k": "step"
        },
        {
          "t": "waterfall：环绕",
          "s": "不调 next 即短路",
          "k": "warn"
        }
      ]
    },
    "pitfalls": [
      "只负责观察的 waterfall 监听器忘了调 next()，会悄无声息吞掉所有下游行为。",
      "emit 不等待也不收集返回值，想汇总多方结果必须用 parallel 并 await。",
      "消费方看不到事件声明时，要在文件头写 import type {} from './stats.ts'，它运行时不导入任何东西。"
    ],
    "analogy": {
      "scene": "追剧",
      "title": "剧粉群里的五种通知",
      "lines": [
        [
          "群里喊一嗓子新剧开播",
          "emit 同步广播，不等回复"
        ],
        [
          "同时私信问所有朋友",
          "parallel 并发收集结果"
        ],
        [
          "挨个问，谁先答算谁的",
          "serial 首个有返回值就停"
        ],
        [
          "群发改成当面快问",
          "bail 是 serial 的同步版"
        ],
        [
          "传话接力，中途可掐断",
          "waterfall 不调 next 就短路"
        ]
      ]
    }
  },
  {
    "num": 5,
    "slug": "05-config",
    "title": "配置",
    "oneLiner": "用 schema 校验 config，坏配置在加载时就炸",
    "problem": "问候语、目标列表这类东西不该写死在代码里，但外部配置又随时可能写错。",
    "gives": "会用同名 interface 加 const Config: Schema 声明配置，让 apply 永远收到补全且校验过的 config。",
    "nextUses": "第 06 课的条目 config/disabled 依赖它；第 11 课会把“声明即校验”推到模型生成的工具参数上。",
    "dsh": [
      {
        "path": "packages/boot/config-editor",
        "what": "通过 profile 补丁持久化插件配置，并让 Loader 重新对账。"
      },
      {
        "path": "packages/settings/settings",
        "what": "把用户设置抽象成 ctx.settings 接缝，是配置在真身里的另一层。"
      }
    ],
    "concepts": [
      {
        "term": "Config schema",
        "plain": "导出 const Config: Schema<Config>，Cordis 在调用 apply 前用它验证并补默认值。"
      },
      {
        "term": "default",
        "plain": "Schema.string().default('Hello') 让字段可省略，缺省时自动填这个值。"
      },
      {
        "term": "声明空间与值空间",
        "plain": "interface Config 和 const Config 可以同名，前者只给 tsc，后者给运行时。"
      },
      {
        "term": "fail loud",
        "plain": "配置非法时 fiber 进 FAILED、退出码 1，apply 一次都不跑，绝不带病启动。"
      }
    ],
    "flow": {
      "title": "配置的校验与放行",
      "kind": "split",
      "nodes": [
        {
          "t": "读 cordis.yml config",
          "s": "targets: ['alpha','beta']",
          "k": "in"
        },
        {
          "t": "找同名 Config schema",
          "s": "逐字段校验并补 default",
          "k": "step"
        },
        {
          "t": "校验通过",
          "s": "greeting 得到 Hello",
          "k": "ok"
        },
        {
          "t": "apply(ctx, config)",
          "s": "拿到完整已验证配置",
          "k": "out"
        },
        {
          "t": "校验失败",
          "s": "fiber 进入 FAILED",
          "k": "warn"
        },
        {
          "t": "退出码 1",
          "s": "apply 一次都不跑",
          "k": "warn"
        }
      ]
    },
    "pitfalls": [
      "targets 写成 not-an-array 时，报错是 $.targets expected array but got not-an-array，fiber 进 FAILED、退出码 1。",
      "interface Config 编译后消失，真正执行校验的是 const Config 那个 schema，两者缺一不可。",
      "config 是 apply 的第二个参数，不是全局变量；父条目还能覆盖子条目配置。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "约会前的条件清单",
      "lines": [
        [
          "见面前提的条件清单",
          "Config schema 声明字段"
        ],
        [
          "没写的要求按默认来",
          "default 补上缺省值"
        ],
        [
          "条件不符当场取消",
          "校验失败 FAILED、退出码 1"
        ],
        [
          "不带病赴约",
          "坏配置不静默启动"
        ],
        [
          "清单一份给人一份给机器",
          "interface 给 tsc，schema 给运行时"
        ]
      ]
    }
  },
  {
    "num": 6,
    "slug": "06-composition",
    "title": "组合与诊断",
    "oneLiner": "用 cordis.yml 编排插件树，从 fiber 状态查出谁在 PENDING",
    "problem": "单个插件会写了，但真实应用是几十个插件的树；某个插件没反应时也不知道从哪查。",
    "gives": "会用 id、config、disabled 编排组合，并通过遍历 ctx.registry 诊断 PENDING。",
    "nextUses": "第 07 课换提供方只改 cordis.yml 一行；第 08 课把这套 fiber 状态查看扩成完整诊断流程。",
    "dsh": [
      {
        "path": "packages/boot/app-boot",
        "what": "按 profile 与配置组装插件树，并跑 Loader 启动序列。"
      },
      {
        "path": "packages/boot/hmr",
        "what": "监视配置与模块变化，卸载旧 fiber 后加载新代码。"
      }
    ],
    "concepts": [
      {
        "term": "id",
        "plain": "条目的稳定身份，loader 靠它区分“改了配置”和“删旧增新”，正式项目每项都该写。"
      },
      {
        "term": "disabled",
        "plain": "保留条目但不加载；改回 false 时它和因它 PENDING 的插件一起复活。"
      },
      {
        "term": "PENDING",
        "plain": "inject 的服务不存在时插件停在这个状态，不报错、不输出、也不跑 apply。"
      },
      {
        "term": "热替换",
        "plain": "卸载旧 fiber（effect 逆序回卷）再在新上下文加载新代码，HMR 就是这个动作。"
      }
    ],
    "flow": {
      "title": "插件树的组装与体检",
      "kind": "chain",
      "nodes": [
        {
          "t": "读 yml 条目",
          "s": "id / name / config / disabled",
          "k": "in"
        },
        {
          "t": "Loader 建 fiber",
          "s": "每个条目一个运行时",
          "k": "step"
        },
        {
          "t": "解析依赖图",
          "s": "加载顺序无关紧要",
          "k": "step"
        },
        {
          "t": "依赖齐 → ACTIVE",
          "s": "apply 这才执行",
          "k": "ok"
        },
        {
          "t": "缺服务 → PENDING",
          "s": "静默，没有任何输出",
          "k": "warn"
        },
        {
          "t": "遍历 registry 诊断",
          "s": "按 fiber.state 打印",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "整个应用“跑起来了但毫无反应”，九成是某个插件在 PENDING：遍历 ctx.registry.values() 看 fiber.state。",
      "cordis 发布包里 FiberState 是 const enum，import 会运行时报 does not provide an export，教程直接用数字 0~5。",
      "怀疑某插件有问题时先 disabled: true，而不是删掉那几行——删了会连带依赖它的插件一起挂起。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "开黑前的阵容表",
      "lines": [
        [
          "阵容表列出谁上场",
          "cordis.yml 的条目"
        ],
        [
          "给每人固定一个编号",
          "id 让 loader 认得出变更"
        ],
        [
          "缺辅助就全队等着",
          "缺 inject 服务保持 PENDING"
        ],
        [
          "替补席先不登场",
          "disabled: true 保留但不加载"
        ],
        [
          "换人不用重开房间",
          "热替换 = 卸载旧 fiber 再加载"
        ]
      ]
    }
  },
  {
    "num": 7,
    "slug": "07-capability-seam",
    "title": "能力接缝",
    "oneLiner": "把通知能力拆成定义、提供方、消费方三个角色",
    "problem": "直接调具体实现，会让“换一种通知方式”变成改消费方代码，半年后谁都改不动。",
    "gives": "会写 abstract Service 定义加多个提供方，并让消费方只依赖抽象。",
    "nextUses": "第 09 课的 llm、第 10 课的 tools、第 14 课的 session 都照这三个角色搭；第 12 课把其中两条接缝接起来。",
    "dsh": [
      {
        "path": "packages/shell/shell",
        "what": "定义 ctx.shell 抽象执行器，是能力接缝的 Service Definition。"
      },
      {
        "path": "packages/shell/bash-local",
        "what": "本机执行命令的提供方，与 sandbox 版的消费方完全一样。"
      }
    ],
    "concepts": [
      {
        "term": "Service Definition",
        "plain": "抽象类，规定能力叫什么、方法签名是什么，不允许被直接 new。"
      },
      {
        "term": "Service Provider",
        "plain": "实现定义的具体类，可以有好几个，比如控制台版和全大写版。"
      },
      {
        "term": "Consumer",
        "plain": "只 inject 抽象、不 import 任何提供方的插件，换实现时它不用改。"
      },
      {
        "term": "abstract",
        "plain": "TS 关键字：禁止实例化这个类，并要求子类实现标了 abstract 的方法。"
      }
    ],
    "flow": {
      "title": "一条接缝的三个角色",
      "kind": "chain",
      "nodes": [
        {
          "t": "定义 abstract Notifier",
          "s": "super(ctx,'notifier')",
          "k": "in"
        },
        {
          "t": "提供方实现 send",
          "s": "Console 与 Uppercase 两版",
          "k": "step"
        },
        {
          "t": "main 只 inject notifier",
          "s": "import type {} 借类型",
          "k": "step"
        },
        {
          "t": "ctx.notifier.send()",
          "s": "不知道背后是谁",
          "k": "step"
        },
        {
          "t": "改 yml 换提供方",
          "s": "消费方零改动",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "notifier.ts 只被 import、不出现在 cordis.yml 里——它是词汇表，不是插件。",
      "三个角色缺一不可：只有定义会永远 PENDING，只有提供方没有类型保障，没有消费方就是死代码。",
      "只写定义没提供方时，症状和第 06 课的 PENDING 一模一样，很容易误判成加载器坏了。"
    ],
    "analogy": {
      "scene": "追剧",
      "title": "同一部剧换播放源",
      "lines": [
        [
          "“能播放”这个能力",
          "Service Definition 抽象类"
        ],
        [
          "各家视频平台",
          "Service Provider 多个实现"
        ],
        [
          "你按遥控器播放",
          "Consumer 只调抽象方法"
        ],
        [
          "换平台只换输入源",
          "改 cordis.yml 一行"
        ],
        [
          "遥控器不用重买",
          "消费方零改动"
        ]
      ]
    }
  },
  {
    "num": 8,
    "slug": "08-diagnostics",
    "title": "诊断与调试",
    "oneLiner": "看懂 fiber 六状态，确认一个插件炸了不拖垮全进程",
    "problem": "插件出 bug 时看不出它处在什么状态，也不知道一个插件故障会不会传染给别人。",
    "gives": "会读六种 fiber 状态、用 ctx.registry 看全景、用 fiber.await() 抓启动错误。",
    "nextUses": "第 17 课“版本不符就拒绝加载”要求启动即崩，判断依据正是这里的 FAILED 与退出码。",
    "dsh": [
      {
        "path": "packages/boot/plugin-manager",
        "what": "管理当前 profile 的插件与 bundle，加载状态最终汇总到这里。"
      },
      {
        "path": "packages/boot/app-boot",
        "what": "启动序列里带 fail-loud 的 Loader 守卫，插件没起来不会被忽略。"
      }
    ],
    "concepts": [
      {
        "term": "FiberState",
        "plain": "fiber 的六种状态：PENDING、LOADING、ACTIVE、FAILED、UNLOADING、DISPOSED，对应数字 0~5。"
      },
      {
        "term": "fiber 隔离",
        "plain": "单个插件抛错只让自己的 fiber 进 FAILED 并回卷 effect，其他插件照常运行。"
      },
      {
        "term": "ctx.registry",
        "plain": "全局插件登记册，可以遍历每个 runtime 的 fibers 查看状态。"
      },
      {
        "term": "fiber.await()",
        "plain": "把插件启动结果当 Promise 等，失败时重放启动时那个错误。"
      }
    ],
    "flow": {
      "title": "fiber 状态机与隔离",
      "kind": "split",
      "nodes": [
        {
          "t": "遍历 ctx.registry",
          "s": "拿每个 runtime 的 fibers",
          "k": "in"
        },
        {
          "t": "PENDING",
          "s": "在等 inject 的服务",
          "k": "warn"
        },
        {
          "t": "LOADING",
          "s": "apply 正在跑",
          "k": "step"
        },
        {
          "t": "ACTIVE",
          "s": "正常运行",
          "k": "ok"
        },
        {
          "t": "FAILED",
          "s": "抛错，effect 已回卷",
          "k": "warn"
        },
        {
          "t": "UNLOADING / DISPOSED",
          "s": "正在或已经卸载",
          "k": "step"
        },
        {
          "t": "其他插件不受影响",
          "s": "故障被关在自己的 fiber",
          "k": "ok"
        }
      ]
    },
    "pitfalls": [
      "launcher 不配 console exporter，cordis 日志只进内存缓冲，插件炸了你也看不到任何输出。",
      "BrokenPlugin 构造时抛错后，其他插件仍 ACTIVE、进程照常跑完、退出码 0——别把“没崩”当成“没坏”。",
      "FiberState 在 npm 包里没有真实导出，教程用数字 0~5；写成命名导入会在运行时报错。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "团战里的队伍面板",
      "lines": [
        [
          "队友状态面板",
          "ctx.registry 里的 fiber.state"
        ],
        [
          "还在门口等治疗",
          "PENDING"
        ],
        [
          "正在读条",
          "LOADING"
        ],
        [
          "一个人阵亡",
          "FAILED，装备自动回收"
        ],
        [
          "团战照常打完",
          "故障隔离，其他插件 ACTIVE"
        ]
      ]
    }
  },
  {
    "num": 9,
    "slug": "09-fake-llm",
    "title": "造一个假 llm 服务",
    "oneLiner": "按剧本吐 StreamChunk 的 MockAdapter，不用 Key 驱动 loop",
    "problem": "真模型要 API Key、要联网、要花钱，既没法离线讲清流式协议，也没法给第二篇当模型。",
    "gives": "会定义 Llm 抽象、用异步生成器写假适配器、用 for await 消费七种 chunk。",
    "nextUses": "第 12 课把 MockAdapter 升级成“常驻大脑”并接上 tools；第 14 课起它继续当 loop 的模型。",
    "dsh": [
      {
        "path": "packages/llm/llm",
        "what": "定义 provider 中立的 Llm 服务与 StreamChunk 词汇。"
      },
      {
        "path": "packages/llm/llm-deepseek",
        "what": "真模型提供方，把 Messages 协议的 SSE 翻译成同一套 StreamChunk。"
      }
    ],
    "concepts": [
      {
        "term": "StreamChunk",
        "plain": "模型流式输出的七种碎片，用 type 判别：block-start、text-delta、reasoning-delta、tool-call-delta、block-end、usage、finish。"
      },
      {
        "term": "判别联合",
        "plain": "每个成员带一个字面量 type 标签，switch 之后 TS 能收窄类型并检查是否漏分支。"
      },
      {
        "term": "async function*",
        "plain": "异步生成器，yield 一次吐一个值，调用方用 for await 逐个收。"
      },
      {
        "term": "index",
        "plain": "内容块编号，模型边说边调工具时，碎片靠 index 认领自己属于哪个块。"
      }
    ],
    "flow": {
      "title": "一段假回复的流式路径",
      "kind": "chain",
      "nodes": [
        {
          "t": "main 调 stream",
          "s": "传入 GenerateOptions",
          "k": "in"
        },
        {
          "t": "取剧本条目",
          "s": "静态数组或函数",
          "k": "step"
        },
        {
          "t": "async* 逐片 yield",
          "s": "每片之间 sleep 60ms",
          "k": "step"
        },
        {
          "t": "for await 收碎片",
          "s": "一片一片处理",
          "k": "step"
        },
        {
          "t": "switch(chunk.type)",
          "s": "七种类型各打一行",
          "k": "step"
        },
        {
          "t": "usage + finish 收尾",
          "s": "流完才知道花多少",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "tool-call 的第二条 delta 没有 name：名字只在第一条出现，参数得按 id 拼起来才完整。",
      "chunk 顺序是 block-start → delta → block-end → usage → finish，usage 和 finish 不能提前。",
      "yield 之间不 await，整个流会在同一个 tick 里吐完，消费方一次都等不到——那就不叫流式。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "恋爱陪练机器人的回信",
      "lines": [
        [
          "陪练按剧本人设回话",
          "MockAdapter 按 script 演"
        ],
        [
          "一个字一个字发消息",
          "text-delta 逐字符 yield"
        ],
        [
          "你一条条读完再回",
          "for await 逐个消费 chunk"
        ],
        [
          "每条消息带编号",
          "index 标明属于哪个块"
        ],
        [
          "最后补一句聊完了",
          "finish 加 usage 收尾"
        ]
      ]
    }
  },
  {
    "num": 10,
    "slug": "10-what-is-a-tool",
    "title": "工具是什么",
    "oneLiner": "把说明书和 execute 打包注册进 ctx.tools",
    "problem": "第 09 课模型只会说“要调 get_weather”，没人执行；也没有注册表让它挑工具。",
    "gives": "会用 defineTool 注册带 JSON Schema 说明书的工具，并让 call 永不抛异常。",
    "nextUses": "第 11 课给这份 parameters 加运行时校验；第 12 课让模型的 tool-call 输出真的触发 ctx.tools.call。",
    "dsh": [
      {
        "path": "packages/core/tools",
        "what": "定义 ToolDefinition、defineTool 与工具注册/执行管线。"
      },
      {
        "path": "packages/web/tool-web",
        "what": "真身的 web_search，name/description/parameters/execute 形状与本课一致。"
      }
    ],
    "concepts": [
      {
        "term": "ToolDefinition",
        "plain": "一份工具定义，包含给模型看的 name/description/parameters 和给运行时跑的 execute。"
      },
      {
        "term": "defineTool",
        "plain": "工厂函数，把这些字段打包成 ToolDefinition，并保留参数的类型推导。"
      },
      {
        "term": "ToolResult",
        "plain": "结果壳 { ok, callId, name, value 或 error }，失败也返回它而不是抛异常。"
      },
      {
        "term": "register",
        "plain": "往注册表放定义，返回摘除函数，随注册方插件卸载自动执行。"
      }
    ],
    "flow": {
      "title": "工具从注册到执行",
      "kind": "chain",
      "nodes": [
        {
          "t": "defineTool 写说明书",
          "s": "name/description/parameters",
          "k": "in"
        },
        {
          "t": "inject 后 register",
          "s": "用 effect 收下清理函数",
          "k": "step"
        },
        {
          "t": "模型读说明书选工具",
          "s": "它只看得到 schema",
          "k": "step"
        },
        {
          "t": "ctx.tools.call",
          "s": "查表并跑 execute",
          "k": "step"
        },
        {
          "t": "成功返回 value",
          "s": "包进 ok: true",
          "k": "ok"
        },
        {
          "t": "失败返回 error",
          "s": "不抛异常，用结果壳",
          "k": "warn"
        }
      ]
    },
    "pitfalls": [
      "忘了 export const inject = ['tools']，apply 里拿 ctx.tools 会报 cannot get property \"tools\" without inject。",
      "description 写得含糊（比如“天气工具”），模型只能瞎猜参数；说明书是写给模型看的。",
      "把 weather.ts 从 cordis.yml 删掉，三段对话全变成“工具不存在”：工具注册是插件的效果。"
    ],
    "analogy": {
      "scene": "追剧",
      "title": "选角导演只看资料卡",
      "lines": [
        [
          "演员资料卡",
          "name/description/parameters"
        ],
        [
          "导演按资料卡选人",
          "模型只看说明书挑工具"
        ],
        [
          "资料卡写不清就选错",
          "description 含糊模型调错"
        ],
        [
          "演员真正上场表演",
          "execute 在运行时执行"
        ],
        [
          "试镜失败也要留记录",
          "失败收进 ok:false 结果壳"
        ]
      ]
    }
  },
  {
    "num": 11,
    "slug": "11-tool-validation",
    "title": "给工具上校验",
    "oneLiner": "把手写参数 DSL 编译成 JSON Schema 并前置校验",
    "problem": "模型生成的参数不可信，可能缺必填字段或给错枚举，脏数据会直接流进业务代码。",
    "gives": "会编译参数 DSL、递归收集违规，并用 ToolArgsError 在用户 execute 之前拦下。",
    "nextUses": "第 12 课故意让 decide 漏参数，验证这道校验在 agent loop 里同样生效；第 13 课按失败类型分流处置。",
    "dsh": [
      {
        "path": "packages/core/tools/src/schema.ts",
        "what": "真身的参数 DSL 到 JSON Schema 编译，以及 validateValue 和 ToolArgsError。"
      }
    ],
    "concepts": [
      {
        "term": "编译",
        "plain": "compileNode() 把 { type, required, ... } 的手写 DSL 变成标准 JSON Schema 树。"
      },
      {
        "term": "validateValue",
        "plain": "递归走 schema 树，把违规一次性收集成字符串数组，而不是碰到第一个就返回。"
      },
      {
        "term": "ToolArgsError",
        "plain": "带 violations 数组的错误，在用户 execute 之前抛出，被 call() 收进结果壳。"
      },
      {
        "term": "additionalProperties",
        "plain": "参数顶层设 true 让模型可以多带字段；输出 schema 设 false，严格符合声明。"
      }
    ],
    "flow": {
      "title": "参数校验的三步",
      "kind": "chain",
      "nodes": [
        {
          "t": "写 parameters DSL",
          "s": "city 必填、unit 枚举",
          "k": "in"
        },
        {
          "t": "compileNode 编译",
          "s": "required 提成数组",
          "k": "step"
        },
        {
          "t": "模型传参进 call",
          "s": "可能是 {} 或 kelvin",
          "k": "step"
        },
        {
          "t": "validateValue 收集",
          "s": "一次收齐所有违规",
          "k": "step"
        },
        {
          "t": "抛 ToolArgsError",
          "s": "execute 一行没跑",
          "k": "warn"
        },
        {
          "t": "call 收进 ok:false",
          "s": "错误原样喂回模型",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "compileParameters 顶层把 additionalProperties 设 true：模型多带无害字段不该让整次调用失败；输出 schema 才封闭。",
      "校验失败时用户 execute 一行都没跑，别在业务代码里再写一遍防御——错误已经由 call 收进结果壳。",
      "工具参数不能用 schemastery：那份 schema 不是给模型看的，模型读不懂就无从自我纠正。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "相亲前红娘核对资料",
      "lines": [
        [
          "红娘手里的条件表",
          "parameters 声明"
        ],
        [
          "条件表译成核对规则",
          "compileNode 编译成 JSON Schema"
        ],
        [
          "资料缺项或写错",
          "validateValue 收集违规"
        ],
        [
          "当场退回并说明原因",
          "ToolArgsError 带 violations"
        ],
        [
          "不安排见面",
          "execute 一行不跑"
        ]
      ]
    }
  },
  {
    "num": 12,
    "slug": "12-connect-llm-and-tools",
    "title": "把假模型和工具接起来",
    "oneLiner": "用 collect 把流式碎片拼成 ModelTurn，跑通第一圈",
    "problem": "llm 和 tools 两条接缝各自能跑，但从没见过面：模型说要调工具时没人执行。",
    "gives": "会按 index 拼 delta、用 ModelTurn 判别联合分流，把模型决定变成真实工具调用。",
    "nextUses": "第 13 课在 executeTool 上分出三种失败路径；第 14 课把这个 loop 的每一步写进 session log。",
    "dsh": [
      {
        "path": "packages/llm/llm/src/types.ts",
        "what": "真身的 ContentBlock 联合，对应本课 ModelTurn 的位置。"
      },
      {
        "path": "packages/core/tools",
        "what": "工具注册表，loop 通过它按名字执行模型选中的工具。"
      }
    ],
    "concepts": [
      {
        "term": "collect",
        "plain": "消费整条流，按 index 把 text-delta 和 tool-call-delta 拼回完整块。"
      },
      {
        "term": "argumentsDelta",
        "plain": "工具参数的 JSON 增量，必须拼接起来才能 JSON.parse 出完整参数。"
      },
      {
        "term": "ModelTurn",
        "plain": "本课的判别联合：{ kind: 'text' } 或 { kind: 'tool-call', id, name, args }。"
      },
      {
        "term": "函数剧本",
        "plain": "script 里的函数条目每轮重新执行、不消耗游标，模拟真模型的无状态决策。"
      }
    ],
    "flow": {
      "title": "模型决定变成工具调用",
      "kind": "chain",
      "nodes": [
        {
          "t": "inject llm + tools",
          "s": "两条接缝都就位才激活",
          "k": "in"
        },
        {
          "t": "ctx.llm.stream 取流",
          "s": "函数剧本每轮重算",
          "k": "step"
        },
        {
          "t": "collect 按 index 拼",
          "s": "name 不被 undefined 覆盖",
          "k": "step"
        },
        {
          "t": "得到 ModelTurn",
          "s": "kind 是判别标签",
          "k": "step"
        },
        {
          "t": "switch turn.kind",
          "s": "text 或 tool-call",
          "k": "step"
        },
        {
          "t": "tool-call 调 tools.call",
          "s": "结果只打印，未回喂",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "tool-call-delta 的 name 只在第一条出现，无条件赋值会把名字抹成 undefined。",
      "第 09 课的 script.shift() 读完就没了，第二轮直接抛“剧本用完了”；要撑 loop 必须用不消耗的函数条目。",
      "本课只跑一圈：工具结果只打印在屏幕上，没有追加回 messages 再请求一次模型。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "恋爱传话只传了一半",
      "lines": [
        [
          "对方说我想要花",
          "模型输出 tool-call"
        ],
        [
          "你照做去买花",
          "collect 后调 ctx.tools.call"
        ],
        [
          "花送到了你放桌上",
          "结果只 console.log"
        ],
        [
          "没告诉对方花到了",
          "结果没回喂 messages"
        ],
        [
          "对话停在这一句",
          "缺 agent loop 第二圈"
        ]
      ]
    }
  },
  {
    "num": 13,
    "slug": "13-tool-failure",
    "title": "工具失败了怎么办",
    "oneLiner": "把工具失败拆成三类，分别回喂或重试",
    "problem": "所有失败都长成 { ok:false, error }，一条“失败”把三种完全不同的处置方式盖住了。",
    "gives": "会分类失败：模型错就 reportToModel 回喂，工具错才 retry，且只对幂等调用重试。",
    "nextUses": "第 14 课把这些失败也 append 进日志（tool/result 的 isError）；第 15 课折叠时它们照样进模型历史。",
    "dsh": [
      {
        "path": "packages/core/tools/src/index.ts",
        "what": "真身用 ToolErrorInfo{name,code} 与 ToolNotFoundError 做结构化失败分类。"
      },
      {
        "path": "packages/guard/timeout-policy",
        "what": "把超时这类暂时性失败包装成统一结果，重试逻辑读 code 不读 message。"
      }
    ],
    "concepts": [
      {
        "term": "classifyFailure",
        "plain": "按错误信息前缀判断失败类型：unknown-tool、invalid-args、crashed。"
      },
      {
        "term": "reportToModel",
        "plain": "把错误写进一条 assistant 消息再请求模型，让模型看见并自我纠正。"
      },
      {
        "term": "retry",
        "plain": "等 100ms 再调一次，只适用于幂等工具；转账类重试会变成转两笔。"
      },
      {
        "term": "结果壳",
        "plain": "call 永不抛异常，所有失败都变成 { ok:false, callId, name, error }。"
      }
    ],
    "flow": {
      "title": "三种失败的三条路",
      "kind": "split",
      "nodes": [
        {
          "t": "call 返回结果壳",
          "s": "成功失败都走这里",
          "k": "in"
        },
        {
          "t": "成功：打印 value",
          "s": "直接结束本轮",
          "k": "ok"
        },
        {
          "t": "不存在：递名册",
          "s": "reportToModel 回喂",
          "k": "warn"
        },
        {
          "t": "参数错：喂报错",
          "s": "reportToModel 回喂",
          "k": "warn"
        },
        {
          "t": "工具异常：等 100ms",
          "s": "retry 再调一次",
          "k": "warn"
        },
        {
          "t": "重试仍失败",
          "s": "打印第二次错误",
          "k": "warn"
        },
        {
          "t": "模型据此再决策",
          "s": "换名或补参数",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "classifyFailure 靠 error.startsWith 字符串匹配，是教学简化；真身用稳定的 code，文案一改就失效。",
      "重试的前提是幂等：查天气重试没代价，给用户转账重试就是转两笔。",
      "异步等待会打乱输出顺序：四轮 setTimeout 得排成 50/150/400/700，否则重试结果会插进别的轮次。"
    ],
    "analogy": {
      "scene": "追剧",
      "title": "追剧出问题的三种错",
      "lines": [
        [
          "剧名打错搜不到",
          "工具不存在，模型的错"
        ],
        [
          "选集参数填错",
          "参数不合法，模型的错"
        ],
        [
          "平台自己崩了",
          "工具异常，工具的错"
        ],
        [
          "前两种把原因告诉点剧的人",
          "reportToModel 回喂错误"
        ],
        [
          "平台崩了才值得再点一次",
          "retry 只对幂等调用"
        ]
      ]
    }
  },
  {
    "num": 14,
    "slug": "14-session-log",
    "title": "session log：把发生过的事写进磁盘",
    "oneLiner": "把每一步 append 进 JSONL，留下唯一事实来源",
    "problem": "第 12 课的 loop 跑完什么都不留：屏幕上的字打印完就没了，进程一退全部蒸发。",
    "gives": "会定义 SessionLine 判别联合、append-only 落盘，并在启动时读回、让 seq 接着编。",
    "nextUses": "第 15 课从这条日志 fold 出模型请求；第 16、17 课的压缩与恢复都靠日志一行不改。",
    "dsh": [
      {
        "path": "packages/core/session/src/types.ts",
        "what": "定义 SessionEvent、SessionEventMap 与 ignorable 标记。"
      },
      {
        "path": "packages/session/session-persistence-jsonl",
        "what": "JSONL 持久化后端，zstd、分代文件名与原子替换都在这里。"
      }
    ],
    "concepts": [
      {
        "term": "append-only",
        "plain": "只往文件末尾追加，没有任何代码路径会修改或删除已经写下的行。"
      },
      {
        "term": "SessionLine",
        "plain": "映射类型批量生成的判别联合：seq、time、type、data，type 与 data 类型锁死。"
      },
      {
        "term": "surfaceOp",
        "plain": "标记这条记录怎么进模型可见历史，默认 'append'，压缩时用 replace。"
      },
      {
        "term": "头行",
        "plain": "文件第一行 { type:'session', version:1 }，不记录事件，只说明格式。"
      }
    ],
    "flow": {
      "title": "一轮对话落成日志",
      "kind": "chain",
      "nodes": [
        {
          "t": "loop 跑完一轮",
          "s": "用户、模型、工具都发生",
          "k": "in"
        },
        {
          "t": "ctx.session.append",
          "s": "一条记录一个 type",
          "k": "step"
        },
        {
          "t": "toLine 拼 seq/time",
          "s": "JSON.stringify 成一行",
          "k": "step"
        },
        {
          "t": "appendFileSync 落盘",
          "s": "只加字节，不改旧行",
          "k": "step"
        },
        {
          "t": "重放 list()",
          "s": "按 seq 升序打印",
          "k": "step"
        },
        {
          "t": "重启读回文件",
          "s": "seq 从最后一行接着编",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "tool/call 的 arguments 存模型吐出的原始 JSON 字符串，不存解析后的对象——日志记事实，不记解释。",
      "漏记一条 user/message，重放时会出现“没有提问却调用了工具”，整段对话讲不通。",
      "tool/call 那行没有 surfaceOp 字段，它不进模型可见历史；别以为所有行都带。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "只增不删的恋爱日记",
      "lines": [
        [
          "每天发生什么都写一行",
          "append 一条 SessionLine"
        ],
        [
          "写下的字不许涂改",
          "append-only，旧行永不改写"
        ],
        [
          "翻日记看全部经过",
          "list() 给人复盘"
        ],
        [
          "日记本第一页写格式",
          "头行 type 加 version"
        ],
        [
          "换本子也不撕旧本",
          "格式升级起新分代文件"
        ]
      ]
    }
  },
  {
    "num": 15,
    "slug": "15-fold-messages",
    "title": "从日志折出模型看得见的历史",
    "oneLiner": "让 deriveMessages 从日志现折出请求，模型不再失忆",
    "problem": "日志写好了，但每轮请求仍只带当前一句，模型被问“刚才说过什么”真的一无所知。",
    "gives": "会区分 list() 与 deriveMessages()，按 surfaceOp 从日志折叠出模型可见消息。",
    "nextUses": "第 16 课用它的 replace 分支压缩历史；第 17 课启动时打印这份折叠结果；第 18 课让它带上 system。",
    "dsh": [
      {
        "path": "packages/core/session/src/index.ts",
        "what": "实现 deriveMessages()，每次请求前从日志重新折一遍。"
      },
      {
        "path": "packages/core/session/src/surface.ts",
        "what": "折叠并遮蔽被替换范围的 surface 逻辑。"
      }
    ],
    "concepts": [
      {
        "term": "deriveMessages",
        "plain": "每次请求前从日志现场折出模型可见消息，不另外存一份。"
      },
      {
        "term": "SurfaceRecordType",
        "plain": "能进模型历史的三种类型：user/message、assistant/message、tool/result。"
      },
      {
        "term": "never",
        "plain": "tool/call 的 surfaceOp 类型是 never，给它传值会直接编译报错。"
      },
      {
        "term": "list()",
        "plain": "日志全量，给人看，包含 tool/call 和失败记录。"
      }
    ],
    "flow": {
      "title": "日志折叠成请求",
      "kind": "chain",
      "nodes": [
        {
          "t": "请求前读 records",
          "s": "日志全量不动",
          "k": "in"
        },
        {
          "t": "surfaceOp undefined",
          "s": "tool/call 等直接跳过",
          "k": "step"
        },
        {
          "t": "append 加入 surface",
          "s": "三种消息按序入列",
          "k": "step"
        },
        {
          "t": "replace 挖旧段",
          "s": "本课还不触发",
          "k": "step"
        },
        {
          "t": "toChatMessage 转换",
          "s": "得到 ChatMessage[]",
          "k": "step"
        },
        {
          "t": "请求带 7 条历史",
          "s": "日志 8 条，差 tool/call",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "日志 8 条、模型看见 7 条，差的就是 tool/call——它已被同轮 assistant/message 代表，再塞回去等于说两遍。",
      "拿 deriveMessages() 当人类看的对话记录是错的：它故意遮住被 replace 掉的范围。",
      "给 toLine 的 tool/call 分支加上 surfaceOp 会编译报错——never 不接受任何值。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "战斗日志与队友简报",
      "lines": [
        [
          "服务器战斗日志",
          "session log 全量记录"
        ],
        [
          "给队友的当前简报",
          "deriveMessages 折出的请求"
        ],
        [
          "内部指令不进简报",
          "tool/call 被跳过"
        ],
        [
          "同一动作只播报一次",
          "assistant/message 已代表调用"
        ],
        [
          "简报随战局重算",
          "每次请求前重新 fold"
        ]
      ]
    }
  },
  {
    "num": 16,
    "slug": "16-compaction",
    "title": "压缩：让历史变短，日志不变",
    "oneLiner": "append 一条带 replace 的摘要，请求变短而日志不动",
    "problem": "历史只增不减，每次请求都重带全量，迟早撞上模型的上下文窗口。",
    "gives": "会用 append 加 replace 把一段历史折成摘要，让日志增长而模型历史缩短。",
    "nextUses": "第 17 课重启后压缩仍然生效，靠的正是被顶掉的行还在文件里；第 18 课用同一招替换提示词版本。",
    "dsh": [
      {
        "path": "packages/compaction/compaction-basic",
        "what": "真身由 token-meter 驱动的压缩策略与 LLM 摘要后端。"
      },
      {
        "path": "packages/core/session/src/surface.ts",
        "what": "折叠时遮蔽被替换范围，让 replace 只影响模型可见面。"
      }
    ],
    "concepts": [
      {
        "term": "replace",
        "plain": "SurfaceOp 的第二种取值 { op:'replace', startSeq, endSeq }，顶掉一段旧行。"
      },
      {
        "term": "摘要",
        "plain": "把被压掉的对话写成一条 assistant/message，作为新的历史起点。"
      },
      {
        "term": "精度换空间",
        "plain": "摘要写多细模型就记得多清楚，压太狠会把刚发生的事也糊掉。"
      },
      {
        "term": "长度监控",
        "plain": "measure() 统计每次请求的条数，真系统里换成 token 数并触发 compaction。"
      }
    ],
    "flow": {
      "title": "压缩只动模型可见面",
      "kind": "chain",
      "nodes": [
        {
          "t": "emit agent/compact",
          "s": "指定 #1~#6 与摘要",
          "k": "in"
        },
        {
          "t": "compact 调 append",
          "s": "带 replace 标记",
          "k": "step"
        },
        {
          "t": "日志多出 #7",
          "s": "摘要落成新行",
          "k": "step"
        },
        {
          "t": "折叠遇 replace",
          "s": "挖掉 #1~#6 换成 #7",
          "k": "step"
        },
        {
          "t": "日志 9 条",
          "s": "旧行一条没少",
          "k": "ok"
        },
        {
          "t": "模型历史 3 条",
          "s": "请求变短了",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "压缩不是 delete 也不是 update，而是 append 一条新记录；旧行仍在文件里，只是不再进请求。",
      "fromSeq 写错（比如 1 改成 3）时 findIndex 找不到，折叠直接 continue——摘要落了但什么都没顶掉。",
      "摘要的详细程度是唯一旋钮：没写“提醒带伞”，模型就想不起这回事。"
    ],
    "analogy": {
      "scene": "追剧",
      "title": "新一集的前情提要",
      "lines": [
        [
          "完整剧集片源",
          "append-only 的日志"
        ],
        [
          "开头 30 秒前情提要",
          "append 一条摘要"
        ],
        [
          "提要顶掉前几集",
          "replace #1~#6"
        ],
        [
          "原片一帧没删",
          "旧行仍在文件里"
        ],
        [
          "新观众只看提要",
          "模型历史只剩摘要"
        ]
      ]
    }
  },
  {
    "num": 17,
    "slug": "17-resume-session",
    "title": "断线重连：从磁盘恢复一个会话",
    "oneLiner": "用头行和格式版本核对旧日志，再接上 seq 续聊",
    "problem": "第 14 课“文件存在就整份读进来”不知道读的是什么；字段一变就带着 undefined 静默算错。",
    "gives": "会给日志加头行、核对版本、拒绝不匹配文件，并用 restoredCount 分出新起与恢复两条路。",
    "nextUses": "第 18 课在恢复路径上继续加 system/message；第三篇的 Session.fromRestore 与 seed 是它的完整版。",
    "dsh": [
      {
        "path": "packages/session/session-persistence-jsonl/src/format.ts",
        "what": "定义 HeaderLine，真身头行同样是 type:'session'。"
      },
      {
        "path": "packages/core/session/src/index.ts",
        "what": "Session.fromRestore() 接管一份 seed，恢复成活着的会话。"
      }
    ],
    "concepts": [
      {
        "term": "头行",
        "plain": "文件第一行 { type:'session', version:1 }，只说明格式，没有 seq 和 time。"
      },
      {
        "term": "SESSION_FORMAT_VERSION",
        "plain": "本课的格式版本是 1；真身是 4，文件名也带 v4。"
      },
      {
        "term": "类型谓词",
        "plain": "function isSessionLine(x): x is SessionLine，让 filter 的结果自动收窄。"
      },
      {
        "term": "restoredCount",
        "plain": "Session 上的抽象成员，告诉启动逻辑磁盘上已有几条记录。"
      }
    ],
    "flow": {
      "title": "启动时的两条路",
      "kind": "split",
      "nodes": [
        {
          "t": "构造 JsonlSession",
          "s": "先看文件在不在",
          "k": "in"
        },
        {
          "t": "有文件：load",
          "s": "读 JSON 行",
          "k": "step"
        },
        {
          "t": "核对头行与版本",
          "s": "两处 throw",
          "k": "step"
        },
        {
          "t": "不匹配：拒绝加载",
          "s": "启动即崩",
          "k": "warn"
        },
        {
          "t": "匹配：填 records",
          "s": "seq 接着最后一行",
          "k": "ok"
        },
        {
          "t": "没文件：写头行",
          "s": "restoredCount = 0",
          "k": "step"
        },
        {
          "t": "分出新起与恢复",
          "s": "两条路问的问题不同",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "把 SESSION_FORMAT_VERSION 从 1 改成 2 再跑，程序连 apply 都没进去就崩——这是设计，不是 bug。",
      "恢复路径不要再重放 agent/compact：历史已经压过，再折一次没意义。",
      "删掉头行后报错是“第一行必须是头行，实际是 user/message”，报错信息要能指向原因。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "异地续聊先确认对象",
      "lines": [
        [
          "翻开聊天记录接着聊",
          "启动时读回日志"
        ],
        [
          "先确认这是和谁的聊天",
          "头行加版本核对"
        ],
        [
          "对不上号就不硬聊",
          "版本不符直接抛错"
        ],
        [
          "上次聊到第几条记着",
          "seq 接着 #7 往下编"
        ],
        [
          "这次是新人还是旧人",
          "restoredCount 分两条路"
        ]
      ]
    }
  },
  {
    "num": 18,
    "slug": "18-system-prompt",
    "title": "system prompt：谁在给模型下指令",
    "oneLiner": "把提示词做成有序段落注册表，可组装可中途替换",
    "problem": "写死一个 SYSTEM 常量装不下工具清单、人设切换和固定顺序这三个需求。",
    "gives": "会写 SystemPrompt 服务的 section/assemble/renderTools，并用 replace 记录提示词变更。",
    "nextUses": "第三篇的 agent loop 每个 step 都调 assemble()；第 16 课的 replace 在这里第二次服役。",
    "dsh": [
      {
        "path": "packages/core/system-prompt/src/index.ts",
        "what": "真身的 SECTION_ORDERS 表与提示词组装，把各段钉死在固定槽位。"
      }
    ],
    "concepts": [
      {
        "term": "section()",
        "plain": "注册一段提示词，带 name、order、text、complete，返回摘除函数。"
      },
      {
        "term": "assemble()",
        "plain": "每轮请求前按 order 排序、过滤空文本、拼成完整提示词。"
      },
      {
        "term": "complete",
        "plain": "为 true 时这一段独占全部提示词；多段同时标 complete 直接抛错。"
      },
      {
        "term": "sortSystemFirst",
        "plain": "折叠后把 system 消息提到最前，因为模型要求先指令后对话。"
      }
    ],
    "flow": {
      "title": "提示词的注册与组装",
      "kind": "chain",
      "nodes": [
        {
          "t": "各插件 section",
          "s": "identity/persona/tools",
          "k": "in"
        },
        {
          "t": "assemble 按 order 排",
          "s": "-1000 / 0 / 1000",
          "k": "step"
        },
        {
          "t": "text 函数现算清单",
          "s": "拿到此刻全部工具",
          "k": "step"
        },
        {
          "t": "append system/message",
          "s": "变了才记并 replace 旧版",
          "k": "step"
        },
        {
          "t": "deriveMessages 折叠",
          "s": "sortSystemFirst 提前",
          "k": "step"
        },
        {
          "t": "请求带 system 前缀",
          "s": "模型行为跟着变",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "工具清单段必须写成 text: () => ... 函数形式：工具是别的插件后来注册的，agent 早就 apply 完了。",
      "提示词变了要记，但折完必须 sortSystemFirst，否则 system 行插在对话中间把历史劈成两半。",
      "两段同时标 complete: true 会启动即崩：两个都说自己是全部，这不是投票能解决的事。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "开局前给角色的设定集",
      "lines": [
        [
          "设定集分身份/人格/技能页",
          "section 注册的段落"
        ],
        [
          "每页钉死固定槽位",
          "SECTION_ORDER 的 order"
        ],
        [
          "技能页随时更新",
          "text 用函数现算工具清单"
        ],
        [
          "临时改人设只换一页",
          "摘掉旧 section 注册新的"
        ],
        [
          "两页都写我才是全部就崩",
          "多段 complete 直接抛错"
        ]
      ]
    }
  },
  {
    "num": 19,
    "slug": "19-tool-registry",
    "title": "工具注册表：让插件自己把工具递上来",
    "oneLiner": "让工具变成插件，自己注册进注册表",
    "problem": "工具写死在 weather.ts，想加第二个就得改 main.ts；注册表也还没有模型侧投影和变更广播。",
    "gives": "任何插件只要在 apply 里一次 ctx.tools.register(defineTool(...))，工具就能被模型选中，主循环一行不改。",
    "nextUses": "第 20 课继续用这两个工具演示能力缺失后的静默消失；第 23 课的 ctx.tools.call() 正是查这张注册表，名字对不上就返回 ok:false。",
    "dsh": [
      {
        "path": "packages/core/tools/src/index.ts",
        "what": "工具注册表真身：schemas() 把定义白名单投影给模型，tools/change 广播变更，register() 还校验 output、timeoutMs 和保留名 run_code。"
      },
      {
        "path": "packages/web/tool-web/src/search.ts",
        "what": "web_search 工具的实现，插件在 apply 里一次 ctx.tools.register(defineTool({...})) 把它递上来。"
      }
    ],
    "concepts": [
      {
        "term": "ToolDefinition",
        "plain": "描述一个工具的普通对象，含 name、description、parameters 和 execute；execute 是本地函数，只留在进程里。"
      },
      {
        "term": "schemas()",
        "plain": "把注册表里每个定义投影成只含 name、description、parameters 的数组发给模型，execute 不在其中。"
      },
      {
        "term": "tools/change",
        "plain": "注册表注册或摘除工具时 emit 的事件，监听它就能知道当前有哪些工具，不需要认识是谁注册的。"
      },
      {
        "term": "依赖拓扑加载",
        "plain": "插件加载顺序由 inject 依赖决定，不由 cordis.yml 的书写顺序决定，所以 agent 的 apply 执行时注册表可能还是空的。"
      },
      {
        "term": "register 的撤销",
        "plain": "register() 用 ctx.effect 包住写入 Map，返回的清理函数在插件卸载时删掉工具并再广播一次 tools/change。"
      }
    ],
    "flow": {
      "title": "工具从插件到模型请求的链路",
      "kind": "chain",
      "nodes": [
        {
          "t": "插件 apply",
          "s": "calc.ts 在 apply 里注册",
          "k": "in"
        },
        {
          "t": "写入注册表",
          "s": "写进 Map 后广播",
          "k": "step"
        },
        {
          "t": "监听变更",
          "s": "main 只排一次打印",
          "k": "step"
        },
        {
          "t": "schemas()",
          "s": "白名单投影三个字段",
          "k": "step"
        },
        {
          "t": "模型选工具",
          "s": "按 name 指名调用",
          "k": "step"
        },
        {
          "t": "本地执行",
          "s": "execute 跑完结果进日志",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "在 apply 函数体里直接打印工具清单只会看到空表，因为 agent 的 apply 先于 weather-tool 和 calc-tool 执行。",
      "把假模型「要算数」的分支写成 input.includes('*')，工具结果 7 * 6 = 42 会再次触发它，那一轮静默丢空。",
      "教学版 register() 不查重名，两个同名插件会让 Map 静默覆盖；真身第一道校验就是重名抛 TypeError。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "公会招募板",
      "lines": [
        [
          "公会招募板",
          "工具注册表"
        ],
        [
          "玩家自己贴招募帖",
          "插件在 apply 里 register"
        ],
        [
          "帖子只写职业和要求",
          "schemas() 只放三个字段"
        ],
        [
          "团长按名字点名",
          "模型按 name 选工具"
        ],
        [
          "有人退会就撤帖",
          "摘除后也 emit tools/change"
        ]
      ]
    }
  },
  {
    "num": 20,
    "slug": "20-capability-negotiation",
    "title": "能力协商：缺什么，启动时就炸",
    "oneLiner": "启动时对账：inject 要的服务齐不齐",
    "problem": "yml 漏一行时 agent 停在 PENDING，apply 从未执行，进程安静退出、退出码 0，功能少一块也没人说。",
    "gives": "inject 让 cordis 排顺序并建需求表，reportCapabilities() 在启动时拿需求表和服务名册对一次账。",
    "nextUses": "第 21 课的目录加载器仍按 inject 拓扑串行 create；第 26 课能取到 ctx.session，也是因为 session 早早写进了 inject。",
    "dsh": [
      {
        "path": "packages/boot/plugin-manager",
        "what": "插件管理器：测试夹具里声明了不存在的服务、apply 为空的插件被判成 application: failed，说明 PENDING 在真身也算失败。"
      }
    ],
    "concepts": [
      {
        "term": "inject",
        "plain": "插件模块导出的一行字符串数组，声明 apply 会用到哪些服务；cordis 用它排加载顺序，并建成 fiber.inject 需求表。"
      },
      {
        "term": "PENDING",
        "plain": "声明了 inject 但没人提供该服务时，fiber 停在 PENDING，apply 从头到尾不执行，只有 launcher 一句提示，退出码 0。"
      },
      {
        "term": "FAILED",
        "plain": "没声明 inject 却访问 ctx.tools 时，cordis 的反射代理直接抛 cannot get property ... without inject，插件变 FAILED，退出码 1。"
      },
      {
        "term": "能力对账",
        "plain": "拿 ctx.fiber.inject（我声明要的）减 ctx.reflect.props（全应用登记过的），缺谁一目了然；读名册不读 store，因为服务可以先登记后注册。"
      },
      {
        "term": "Inject.resolve",
        "plain": "把数组、对象、带原型标记的类三种 inject 写法归一化成同一张 name 到配置的表，cordis.yml 的 entry 级 inject 也汇进这张表。"
      }
    ],
    "flow": {
      "title": "能力协商与 fiber 状态判定",
      "kind": "split",
      "nodes": [
        {
          "t": "声明 inject",
          "s": "插件导出要的三个服务",
          "k": "in"
        },
        {
          "t": "建需求表",
          "s": "建一张 inject 需求表",
          "k": "step"
        },
        {
          "t": "服务有人提供",
          "s": "fiber 转 ACTIVE",
          "k": "ok"
        },
        {
          "t": "服务没人提供",
          "s": "fiber 停 PENDING，不执行",
          "k": "warn"
        },
        {
          "t": "忘记声明",
          "s": "访问 ctx.X 抛错变 FAILED",
          "k": "warn"
        },
        {
          "t": "启动对账",
          "s": "ACTIVE 后对需求表和名册",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "PENDING 不报错也不置退出码，插件只是安静地不存在——所以你排查「它为什么不理我」时第一眼看不出问题。",
      "对账别读 store 要读 props：tools 是先登记后注册，apply 执行时实例可能还没上架，缺名字才是真缺。",
      "yml 里文件名写错会在加载阶段抛 ERR_MODULE_NOT_FOUND，故障还会沿依赖链把整个 provider 组拖成 PENDING。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "见家长前的家底对账",
      "lines": [
        [
          "先说自己图什么",
          "插件导出 inject 需求表"
        ],
        [
          "对方家里有没有这人",
          "cordis 查服务有没有人提供"
        ],
        [
          "人没到就别安排见面",
          "服务不齐就 PENDING"
        ],
        [
          "没打招呼就翻抽屉",
          "没写 inject 访问 ctx 直接抛错"
        ],
        [
          "坐下对一遍清单",
          "reportCapabilities 对账"
        ]
      ]
    }
  },
  {
    "num": 21,
    "slug": "21-directory-as-plugin",
    "title": "目录即插件：一个文件夹就是一个插件",
    "oneLiner": "yml 只写目录，manifest 列谁是插件",
    "problem": "六行 yml 记住了每个插件文件名，加工具、拆模块都得回头改入口清单，实现细节混进了配置。",
    "gives": "plugin-directory.ts 读 manifest.ts 逐个 ctx.loader.create()，六行 yml 收成两行，跑出来逐字不变。",
    "nextUses": "从第 22 课起 yml 固定两行，新增插件只改 manifest.ts 的 plugins 数组；第 27 课的 real-provider.ts 就是这么进加载清单的。",
    "dsh": [
      {
        "path": "packages/*/package.json",
        "what": "每个包用 exports 自己声明是不是插件，真身 50 多个目录从不靠扫描发现插件。"
      }
    ],
    "concepts": [
      {
        "term": "manifest.ts",
        "plain": "一个普通模块，default 导出 { purpose, plugins }，plugins 是字符串数组，列出这个目录里哪些文件是插件。"
      },
      {
        "term": "ctx.loader.create",
        "plain": "loader 的建条目方法，传 { name } 就 import 模块、unwrap exports、注册插件；yml 里 - name: 那一行底层就是它。"
      },
      {
        "term": "[Service.init]",
        "plain": "类插件上的生成器钩子：先 yield 出卸载回调完成登记，yield 之后的代码等 fiber 激活后才跑，这时才取得到刚登记的服务。"
      },
      {
        "term": "ctx.reflect.get",
        "plain": "直接查实例表的取值方式，第二个参数 false 表示取不到就返回空而不是抛错；apply 里只能用它，不能用 ctx.pluginDirectory。"
      },
      {
        "term": "串行 await",
        "plain": "load() 里逐个 await loader.create，不写 Promise.all，因为加载顺序有意义，并行会让依赖拓扑变成运气。"
      }
    ],
    "flow": {
      "title": "目录到插件实例的加载链",
      "kind": "chain",
      "nodes": [
        {
          "t": "yml 声明目录",
          "s": "只写 root: '.'",
          "k": "in"
        },
        {
          "t": "登记服务",
          "s": "ctx.plugin 登记服务",
          "k": "step"
        },
        {
          "t": "等激活",
          "s": "yield 后才跑 load",
          "k": "step"
        },
        {
          "t": "读清单",
          "s": "读 default.plugins",
          "k": "step"
        },
        {
          "t": "串行 create",
          "s": "逐个 ctx.loader.create",
          "k": "step"
        },
        {
          "t": "广播 loaded",
          "s": "emit 一个 loaded 事件",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "在 apply 里直接 await ctx.pluginDirectory.load()：服务刚登记还没 ACTIVE，反射层当场抛 without inject。",
      "改成 readdirSync 扫描会把 llm.ts、tools.ts 这些没有 apply 的库文件当插件递给 loader，报 invalid plugin。",
      "manifest 里写错文件名只在 loader.create 处报 ERR_MODULE_NOT_FOUND，程序继续跑完、退出码 0，不会 FAILED。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "开黑只认名单",
      "lines": [
        [
          "只喊进这个房间",
          "yml 只写目录 root"
        ],
        [
          "墙上贴着参战名单",
          "manifest.ts 列 plugins"
        ],
        [
          "照名单一个个拉人",
          "串行 ctx.loader.create"
        ],
        [
          "按顺序拉别乱序",
          "保住依赖拓扑顺序"
        ],
        [
          "拉完群里报人数",
          "emit 一个 loaded 事件"
        ]
      ]
    }
  },
  {
    "num": 22,
    "slug": "22-streaming-loop",
    "title": "流式 loop：让字一个个蹦出来",
    "oneLiner": "把 collect 换成 stream，收到一片打一片",
    "problem": "模型整段说完才显示，等待期间屏幕是死的；假模型的流没有 await，所有片在同一个 tick 吐完。",
    "gives": "stream() 边收边打、标签在第一片正文时打，并用串行 await 修掉三个 setTimeout 撞车。",
    "nextUses": "第 25 课的摘要请求直接复用这个 stream()，摘要正文也一片片打出来；第 27 课的 SSE 解析最终产出同一种 StreamChunk。",
    "dsh": [
      {
        "path": "packages/llm/llm/src/assistant-stream.ts",
        "what": "AssistantStreamRecord 把每片 delta 连 time0 和 dt 时间戳存进 durable 事件，流式节奏可以回放。"
      },
      {
        "path": "packages/llm/llm/src/types.ts",
        "what": "block index 关联交错的 delta，block-end 携带拼装好的完整块，一套协议同时服务两种消费方式。"
      }
    ],
    "concepts": [
      {
        "term": "StreamChunk",
        "plain": "流式分片的七种类型：block-start、text-delta、reasoning-delta、tool-call-delta、block-end、usage、finish。"
      },
      {
        "term": "消费时机",
        "plain": "collect() 和 stream() 用同一个 for await，区别只在收到 text-delta 时是攒着还是立刻 write 到屏幕。"
      },
      {
        "term": "process.stdout.write",
        "plain": "不带换行的输出；流式必须用它，因为 console.log 每片自带换行，一句话会被拆成几十行。"
      },
      {
        "term": "wroteText",
        "plain": "一个布尔标志，既标记 [模型回答] 标签是否打过，也决定结尾要不要补换行；工具调用轮它保持 false。"
      },
      {
        "term": "await sleep",
        "plain": "每片之前 await 一次 sleep，把控制权交回事件循环；没有 await 的连续 yield 会在同一个 tick 里全部吐完。"
      }
    ],
    "flow": {
      "title": "一片 delta 从流到屏幕",
      "kind": "chain",
      "nodes": [
        {
          "t": "发起请求",
          "s": "调 ctx.llm.stream",
          "k": "in"
        },
        {
          "t": "收到 delta",
          "s": "text-delta 拼进 texts",
          "k": "step"
        },
        {
          "t": "打标签",
          "s": "第一片前 write 标签",
          "k": "step"
        },
        {
          "t": "逐片输出",
          "s": "stdout.write 不换行",
          "k": "step"
        },
        {
          "t": "收块",
          "s": "tool-call 直接 return",
          "k": "step"
        },
        {
          "t": "产出结果",
          "s": "拼好的完整 text 进日志",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "删掉 mock 里的 await sleep，所有正确性指标一个不变，只是字不再一片片到——流式是体验，不是功能。",
      "把 [模型回答] 标签挪回 run() 事后补，同一句话会在同一行出现两次：一次逐字，一次整块。",
      "三轮对话仍用 50ms 间隔的 setTimeout，一轮变慢后并发写同一条记录，seq 撞车、摘要落成 #4。"
    ],
    "analogy": {
      "scene": "追剧",
      "title": "追剧要一集集追",
      "lines": [
        [
          "等全剧完结再一次性看",
          "collect() 攒完整块才打印"
        ],
        [
          "更新一集看一集",
          "stream() 收一片打一片"
        ],
        [
          "片头字幕先打出来",
          "第一片正文前打标签"
        ],
        [
          "每集之间要等更新",
          "await sleep(60) 让出事件循环"
        ],
        [
          "三集同时播会串台",
          "改成串行 await 再下一轮"
        ]
      ]
    }
  },
  {
    "num": 23,
    "slug": "23-error-recovery",
    "title": "错误恢复：失败也是一次结果",
    "oneLiner": "工具失败也回喂模型，并给恢复加三道边界",
    "problem": "工具失败只打一行 [工具失败]，模型一个字没看见，下一轮照样重复同一个错；报错还只描述症状，模型学不会。",
    "gives": "isError 的失败结果折进历史再问模型一次，再用超时、重复检测、重试深度三条边界兜住递归。",
    "nextUses": "第 24 课把工具追问和恢复追问都纳入 token 预算，第 26 课在每次追问前加 ctx.session.flush() 落盘关卡。",
    "dsh": [
      {
        "path": "packages/guard/timeout-policy/src/index.ts",
        "what": "挂在 tools/execute waterfall 上，next() 前后替换 exec.signal，只有自己的 timer 到点才换成结构化的 TOOL_TIMEOUT。"
      },
      {
        "path": "packages/guard/repeat-tool-reminder/src/index.ts",
        "what": "挂在 tools/post-execute 上，深排序 JSON 后数重复调用，按 [3, 5, 8] 阈值折进 additionalContexts 提醒。"
      }
    ],
    "concepts": [
      {
        "term": "失败回喂",
        "plain": "工具失败时把 isError 的 tool/result 折进历史再问模型一次，模型看见失败才有机会补参数或换办法。"
      },
      {
        "term": "可学的报错",
        "plain": "报错指认缺什么（$.op 是必填项，但没有提供），而不是描述症状（不支持的运算符：undefined），前者模型照着就能改。"
      },
      {
        "term": "三道边界",
        "plain": "TOOL_TIMEOUT_MS 500 毫秒、REPEAT_THRESHOLD 3 次、MAX_RECOVERY_DEPTH 2 层，分别管工具不撒手、模型不换招、恢复不肯停。"
      },
      {
        "term": "notice/message",
        "plain": "agent loop 写给自己的旁白记录，没有 surfaceOp，进日志但不进模型请求。"
      },
      {
        "term": "AbortController",
        "plain": "把到点这件事变成可传递的信号，setTimeout 触发 abort()，工具侧检查 signal?.aborted；finally 里必须 clearTimeout。"
      }
    ],
    "flow": {
      "title": "失败之后的恢复与三道边界",
      "kind": "split",
      "nodes": [
        {
          "t": "工具失败",
          "s": "call 返回 ok:false",
          "k": "in"
        },
        {
          "t": "记 isError",
          "s": "失败结果进日志 #7",
          "k": "step"
        },
        {
          "t": "再问模型",
          "s": "deriveMessages 含失败",
          "k": "step"
        },
        {
          "t": "补参数重试",
          "s": "递归 depth + 1",
          "k": "ok"
        },
        {
          "t": "撞边界收手",
          "s": "超时/重复/超深写旁白",
          "k": "warn"
        }
      ]
    },
    "pitfalls": [
      "只 append isError 不再问模型，日志停在 #7，模型下一轮照样重复同一个漏参数的调用。",
      "calc 的 op 去掉 required: true，校验器放行，失败退化成「不支持的运算符：undefined」，模型只能猜。",
      "finally 忘了 clearTimeout，每次调用都留下一个 500ms 后触发的僵尸 timer。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "吵完要复盘别冷战",
      "lines": [
        [
          "吵完当没发生过",
          "失败只打日志不再问模型"
        ],
        [
          "把话摊开说清哪里不对",
          "isError 结果折进历史"
        ],
        [
          "只说你不懂我",
          "报错描述症状，学不会"
        ],
        [
          "说清你没回我消息",
          "报错指认缺失字段"
        ],
        [
          "别翻旧账到天亮",
          "MAX_RECOVERY_DEPTH 收手"
        ]
      ]
    }
  },
  {
    "num": 24,
    "slug": "24-context-budget",
    "title": "上下文预算：每一次 deriveMessages() 都是一次花钱的决定",
    "oneLiner": "给每次请求算 token，超阈值就自动折一段",
    "problem": "日志 append-only 一直长，模型窗口却有限；照单全收的 loop 要么被 CONTEXT_WINDOW_EXCEEDED 拒，要么被悄悄截断。",
    "gives": "token-meter 估价加 320/0.8/40 三段公式，compactIfNeeded 按预算自动选段，从人肉 compact 变成算出来的触发。",
    "nextUses": "第 25 课把写死的 buildSummary 换成模型自己写，触发条件仍是这里的 256 阈值；第 27 课给这行预算加上系统提示 17 token。",
    "dsh": [
      {
        "path": "packages/llm/token-meter/src/estimate.ts",
        "what": "4 字符/token、块 4、角色 4 的估价启发式，外加 provider anchor 用真实 usage 校正。"
      },
      {
        "path": "packages/compaction/compaction-basic/src/region.ts",
        "what": "selectCompactableRange 决定折哪一段：尾部累加到 retain、从 #1 起折、只折进过请求的行。"
      }
    ],
    "concepts": [
      {
        "term": "FixedTokenMeter",
        "plain": "TokenMeter 的实现，estimateMessage 用 CHARS_PER_TOKEN=4、BLOCK_OVERHEAD=4、ROLE_OVERHEAD=4 估一条消息值多少 token。"
      },
      {
        "term": "工具清单成本",
        "plain": "ctx.tools.schemas() 序列化后的 JSON Schema 每轮都随请求发，两个工具 153 token，压不掉也省不了。"
      },
      {
        "term": "阈值公式",
        "plain": "thresholdTokens = floor(contextWindow × thresholdRatio)，320 × 0.8 = 256，留出 20% 给回答和估算误差。"
      },
      {
        "term": "RETAIN_TOKENS",
        "plain": "压缩时原样保留的最近 token 数（40）；当前这一轮必须留在上下文里，保不住就整个收手。"
      },
      {
        "term": "surfaceOp 过滤",
        "plain": "只折 surfaceOp !== undefined 的行；notice/message 和 tool/call 从没进过请求，折了会让 compact 的 endSeq 找不到落点。"
      },
      {
        "term": "先折再量后问",
        "plain": "run() 里 deriveMessages 后 compactIfNeeded 原地改写 options.messages，再 measureRequest，最后 stream，预算永远基于真正要发的那份 messages。"
      }
    ],
    "flow": {
      "title": "预算触发的自动压缩",
      "kind": "split",
      "nodes": [
        {
          "t": "折出请求",
          "s": "deriveMessages 折历史",
          "k": "in"
        },
        {
          "t": "量预算",
          "s": "measure 含工具清单 153",
          "k": "step"
        },
        {
          "t": "算阈值",
          "s": "floor(320×0.8)=256",
          "k": "step"
        },
        {
          "t": "未超阈值",
          "s": "直接 stream，不折",
          "k": "ok"
        },
        {
          "t": "超阈值",
          "s": "尾部累加保留 40 token",
          "k": "step"
        },
        {
          "t": "选段压缩",
          "s": "compact(#1, #9) 后再量",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "只数消息不数工具清单，153 token 的固定成本就永远看不见，而它每轮都要重付。",
      "删掉 surfaceOp !== undefined 过滤，endSeq 落在 notice 或 tool/call 上，deriveMessages 找不到落点，压缩静默跳过。",
      "RETAIN_TOKENS 改成 0，连「刚才我问了什么？」这一轮本身也被折掉，模型把自己刚问的问题忘了。"
    ],
    "analogy": {
      "scene": "追剧",
      "title": "手机只缓存最近几集",
      "lines": [
        [
          "每集都存下来",
          "日志 append-only 全带上"
        ],
        [
          "手机存储就那么大",
          "CONTEXT_WINDOW = 320"
        ],
        [
          "剩两成空间才动手",
          "阈值 = 320 × 0.8 = 256"
        ],
        [
          "最近两集留着别删",
          "RETAIN_TOKENS = 40"
        ],
        [
          "片头曲不算集但占地方",
          "工具清单 153 token 每轮重付"
        ]
      ]
    }
  },
  {
    "num": 25,
    "slug": "25-real-compaction",
    "title": "真正的压缩：让模型自己写摘要",
    "oneLiner": "把写死的摘要换成一次模型自己写的摘要请求",
    "problem": "buildSummary 只对本课剧本成立，换一段真实对话就什么都不知道——写死的摘要只能概括写死的剧本。",
    "gives": "summarize() 重放被折的日志行并追一条压缩指令，走同一个 stream()，抽 <summary> 正文落成 checkpoint。",
    "nextUses": "第 26 课用 agent/compact-begin 和 compact-end 给这次摘要请求夹上区间锁，第 27 课让它带上真实的 [压缩账]。",
    "dsh": [
      {
        "path": "packages/compaction/compaction-basic/src/summarizer.ts",
        "what": "把被折对话重新发给模型，用七段式指令和 CHECKPOINT_PREAMBLE 逼出结构化摘要。"
      },
      {
        "path": "packages/compaction/compaction-basic/src/region.ts",
        "what": "compactSurfaceRegion 事务：区间断言，且摘要 token 数不小于被折内容就直接抛错。"
      }
    ],
    "concepts": [
      {
        "term": "summarize()",
        "plain": "按 seq 区间从日志里重放被折的行，末尾追一条压缩指令，走 stream() 让模型写摘要。"
      },
      {
        "term": "COMPACTION_INSTRUCTION",
        "plain": "压缩指令作为最后一条 user 消息，要求按 Markdown 小节输出并包在 <summary> 里；不做 system 是为了不挡 KV cache 前缀。"
      },
      {
        "term": "extractSummary",
        "plain": "取 <summary> 与 </summary> 之间的正文并 trim；标签缺失或顺序不对就抛错，不做宽容兜底。"
      },
      {
        "term": "purpose",
        "plain": "GenerateOptions 上的字段，主对话是 generate，摘要是 compaction；同一根 stream() 管子，账要分开记。"
      },
      {
        "term": "SUMMARY_MAX_TOKENS",
        "plain": "摘要请求单独的输出上限 128，不跟主请求的 maxTokens 走；给太大模型会把每节都写满，折完反而更贵。"
      },
      {
        "term": "重放日志行",
        "plain": "直接 list() 筛 seq 区间和 surfaceOp，而不是用 deriveMessages()，因为要折的是这些行当前的样子。"
      }
    ],
    "flow": {
      "title": "模型自写摘要的压缩流程",
      "kind": "chain",
      "nodes": [
        {
          "t": "超阈值",
          "s": "选中 #1~#9 区间",
          "k": "in"
        },
        {
          "t": "重放日志行",
          "s": "按 seq 区间筛 surfaceOp",
          "k": "step"
        },
        {
          "t": "追压缩指令",
          "s": "最后一条 user 消息",
          "k": "step"
        },
        {
          "t": "走同一 stream",
          "s": "过协议、拼装、判 finish",
          "k": "step"
        },
        {
          "t": "抽标签",
          "s": "extractSummary 取正文",
          "k": "step"
        },
        {
          "t": "落成摘要行",
          "s": "#14 顶掉 #1~#9",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "decide() 里 compaction engine 分支必须放最前，否则指令里的「天气」会被天气分支截走，摘要请求回成工具调用。",
      "extractSummary 做宽容兜底，会把客套话和复述的指令一起塞进历史，而且你查不出是哪一轮开始的。",
      "SUMMARY_MAX_TOKENS 给太大，摘要写满四段反而比被折内容更长——本课只省 8 token，真身在这直接抛错。"
    ],
    "analogy": {
      "scene": "恋爱",
      "title": "分手小结让对方自己写",
      "lines": [
        [
          "你替对方写总结",
          "buildSummary 写死一句话"
        ],
        [
          "只对排练过的剧本有效",
          "换真实对话就失效"
        ],
        [
          "把聊天记录重发一遍",
          "summarize 重放被折日志行"
        ],
        [
          "附一句按格式写",
          "压缩指令作最后 user 消息"
        ],
        [
          "只收信封里的正文",
          "extractSummary 只取标签正文"
        ]
      ]
    }
  },
  {
    "num": 26,
    "slug": "26-session-lifecycle",
    "title": "Session 的一生",
    "oneLiner": "给 session 补上四个生命周期事件",
    "problem": "session 只是被 list() 查询的笔记本，落盘、销毁没有广播，出了事只能事后翻日志。",
    "gives": "created/event/flush/disposed 四个事件、先落盘后广播、flush 关卡、幂等 dispose、单写者与区间锁接线。",
    "nextUses": "第 27 课换真 provider 后这四类事件照旧：请求前 flush、跑完 dispose，入土时本进程仍只写了 3 条记录。",
    "dsh": [
      {
        "path": "packages/core/session/src/index.ts",
        "what": "定义 session/created、session/event、session/flush、session/disposed 四个生命周期事件。"
      },
      {
        "path": "packages/session/session-checkpoint-policy",
        "what": "策略插件，在模型请求构造前和工具 body 执行前 await session/flush，逼日志先落盘。"
      }
    ],
    "concepts": [
      {
        "term": "session/event",
        "plain": "每 append 一行、并且 appendFileSync 已经落盘之后才 emit，监听器看到的每一行都已是既成事实。"
      },
      {
        "term": "session/flush",
        "plain": "唯一 @mode parallel 的生命周期事件，flush() 里用 ctx.parallel 发出，调用方可以选择等所有监听器做完再发请求。"
      },
      {
        "term": "restoredCount",
        "plain": "恢复时读了几条旧记录的字段；session/created 监听不到时，靠它补上「这个会话现在什么状态」。"
      },
      {
        "term": "幂等 dispose",
        "plain": "dispose() 先看 disposed 标志，第二次直接 return；剧本末尾和 ctx.effect 清理钩子两条路都通向它。"
      },
      {
        "term": "Proxy 与私有字段",
        "plain": "ctx.session 是 cordis 的 Proxy，#disposed 这种私有字段在 get 拦截器里读不到，只能用 TypeScript 的 private 普通属性。"
      },
      {
        "term": "单写者",
        "plain": "构造时用 ownedFiles 检查同一个文件是否已被别的 session 持有，防止两个实例交替 appendFileSync 把行从中间劈开。"
      }
    ],
    "flow": {
      "title": "Session 从问世到入土",
      "kind": "split",
      "nodes": [
        {
          "t": "构造",
          "s": "头行已落盘",
          "k": "in"
        },
        {
          "t": "问世",
          "s": "emit session/created",
          "k": "ok"
        },
        {
          "t": "append 一行",
          "s": "先 appendFileSync 落盘",
          "k": "step"
        },
        {
          "t": "落定",
          "s": "session/event 先落盘",
          "k": "step"
        },
        {
          "t": "落盘关卡",
          "s": "flush 用 parallel 发出",
          "k": "step"
        },
        {
          "t": "入土",
          "s": "dispose 后广播",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "用 ctx.root.fiber.dispose() 收尾：根 fiber 一拆监听器先被摘掉，session/disposed 发出来已经没人听，还连累 25 课空跑。",
      "dispose 不幂等会埋两遍：剧本末尾调一次，插件卸载时 ctx.effect 的清理钩子又调一次。",
      "把 append 的 emit 和 appendFileSync 对调，日志看不出变化，但监听器在 session/event 里读到的是半个事实。"
    ],
    "analogy": {
      "scene": "追剧",
      "title": "一个角色的一生",
      "lines": [
        [
          "角色第一次出场",
          "session/created 问世"
        ],
        [
          "演完先录进母带",
          "先落盘再 emit session/event"
        ],
        [
          "关键剧情先存档",
          "session/flush 关卡"
        ],
        [
          "杀青只办一次",
          "dispose 幂等，只 emit 一次"
        ],
        [
          "两剧组抢同一卷母带",
          "单写者 ownedFiles 拦第二个"
        ]
      ]
    }
  },
  {
    "num": 27,
    "slug": "27-real-api",
    "title": "接真 API",
    "oneLiner": "写一个真 provider，接到同一条管子",
    "problem": "mock 的模型是写死的 if，没真网络、真 usage；换 provider 时 /messages 路径、鉴权头、tool_use_id 都得自己弄对。",
    "gives": "real-provider.ts 用 x-api-key、POST /messages、SSE 翻译成 StreamChunk，并按 purpose 分对话账与压缩账。",
    "nextUses": "本课是第三篇收尾，没有下一课：它把前 26 课的工具注册、预算、压缩、生命周期一次性验在真 API 上。",
    "dsh": [
      {
        "path": "packages/llm/llm-deepseek/src/adapter.ts",
        "what": "真身 DeepSeek adapter：用 messagesApiRoot 拼 /messages，按 purpose 加 x-deepseek-harness-compact 请求头。"
      },
      {
        "path": "packages/llm/llm-deepseek/src/translate.ts",
        "what": "SSE 事件状态机：逐事件校验重复 message_start、未闭合块等，最后统一吐 usage。"
      }
    ],
    "concepts": [
      {
        "term": "x-api-key",
        "plain": "DeepSeek Messages 的鉴权请求头；不是 OpenAI 的 Authorization: Bearer，两者不通用，抄错就是 401。"
      },
      {
        "term": "/messages",
        "plain": "要自己拼在 BASE_URL 后面；只往根上 POST 会拿到 404，而且看起来像端点不通。"
      },
      {
        "term": "tool_use_id",
        "plain": "协议里 tool_result 必须带上的 id，值就是日志里 tool/result 的 callId；教学版 27 课之前一直写死 unknown。"
      },
      {
        "term": "空清单不发字段",
        "plain": "tools 或 system 为空时整个字段都不写进请求体，因为 tools: [] 表示有清单但为空，缺字段才是别调工具。"
      },
      {
        "term": "translateSse",
        "plain": "手写 SSE 分帧（data 行、空行分帧），把 message_start、content_block_delta 等事件翻成 StreamChunk，并攒正文、工具身份和 usage。"
      },
      {
        "term": "两条红线",
        "plain": "message_stop 之前流断了必须抛错；工具参数是 input_json_delta 一片片拼出来的，block-end 要的是完整块。"
      }
    ],
    "flow": {
      "title": "真 API 请求到账单的一条链",
      "kind": "chain",
      "nodes": [
        {
          "t": "读 Key",
          "s": "环境变量里的 API Key",
          "k": "in"
        },
        {
          "t": "拼请求体",
          "s": "model + tools 字段",
          "k": "step"
        },
        {
          "t": "翻译消息",
          "s": "tool_result 带 callId",
          "k": "step"
        },
        {
          "t": "发请求",
          "s": "POST /messages 带 key",
          "k": "step"
        },
        {
          "t": "翻译 SSE",
          "s": "攒整块，过两条红线",
          "k": "step"
        },
        {
          "t": "分账落日志",
          "s": "对话账/压缩账 + chunk",
          "k": "out"
        }
      ]
    },
    "pitfalls": [
      "把鉴权写成 Authorization: Bearer，直接 401——DeepSeek 要的是 x-api-key。",
      "tool_use_id 写死 unknown，日志里明明有 call-1，协议那头对不上，报的错还像别的问题。",
      "mock 的工具调用轮账单是 0：usage chunk 排在 block-end 之后，而 stream() 在 block-end 就 return 了。"
    ],
    "analogy": {
      "scene": "游戏",
      "title": "从单机切到跨服",
      "lines": [
        [
          "单机对手是自己写的 if",
          "mock-provider 的 decide()"
        ],
        [
          "换成真服务器地址",
          "BASE_URL 拼上 /messages"
        ],
        [
          "进服刷自己的门禁卡",
          "x-api-key 不是 Bearer"
        ],
        [
          "队友编号要对上",
          "tool_use_id 用 callId"
        ],
        [
          "打完看真实战绩",
          "usage 分对话账/压缩账"
        ]
      ]
    }
  }
]
