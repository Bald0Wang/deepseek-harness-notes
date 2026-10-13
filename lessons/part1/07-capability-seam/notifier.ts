import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    notifier: Notifier
  }
  interface Events {
    'notifier/send'(message: string): void
  }
}

// Service Definition：定义"通知"这个能力的词汇
export abstract class Notifier extends Service {
  constructor(ctx: Context) {
    super(ctx, 'notifier')
  }

  // 由提供方实现：把消息送到某个渠道
  abstract send(message: string): void
}
