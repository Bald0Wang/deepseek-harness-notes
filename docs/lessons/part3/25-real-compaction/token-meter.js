import { Service } from "@deepseek-ai/cordis";
class TokenMeter extends Service {
  constructor(ctx) {
    super(ctx, "tokenMeter");
  }
}
const BLOCK_OVERHEAD = 4;
const ROLE_OVERHEAD = 4;
const CHARS_PER_TOKEN = 4;
class FixedTokenMeter extends TokenMeter {
  /**
   * 给一条消息估价。
   *
   * 真身 `estimate.ts` 在这里给 system 开了一条**不带 BLOCK_OVERHEAD**
   * 的岔路——adapter 把系统提示序列化成一个纯字符串字段，不是带 type
   * 标签的内容块。教学版的 `ChatMessage` 没有 system 角色
   * （`deriveMessages()` 从不产出它），岔路走不到，`measureRequest()`
   * 里的 systemTokens 因此恒 0。
   */
  estimateMessage(message) {
    return Math.ceil(message.content.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD + ROLE_OVERHEAD;
  }
  measure(messages, toolsTokens = 0, systemTokens = 0) {
    const nodes = [];
    let totalTokens = 0;
    for (const message of messages) {
      const tokens = this.estimateMessage(message);
      totalTokens += tokens;
      nodes.push({ tokens, role: message.role });
    }
    totalTokens += toolsTokens + systemTokens;
    return { totalTokens, nodes, systemTokens, toolsTokens };
  }
}
function apply(ctx) {
  ctx.plugin(FixedTokenMeter);
}
export {
  FixedTokenMeter,
  TokenMeter,
  apply
};
