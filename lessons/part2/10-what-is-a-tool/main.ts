import type { Context } from '@deepseek-ai/cordis'

// 自定义事件必须在 declare module 里登记（第 04 课），
// 否则 ctx.emit / ctx.on 会因类型对不上而编译不过。
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 用户说了一句话，agent 处理一轮。 */
    'agent/turn'(input: string): void
  }
}

export const name = 'agent'

// 没有这一行，ctx.tools 会抛 "cannot get property "tools" without inject"（第 03 课）
export const inject = ['tools']

/**
 * Consumer：模拟 agent loop 里"模型决定调工具"的那一步。
 *
 * 它不知道有哪些工具，只从 ctx.tools 里查、然后调。
 */
export function apply(ctx: Context) {
  ctx.on('agent/turn', async (input) => {
    console.log(`\n=== 用户说：${input} ===`)

    // 1. 把工具清单打印出来——模型拿到的就是这些文字
    for (const definition of ctx.tools.list()) {
      console.log(`[可用工具] ${definition.name} — ${definition.description}`)
    }

    // 2. 假模型"决定"调 get_weather（真模型是在输出里给出 tool-call）
    const call = matchTool(input)
    if (!call) {
      console.log('[模型] 这个问题不用工具，直接回答。')
      return
    }
    console.log(`[模型决定] 调用 ${call.name}，参数 ${JSON.stringify(call.args)}`)

    // 3. 真正执行，结果无论成败都收进壳里
    const result = await ctx.tools.call(call.name, call.args)
    if (result.ok) {
      console.log(`[工具返回] ${String(result.value)}`)
    } else {
      console.log(`[工具失败] ${result.error}`)
    }
  })

  // 三次"对话"。全部延迟触发：apply 是同步执行的，
  // 此刻 weather.ts 可能还没加载完，马上 emit 会看不到工具。
  setTimeout(() => ctx.emit('agent/turn', '北京天气怎么样？'), 50)
  setTimeout(() => ctx.emit('agent/turn', '你好呀'), 100)
  setTimeout(() => ctx.emit('agent/turn', '查一下天气'), 150)
}

/** 假模型的"决策"：看输入里有没有城市名或"天气"两个字。 */
function matchTool(input: string) {
  const cities = ['北京', '上海']
  const city = cities.find((name) => input.includes(name))
  if (city) return { name: 'get_weather', args: { city } }
  if (input.includes('天气')) return { name: 'get_weather', args: { city: '北京' } }
  return null
}
