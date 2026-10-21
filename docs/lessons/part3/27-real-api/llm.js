import { Service } from "@deepseek-ai/cordis";
class Llm extends Service {
  constructor(ctx) {
    super(ctx, "llm");
  }
}
export {
  Llm
};
