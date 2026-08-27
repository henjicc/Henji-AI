# SDK 调研资料索引

本目录收纳「模型SDK抽离」任务 1.3 从仓库根 `docs/` 迁入的两份调研资产。迁入 SDK 包的目的是让
「代码 + 文档 + 目录数据」同仓同版本，避免文档与实现分处两地产生漂移；两份资料此前分别是
`docs/model-adaptation/` 与 `docs/llm-adaptation/`，现分别对应本目录下同名子目录。

## [model-adaptation/](model-adaptation/README.md) —— 生成模型 API 与价格资料

覆盖**生成模型**（图片/视频/音频）：每个 (模型, 供应商) 组合对应一份写死的
`packages/ai-sdk/src/catalog/{provider}/*.model.ts`，供应商是固定枚举。是本项目**唯一的模型 API 与价格资料源**，
核对字段名、枚举值、输入限制、端点或价格时只读这里，不要凭记忆下结论。

动手前先读入口手册：[model-adaptation/文档采集手册.md](model-adaptation/文档采集手册.md)。

## [llm-adaptation/](llm-adaptation/README.md) —— LLM 供应商适配资料

覆盖**大语言模型**：供应商和模型是用户运行时自建的，不是代码里为每个模型写一份文件，按供应商
（而非模型）组织资料。用于核对思考参数、联网搜索、工具调用、协议矩阵等信息。

动手前先读入口手册：[llm-adaptation/文档采集手册.md](llm-adaptation/文档采集手册.md)。

## 两者的区别

详见 [llm-adaptation/README.md](llm-adaptation/README.md) 第一节「这是什么，和
`docs/model-adaptation/` 有什么不一样」——生成模型的供应商固定、代码与文档 1:1 影子关系；LLM 的
供应商与模型运行时自建，代码只在协议层（而非模型层）与文档对应。
