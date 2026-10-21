import Schema from "@deepseek-ai/schemastery";
const name = "config-demo";
const Config = Schema.object({
  greeting: Schema.string().default("Hello"),
  targets: Schema.array(String).default(["world"])
});
function apply(_ctx, config) {
  for (const target of config.targets) {
    console.log(`${config.greeting}, ${target}!`);
  }
}
export {
  Config,
  apply,
  name
};
