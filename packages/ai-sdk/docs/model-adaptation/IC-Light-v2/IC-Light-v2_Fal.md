# IC-Light v2 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 模态 | 图片编辑 / 重打光 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/iclight-v2` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 能力与边界

IC-Light v2 接收一张源图，通过文字描述和离散的初始光照偏好重新生成光照。Fal 模型页标注可商用；Fal 托管端点不要求本项目部署开源权重。产品首版只把 `initial_latent` 的五个官方值作为离散方向偏好，亮度、色调和轮廓光均由版本化提示词表达，不能宣称为物理精确控制。

上游 IC-Light 仓库采用 Apache-2.0；仓库同时说明本地示例使用的 BRIA RMBG 1.4 权重具有非商用限制。该限制影响自行部署相应去背景权重的方案，不等同于 Fal 托管端点的产品许可。若未来改为自部署，必须重新完成权重来源与商用许可审查。

## 2. 接入协议

- 鉴权：`Authorization: Key $FAL_KEY`
- 同步：`POST https://fal.run/fal-ai/iclight-v2`
- 队列：`POST https://queue.fal.run/fal-ai/iclight-v2`，随后按 Fal 通用队列协议查询状态与结果
- 成功结果：`images[]`，本项目继续复用 Fal 现有图片结果解析、轮询、取消与上传链路

## 3. 输入参数

| 字段 | 类型 | 必填 | 默认 | 首版策略 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | 由手动模式提示词编译器生成 |
| `image_url` | string | 是 | — | 恰好一张源图，由现有 Fal 上传链路提供 |
| `initial_latent` | enum | 否 | `None` | 仅 `None` / `Left` / `Right` / `Top` / `Bottom` |
| `image_size` | enum/object | 否 | `square_hd` | 首版按源图比例选择最近常见比例并固定约 1MP |
| `num_images` | integer | 否 | `1` | 固定 `1` |
| `num_inference_steps` | integer | 否 | `28` | 固定 `28` |
| `cfg_scale` | number | 否 | `1` | 固定 `1` |
| `guidance_scale` | number | 否 | `5` | 固定 `5` |
| `lowres_denoise` | number | 否 | `0.98` | 固定 `0.98` |
| `highres_denoise` | number | 否 | `0.95` | 固定 `0.95` |
| `highres_scale` | number | 否 | `0.5` | 固定 `0.5` |
| `enable_hr_fix` | boolean | 否 | `false` | 固定 `false`，首版避免额外成本与时延 |
| `enable_safety_checker` | boolean | 否 | `true` | 固定 `true` |
| `mask_url` | string | 否 | — | 首版不开放 |
| `negative_prompt` | string | 否 | — | 不展示、不发送 |
| `seed` | integer | 否 | — | 不展示、不发送 |
| `output_format` | enum | 否 | `png` | 不展示、不发送，沿用供应商默认 |

## 4. 请求示例

```json
{
  "prompt": "Preserve the subject and composition. Apply a soft warm key light from the left.",
  "image_url": "https://.../source.png",
  "initial_latent": "Left",
  "image_size": { "width": 1376, "height": 768 },
  "num_images": 1,
  "num_inference_steps": 28,
  "cfg_scale": 1,
  "guidance_scale": 5,
  "lowres_denoise": 0.98,
  "highres_denoise": 0.95,
  "highres_scale": 0.5,
  "enable_hr_fix": false,
  "enable_safety_checker": true
}
```

## 5. 响应与计价

```json
{
  "images": [
    { "url": "https://...", "width": 1376, "height": 768, "content_type": "image/png" }
  ]
}
```

Fal 模型页公开价格为 **$0.10/百万像素**。首版固定约 1MP、单张输出，目录保守估算为 **$0.10/次**。实际账单仍以 Fal 返回和账户账单为准，登录后的额度、地区可用性与最终账单尚待真实验证。

## 6. 错误与降级

- 缺少源图或源图超过一张：在请求构建前失败，不提交任务。
- Fal 凭据、端点或余额不可用：显示明确失败，不自动切换模型。
- 手动模式不能静默降级到 GPT Image 2；智能模式也不能静默切到 IC-Light。
- 模型质量、主体保持、时延和真实成本尚未执行付费验证，不影响静态契约完成。

## 7. 一手来源

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Fal 模型页、商用标识与价格 | https://fal.ai/models/fal-ai/iclight-v2 | 否 |
| Fal schema | https://fal.ai/models/fal-ai/iclight-v2/llms.txt | 否 |
| Fal OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/iclight-v2 | 否 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| IC-Light 官方仓库与许可证 | https://github.com/lllyasviel/IC-Light | 否 |
| Fal API Key | https://fal.ai/dashboard/keys | 是 |
