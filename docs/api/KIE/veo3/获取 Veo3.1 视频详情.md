# 获取 Veo3.1 视频详情

查询 Veo3.1 视频生成任务的执行状态和结果。

## 接口信息

**请求方法**: GET
**接口地址**: `https://api.kie.ai/api/v1/veo/record-info`

## 请求示例

```bash
curl --request GET \
  --url https://api.kie.ai/api/v1/veo/record-info \
  --header 'Authorization: Bearer <token>'
```

## 响应示例

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "veo_task_abcdef123456",
    "paramJson": "{\"prompt\":\"A futuristic city with flying cars at sunset.\",\"waterMark\":\"KieAI\"}",
    "completeTime": "2025-06-06 10:30:00",
    "response": {
      "taskId": "veo_task_abcdef123456",
      "resultUrls": [
        "http://example.com/video1.mp4"
      ],
      "originUrls": [
        "http://example.com/original_video1.mp4"
      ],
      "resolution": "1080p"
    },
    "successFlag": 1,
    "errorCode": null,
    "errorMessage": "",
    "createTime": "2025-06-06 10:25:00",
    "fallbackFlag": false
  }
}
```

## 状态说明

*   **0**: 生成中 - 任务正在处理
*   **1**: 成功 - 任务已成功完成
*   **2**: 失败 - 任务生成失败
*   **3**: 生成失败 - 任务创建成功但生成失败

## 重要说明

*   可通过 `taskId` 实时查询任务状态。
*   建议定期轮询直到任务完成。
*   响应中包含 `fallbackFlag` 字段，指示是否使用了托底模型生成。

## 托底状态识别

通过 `fallbackFlag` 字段可以识别任务是否使用了托底模型：

*   `true`: 使用托底模型生成，视频分辨率为 720p。
*   `false`: 使用主模型生成，可能支持 1080P（16:9 宽高比）。

**注意**：托底模型生成的视频无法通过获取 1080P 视频接口升级到高清版本。

## 授权认证

所有 API 都需要通过 Bearer Token 进行认证。

**请求头**:
`Authorization: Bearer YOUR_API_KEY`

**获取 API Key**:
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**注意**:
*   请妥善保管您的 API Key，不要与他人分享。
*   如果您怀疑 API Key 已泄露，请立即在管理页面重置。

## 查询参数

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `taskId` | string | 是 | 任务ID |

## 响应字段说明

### 根对象

| 字段 | 类型 | 描述 |
| :--- | :--- | :--- |
| `code` | enum\<integer\> | 响应状态码。详见下方 `code` 枚举说明。 |
| `msg` | string | 响应消息。示例：`"success"` |
| `data` | object | 任务详情数据。 |

### `code` 枚举说明

| 值 | 描述 |
| :--- | :--- |
| `200` | 成功 - 请求已成功处理。 |
| `400` | 您的提示词被网站标记为违反内容政策。仅支持英文提示词。无法获取图片。请验证您或您的服务提供商设置的任何访问限制。公共错误：不安全的图片上传。 |
| `401` | 未授权 - 认证凭据缺失或无效。 |
| `404` | 未找到 - 请求的资源或端点不存在。 |
| `422` | 验证错误 - 请求参数验证失败。记录为空。暂时支持14天内的记录。记录结果数据为空。记录状态不是成功。记录结果数据不存在。记录结果数据为空。 |
| `451` | 无法获取图片。请验证您或您的服务提供商设置的任何访问限制。 |
| `455` | 服务不可用 - 系统正在进行维护。 |
| `500` | 服务器错误 - 处理请求时发生意外错误。超时。内部错误，请稍后重试。 |

### `data` 对象

| 字段 | 类型 | 描述 |
| :--- | :--- | :--- |
| `taskId` | string | 视频生成任务的唯一标识符。示例：`"veo_task_abcdef123456"` |
| `paramJson` | string | JSON 格式的请求参数。示例：`"{\"prompt\":\"A futuristic city with flying cars at sunset.\",\"waterMark\":\"KieAI\"}"` |
| `completeTime` | string\<date-time\> | 任务完成时间。示例：`"2024-03-20T10:30:00Z"` |
| `response` | object | 最终结果。 |
| `successFlag` | enum\<integer\> | 生成状态标志。可用选项：`0` (生成中), `1` (成功), `2` (失败)。示例：`1` |
| `errorCode` | enum\<integer\> | 任务失败时的错误代码。可用选项：`400`, `500`, `501`。 |
| `errorMessage` | string | 任务失败时的错误消息。示例：`null` |
| `createTime` | string\<date-time\> | 任务创建时间。示例：`"2024-03-20T10:25:00Z"` |
| `fallbackFlag` | boolean | **已弃用**。是否通过托底模型生成。`true`表示使用了备用模型生成，`false`表示使用主模型生成。示例：`false` |

### `data.response` 对象

| 字段 | 类型 | 描述 |
| :--- | :--- | :--- |
| `taskId` | string | 任务ID。示例：`"veo_task_abcdef123456"` |
| `resultUrls` | string[] | 生成的视频URL。示例：`["http://example.com/video1.mp4"]` |
| `originUrls` | string[] | 原始视频URL。仅当 `aspectRatio` 不是 16:9 时才有值。示例：`["http://example.com/original_video1.mp4"]` |
| `resolution` | string | 视频分辨率信息。示例：`"1080p"` |