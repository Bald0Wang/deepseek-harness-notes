import { Service } from "@deepseek-ai/cordis";
const SECTION_ORDER = {
  /** 身份：你是谁。永远在最前面。 */
  identity: -1e3,
  /** 人设：部署方给定的行为准则。 */
  persona: 0,
  /** 工具清单：由注册表现算。 */
  tools: 1e3
};
class SystemPrompt extends Service {
  constructor(ctx) {
    super(ctx, "systemPrompt");
  }
}
class ArraySystemPrompt extends SystemPrompt {
  sections = [];
  constructor(ctx) {
    super(ctx);
  }
  section(section) {
    return this.ctx.effect(() => {
      this.sections.push(section);
      this.ctx.emit("system-prompt/change");
      return () => {
        const index = this.sections.indexOf(section);
        if (index >= 0) this.sections.splice(index, 1);
        this.ctx.emit("system-prompt/change");
      };
    }, `systemPrompt.section(${section.name})`);
  }
  assemble() {
    const complete = this.sections.filter((section) => section.complete);
    if (complete.length > 1) {
      throw new Error(
        `system prompt \u6709 ${complete.length} \u6BB5\u6807\u8BB0\u4E86 complete\uFF1A${complete.map((s) => s.name).join("\u3001")}`
      );
    }
    if (complete.length === 1) return resolveText(complete[0]);
    const sorted = [...this.sections].sort((a, b) => a.order - b.order);
    const parts = sorted.map(resolveText).filter((text) => text.length > 0);
    return parts.join("\n\n");
  }
  renderTools(schemas) {
    if (schemas.length === 0) return "";
    const lines = schemas.map((schema) => `- ${schema.name}\uFF1A${schema.description}`);
    return ["\u4F60\u53EF\u4EE5\u4F7F\u7528\u4EE5\u4E0B\u5DE5\u5177\uFF1A", ...lines].join("\n");
  }
}
function resolveText(section) {
  return typeof section.text === "function" ? section.text() : section.text;
}
function apply(ctx) {
  ctx.plugin(ArraySystemPrompt);
}
export {
  SECTION_ORDER,
  SystemPrompt,
  apply
};
