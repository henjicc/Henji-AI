# Seedream 5.0 Flash · 火山方舟

核对日期：2026-09-24；公开无需登录，未执行付费生成。

来源：[发布公告](https://docs.volcengine.com/docs/ark/model-release-announcement?lang=zh)、[Pro / Flash 教程](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh)、[价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh)。官方明确基础调用只替换 Model ID，公共契约复用 Pro 实现。

- Model ID：`doubao-seedream-5-0-flash-260915`；`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，Bearer 认证。
- 文生、图生/多图参考、交互编辑、图层拆分；输入上限 10 张，拆分必须 1 张；1K/1.5K/2K，PNG/JPEG；Flash 只支持标准提示词优化。
- SDK 沿用 Pro 的生成/编辑与拆分模式、图片上传、智能比例和结构化图层输出。旧 Pro 参数名与模型 ID 保持不变。
- 输入图免费，输出 ¥0.12/张；拆分数量只有返回后可知，提交前返回不可估算，不能显示 ¥0.12 为整单总价。

| 响应 | 字段与行为 |
|---|---|
| 同步成功 | `data` 图片数组，`url` 字符串；由共享图片适配器收集 URL |
| 图层拆分 | 与 Pro 相同的 layers/base-image 元数据，经 `parseSeedreamLayerStack` 返回结构化图层 |
| 错误、缺失产物、取消 | 沿共享 Volcengine provider 失败收口；不把空结果当成功，不建立重复收费重试 |

官方字面调用中的 Pro Model ID 可按同页明确说明替换成 Flash；测试将此区别标为官方字段构造，不能冒充 Flash 真网样本。共享 Pro 正反测试继续运行，新增 Flash 定向验证模型路由、图片限制、价格和拆分不可估算。
