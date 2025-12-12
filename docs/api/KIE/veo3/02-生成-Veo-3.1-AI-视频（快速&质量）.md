# 生成 Veo 3.1 AI 视频（快速&质量）

使用 Veo3.1 API 创建新的视频生成任务。

我们的 **Veo 3.1 生成 API** 不仅仅是 Google 基线的直接封装。它在官方模型之上增加了广泛的优化和可靠性工具，为您提供更大的灵活性和显著更高的成功率——**仅为 Google 官方定价的 25%**（完整详情请参见 kie.ai/billing）。

| 功能 | 详情 |
| --- | --- |
| **模型** | • **Veo 3.1 Quality** — 旗舰模型，最高保真度 <br> • **Veo 3.1 Fast** — 成本效益高的变体，仍能提供出色的视觉效果 |
| **任务** | • **文本 → 视频** <br> • **图片 → 视频**（单参考帧或首尾帧） <br> • **素材 → 视频**（基于素材图片生成） |
| **生成模式** | • **TEXT\_2\_VIDEO** — 文生视频：仅使用文本提示词 <br> • **FIRST\_AND\_LAST\_FRAMES\_2\_VIDEO** — 首尾帧生视频：使用两张图片生成过渡视频 <br> • **REFERENCE\_2\_VIDEO** — 素材生视频：基于素材图片生成（仅支持 Fast 模型和 16:9 比例） |
| **宽高比** | 我们现在支持原生 16:9 和 9:16 输出，允许您生成横向或纵向视频，无需任何额外处理。此外，Auto 模式会根据上传的图片自动匹配宽高比。 |
| **语言** | Google 的原生支持仅限英语；我们的多语言提示词预处理将可靠的生成扩展到大多数主要语言。 |
| **音频轨道** | 所有视频默认带有背景音频。在不到 5% 的情况下，当场景被认为是敏感的（例如未成年人）时，Google 会抑制音频。 |

## 为什么我们的 Veo 3.1 API 与众不同

1.  **真正的竖屏视频** – 原生 Veo 3.1 现在完全支持 **9:16** 输出，提供真实的竖屏视频，无需重新取景或手动编辑。
2.  **全球语言覆盖** – 提示词清理、token 权重重新平衡将非英语成功率提升到远高于标准 Veo 3.1 行为。
3.  **显著的成本节省** – 我们的费率是 Google 直接 API 定价的 25%。

## 接口说明

**端点：** `POST /api/v1/veo/generate`

### 认证

所有 API 都需要通过 Bearer Token 进行认证。

