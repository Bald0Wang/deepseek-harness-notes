class ToolArgsError extends Error {
  constructor(toolName, violations) {
    super(`invalid arguments: ${violations.join("; ")}`);
    this.toolName = toolName;
    this.violations = violations;
    this.name = "ToolArgsError";
  }
  toolName;
  violations;
}
function compileNode(spec) {
  const node = { type: spec.type };
  if (spec.description !== void 0) node.description = spec.description;
  if ("enum" in spec && spec.enum !== void 0) node.enum = spec.enum;
  if (spec.type === "array" && spec.items !== void 0) {
    node.items = compileNode(spec.items);
  }
  if (spec.type === "object") {
    node.additionalProperties = spec.additionalProperties ?? false;
    if (spec.properties !== void 0) {
      node.properties = {};
      node.required = [];
      for (const [key, child] of Object.entries(spec.properties)) {
        node.properties[key] = compileNode(child);
        if (child.required === true) node.required.push(key);
      }
      if (node.required.length === 0) delete node.required;
    }
  }
  return node;
}
function validateValue(schema, value, path = "$") {
  const violations = [];
  const at = (suffix) => suffix === "" ? path : `${path}.${suffix}`;
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        violations.push(`${at("")} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\uFF0C\u6536\u5230 ${describe(value)}`);
        break;
      }
      if (schema.enum !== void 0 && !schema.enum.includes(value)) {
        violations.push(`${at("")} \u5FC5\u987B\u662F ${schema.enum.map((entry) => JSON.stringify(entry)).join(" / ")} \u4E4B\u4E00`);
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        violations.push(`${at("")} \u5FC5\u987B\u662F\u6570\u5B57\uFF0C\u6536\u5230 ${describe(value)}`);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        violations.push(`${at("")} \u5FC5\u987B\u662F\u5E03\u5C14\u503C\uFF0C\u6536\u5230 ${describe(value)}`);
      }
      break;
    case "array": {
      if (!Array.isArray(value)) {
        violations.push(`${at("")} \u5FC5\u987B\u662F\u6570\u7EC4\uFF0C\u6536\u5230 ${describe(value)}`);
        break;
      }
      if (schema.items === void 0) break;
      value.forEach((entry, index) => {
        violations.push(...validateValue(schema.items, entry, `${path}[${index}]`));
      });
      break;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        violations.push(`${at("")} \u5FC5\u987B\u662F\u5BF9\u8C61\uFF0C\u6536\u5230 ${describe(value)}`);
        break;
      }
      const record = value;
      for (const key of schema.required ?? []) {
        if (record[key] === void 0) {
          violations.push(`${at(key)} \u662F\u5FC5\u586B\u9879\uFF0C\u4F46\u6CA1\u6709\u63D0\u4F9B`);
        }
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (record[key] === void 0) continue;
        violations.push(...validateValue(child, record[key], at(key)));
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (schema.properties === void 0 || !(key in schema.properties)) {
            violations.push(`${at(key)} \u4E0D\u662F\u58F0\u660E\u8FC7\u7684\u5B57\u6BB5\uFF08additionalProperties: false\uFF09`);
          }
        }
      }
      break;
    }
    default:
      throw new Error(`\u4E0D\u652F\u6301\u7684 schema \u7C7B\u578B\uFF1A${schema.type}`);
  }
  return violations;
}
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "\u6570\u7EC4";
  if (typeof value === "object") return "\u5BF9\u8C61";
  return JSON.stringify(value) ?? String(value);
}
export {
  ToolArgsError,
  compileNode,
  validateValue
};
