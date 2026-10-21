import { compileNode, ToolArgsError, validateValue } from "./json-schema.js";
function defineTool(options) {
  const compiled = compileParameters(options.parameters);
  return {
    name: options.name,
    description: options.description,
    parameters: compiled,
    async execute(args, exec) {
      const violations = validateValue(compiled, args);
      if (violations.length > 0) {
        throw new ToolArgsError(options.name, violations);
      }
      return options.execute(args, exec);
    }
  };
}
function compileParameters(spec) {
  if (spec === void 0) return { type: "object", additionalProperties: true };
  const node = compileNode({ type: "object", properties: spec });
  node.additionalProperties = true;
  return node;
}
export {
  defineTool
};