**Header 参数：**
*   `Authorization` (string, required): Bearer Token
    *   获取 API Key：访问 [API Key 管理页面](https://kie.ai/api-key)
    *   使用方法：`Authorization: Bearer YOUR_API_KEY`
    *   注意：请妥善保管您的 API Key，不要与他人分享。如果怀疑泄露，请立即重置。

### 请求体 (application/json)

| 参数 | 类型 | 必需 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | - | 描述所需视频内容的文本提示词。所有生成模式都需要。应详细且具体，可包含动作、场景、风格等信息。对于图片生成视频，描述希望图片如何动起来。<br>示例：`"A dog playing in a park"` |
| `imageUrls` | string[] | 否 | - | 图片链接列表（图片生成视频模式使用）。支持1张或2张图片：<br>• 1张图片：生成的视频围绕该图片展开，图片内容会动态呈现。<br>• 2张图片：第一张图片作为视频的首帧，第二张图片作为视频的尾帧，视频将在两帧之间过渡。<br>必须是有效的、可被 API 服务器访问的图片 URL。<br>示例：`["http://example.com/image1.jpg", "http://example.com/image2.jpg"]` |
| `model` | enum<string> | 否 | `veo3_fast` | 选择使用的模型类型。<br>可选值：`veo3`, `veo3_fast`<br>示例：`"veo3_fast"` |
| `generationType` | enum<string> | 否 | - | 视频生成模式。指定不同的视频生成方式：<br>• `TEXT_2_VIDEO`：文生视频 - 仅使用文本提示词生成视频。<br>• `FIRST_AND_LAST_FRAMES_2_VIDEO`：首尾帧生视频 - 灵活的图片到视频生成模式。传1张图片：基于该图片生成视频；传2张图片：第一张作为首帧，第二张作为尾帧，生成过渡视频。<br>• `REFERENCE_2_VIDEO`：参考图生视频 - 基于参考图片生成视频，需要在 `imageUrls` 中提供1-3张图片（至少1张，最多3张）。<br>**重要提示：** `REFERENCE_2_VIDEO` 模式目前仅支持 `veo3_fast` 模型和 `16:9` 宽高比。不填写时系统会根据是否提供 `imageUrls` 自动判断生成模式。<br>可选值：`TEXT_2_VIDEO`, `FIRST_AND_LAST_FRAMES_2_VIDEO`, `REFERENCE_2_VIDEO`<br>示例：`"TEXT_2_VIDEO"` |
| `watermark` | string | 否 | - | 水印文本。如果提供，将在生成的视频上添加水印。<br>示例：`"MyBrand"` |
| `aspectRatio` | enum<string> | 否 | `16:9` | 视频的宽高比。用于指定生成视频的尺寸比例。<br>可选值：<br>• `16:9`：横屏视频格式，支持生成1080P高清视频（仅16:9比例支持生成1080P）。<br>• `9:16`：竖屏视频格式，适合移动端短视频。<br>• `Auto`：自动模式，视频会根据上传图片更接近16:9还是9:16自动进行居中裁剪。<br>示例：`"16:9"` |
| `seeds` | integer | 否 | - | 随机种子参数，用于控制生成内容的随机性。取值范围为 `10000 <= x <= 99999`。相同的种子会生成相似的视频内容，不同的种子会生成不同的视频内容。不填写时系统自动分配。<br>示例：`12345` |
| `callBackUrl` | string | 否 | - | 用于接收视频生成任务完成更新的URL地址。可选但推荐在生产环境中使用。系统将在视频生成完成时向此URL发送POST请求，包含任务状态和结果。您的回调端点应能接受包含视频结果的JSON载荷的POST请求。详细的回调格式和实现指南，请参见 [视频生成回调](https://docs.kie.ai/cn/veo3-api/generate-veo-3-video-callbacks)。或者，您也可以使用获取视频详情接口来轮询任务状态。<br>示例：`"http://your-callback-url.com/complete"` |
| `enableFallback` | boolean | 否 | `false` | **已废弃** 是否启用托底机制。此参数已废弃，请从请求中移除此参数。系统已自动优化内容审核机制，无需手动配置托底功能。 |
| `enableTranslation` | boolean | 否 | `true` | 是否启用提示词翻译为英文。当设置为 `true` 时，系统会自动将提示词翻译为英文后再进行视频生成，以获得更好的生成效果。<br>示例：`true` |

### 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/veo/generate \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "A dog playing in a park",
  "imageUrls": [
    "http://example.com/image1.jpg",
    "http://example.com/image2.jpg"
  ],
  "model": "veo3_fast",
  "watermark": "MyBrand",
  "callBackUrl": "http://your-callback-url.com/complete",
  "aspectRatio": "16:9",
  "seeds": 12345,
  "enableFallback": false,
  "enableTranslation": true,
  "generationType": "REFERENCE_2_VIDEO"
}
'
```

### 响应

**成功响应 (200)**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "veo_task_abcdef123456"
  }
}
```

| 字段 | 类型 | 描述 |
| :--- | :--- | :--- |
| `code` | enum<integer> | 响应状态码。<br>可选值：`200`, `400`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505` |
| `msg` | string | 响应消息。<br>示例：`"success"` |
| `data.taskId` | string | 任务 ID，可用于获取视频详情接口查询任务状态。<br>示例：`"veo_task_abcdef123456"` |

**状态码说明：**
*   `200`: 成功 - 请求已成功处理。
*   `400`: 1080P正在处理中。预计1-2分钟后准备就绪。请稍后再次查看。
*   `401`: 未授权 - 认证凭据缺失或无效。
*   `402`: 积分不足 - 账户没有足够的积分执行操作。
*   `404`: 未找到 - 请求的资源或端点不存在。
*   `422`: 验证错误 - 请求参数验证失败。当未开启托底且生成失败时，错误信息格式为：`Your request was rejected by Flow(原始错误信息). You may consider using our other fallback channels, which are likely to succeed. Please refer to the documentation.`
*   `429`: 请求限制 - 已超过该资源的请求限制。
*   `455`: 服务不可用 - 系统正在进行维护。
*   `500`: 服务器错误 - 处理请求时发生意外错误。
*   `501`: 生成失败 - 视频生成任务失败。
*   `505`: 功能禁用 - 请求的功能当前已禁用。