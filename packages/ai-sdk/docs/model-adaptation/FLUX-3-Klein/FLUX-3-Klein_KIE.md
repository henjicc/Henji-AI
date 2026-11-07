# FLUX 3 Klein · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `kie-flux-3-klein`，通用标识 `flux-3-klein` |
| model ID | `flux-3/klein-text-to-image`、`flux-3/klein-edit-image` |
| 文档与价格 | 公开，无需登录 |
| 定价（每张，文生图与编辑同价） | 1K $0.008、2K $0.0125、4K $0.0325 |

KIE 当前只上架 FLUX 3 的 Klein 档；没有其他 FLUX 3 档位的文档或价格。

## 请求契约

`POST https://api.kie.ai/api/v1/jobs/createTask`，`{model,input}`；无图走文生图，有图自动走编辑。

| input 字段 | 值与约束 | 项目处理 |
|---|---|---|
| prompt | 必填，≤5000 | 统一提示词 |
| image_urls | 编辑必填，1–10 张，jpeg/png/webp，≤30MB | 上传素材 |
| aspect_ratio | 文生图：1:1（默认）、4:3、3:4、3:2、2:3、16:9、9:16、21:9、9:21；编辑另有 auto（跟随首图） | 智能比例：编辑发 auto，文生图本地转具体值（无图 1:1） |
| resolution | 1K（默认）、2K、4K | 展示 |
| width / height | 256–4096 自定义尺寸，传入后忽略比例与分辨率 | 不显示、不请求 |
| num_images | 1–4，默认 1 | 生成数量 |
| enhance_prompt | 默认 true，生成前改写提示词 | 开关，默认开 |
| output_format / seed / nsfw_checker | 可选 | 按产品约定不显示、不请求 |

## 事件与失败契约

沿用 [KIE 供应商文档](../供应商/KIE.md) 第 2 节 Market 统一任务契约。官方请求 schema 见 `tests/fixtures/model-requests-2026-11/kie-flux-3-klein-*.json`；未做付费真网验收。

## 原始链接索引

均公开，无需登录：
- [Klein Text to Image](https://docs.kie.ai/market/flux3/klein-text-to-image.md)
- [Klein Edit Image](https://docs.kie.ai/market/flux3/klein-edit-image.md)
- [模型页](https://kie.ai/flux-3)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对 6 行 Flux 3 Klein 价格）
