import type { Context } from '@deepseek-ai/cordis'

export const name = 'needs-timer'
export const inject = ['timer']

export function apply(_ctx: Context) {
  console.log('needs-timer loaded')
}
