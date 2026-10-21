import { Tools } from "./tools.js";
const name = "tools-registry";
class MapTools extends Tools {
  definitions = /* @__PURE__ */ new Map();
  counter = 0;
  register(definition) {
    return this.ctx.effect(() => {
      this.definitions.set(definition.name, definition);
      this.ctx.emit("tools/change");
      return () => {
        this.definitions.delete(definition.name);
        this.ctx.emit("tools/change");
      };
    }, `tools.register(${definition.name})`);
  }
  get(name2) {
    return this.definitions.get(name2);
  }
  list() {
    return [...this.definitions.values()];
  }
  schemas() {
    return [...this.definitions.values()].map(({ name: name2, description, parameters }) => ({
      name: name2,
      description,
      parameters
    }));
  }
  async call(name2, args) {
    const definition = this.definitions.get(name2);
    const callId = `call-${++this.counter}`;
    if (!definition) {
      return { ok: false, callId, name: name2, error: `\u5DE5\u5177\u4E0D\u5B58\u5728\uFF1A${name2}` };
    }
    try {
      const value = await definition.execute(args ?? {}, { callId });
      return { ok: true, callId, name: name2, value };
    } catch (error) {
      return { ok: false, callId, name: name2, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
function apply(ctx) {
  ctx.plugin(MapTools);
}
export {
  apply,
  name
};
