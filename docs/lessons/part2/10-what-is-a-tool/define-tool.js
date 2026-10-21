function defineTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters ?? {},
    execute: options.execute
  };
}
export {
  defineTool
};
