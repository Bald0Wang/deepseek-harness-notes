import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

// 参数名以 _ 开头，TS 的 noUnusedParameters 就放行—— Cordis 固定传 ctx 进来，
// 用不到是我们的自由，但位置得留着。
export function apply(_ctx: Context) {
  console.log('hello from my first plugin')
}
