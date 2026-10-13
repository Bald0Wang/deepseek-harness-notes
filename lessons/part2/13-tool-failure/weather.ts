import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from './define-tool.ts'

export const name = 'weather-tool'

// 忘了这行，ctx.tools 会抛 "cannot get property "tools" without inject"
// （第 03 课的规矩：要拿 ctx 上的服务，必须先声明 inject）
export const inject = ['tools']

/**
 * Service Provider 的角色之一：往 ctx.tools 里放一个工具。
 *
 * 真身（packages/web/tool-web/src/search.ts）长这样：
 *   ctx.tools.register(defineTool({ name: 'web_search', ... }))
 * 我们连形状都照抄，只是把网络请求换成了假数据。
 */
export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'get_weather',
    description: '查询一个城市的天气。需要城市名。',
    parameters: {
      city: {
        type: 'string',
        required: true,
        description: '城市名，例如 "北京"',
      },
      unit: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        description: '温度单位，默认摄氏度。',
      },
    },
    async execute(args) {
      const city = String(args.city ?? '')
      // Keyless：假数据，不联网
      const table: Record<string, string> = {
        北京: '晴，12°C',
        上海: '小雨，18°C',
      }
      // 教学道具：模拟一个"工具自己炸了"的场景。
      // 真身里这就是网络超时、API 限流、空指针——工具内部的意外。
      if (city === '火星') throw new Error('气象服务连接超时（30s）')
      const forecast = table[city] ?? '晴，20°C（默认值）'
      const unit = args.unit === 'fahrenheit' ? '（已换算为华氏）' : ''
      return `${city}：${forecast}${unit}`
    },
  }))
}
