import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, GenerateOptions, StreamChunk } from './llm.ts'

export const name = 'consumer'

// 没有这一行，ctx.llm 会抛 "cannot get property "llm" without inject"（第 03 课讲过）
export const inject = ['llm']

// Consumer：只依赖抽象 Llm，不知道背后是假模型还是真 API
export function apply(ctx: Context) {
  ctx.on('llm/generate', (input) => {
    void run(input)
  })

  // 三次调用，把三段剧本依次演完
  ctx.emit('llm/generate', '你好')
  setTimeout(() => ctx.emit('llm/generate', '现在几点了？'), 50)
  setTimeout(() => ctx.emit('llm/generate', '第二篇我们会学工具'), 100)

  async function run(input: string) {
    const options: GenerateOptions = {
      messages: [{ role: 'user', content: input }],
    }

    // 消费方只面向抽象：Iterable 的迭代协议让它不必知道 chunk 从哪来
    for await (const chunk of ctx.llm.stream(options)) {
      print(chunk)
    }
  }

  function print(chunk: StreamChunk) {
    switch (chunk.type) {
      case 'block-start':
        console.log(`--- 内容块开始（${chunk.blockType}）---`)
        break
      case 'text-delta':
        process.stdout.write(chunk.text)
        break
      case 'reasoning-delta':
        process.stdout.write(`[思考] ${chunk.text}`)
        break
      case 'tool-call-delta':
        console.log(`[工具调用片段] id=${chunk.id} name=${chunk.name ?? '(同上)'} 参数=${chunk.argumentsDelta}`)
        break
      case 'block-end':
        console.log(`\n--- 内容块结束：${formatBlock(chunk.block)} ---`)
        break
      case 'usage':
        console.log(`[用量] 输入 ${chunk.usage.inputTokens} / 输出 ${chunk.usage.outputTokens} tokens`)
        break
      case 'finish':
        console.log(`[结束] 原因：${chunk.reason.kind}`)
        break
    }
  }
}

function formatBlock(block: ContentBlock) {
  switch (block.type) {
    case 'text':
      return `文字 "${block.text}"`
    case 'tool-call':
      return `工具 ${block.name}(${block.arguments})`
  }
}
