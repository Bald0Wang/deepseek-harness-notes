var manifest_default = {
  purpose: "\u76EE\u5F55\u5373\u63D2\u4EF6\uFF1A\u628A provider\u3001\u5DE5\u5177\u3001agent loop \u6536\u8FDB\u4E00\u4E2A\u52A0\u8F7D\u5355\u4F4D",
  plugins: [
    "provider.ts",
    // llm / tools / session 三个服务的唯一来源
    "weather.ts",
    // 往注册表里放一个工具
    "calc.ts",
    // 再放一个工具
    "session.ts",
    // 只增不减的磁盘日志
    "token-meter.ts",
    // 本课新增：给请求算 token 账
    "mock-provider.ts",
    // 假模型：不需要 API Key
    "main.ts"
    // agent loop（Consumer）
  ]
};
export {
  manifest_default as default
};
