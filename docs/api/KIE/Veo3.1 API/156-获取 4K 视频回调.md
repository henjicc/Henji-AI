# 获取 4K 视频回调


当 4K 视频生成任务完成时，系统会调用此回调接口来通知您最终结果。

::: info[]
4K 视频生成任务完成后，系统将通过回调机制自动将结果推送到您的服务器，无需您持续轮询接口状态。
:::

:::tip[]
  **Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调配置

在请求 4K 视频生成接口时，请在 `callBackUrl` 参数中配置您的接收地址：

```json
{
  "taskId": "veo_task_abcdef123456",
  "index": 0,
  "callBackUrl": "https://your-domain.com/api/4k-callback"
}
```

---

## 回调请求格式

任务完成后，系统将向您配置的 URL 发送一个 **POST** 请求，格式如下：

#### 1. 成功回调示例
```json
{
  "code": 200,
  "msg": "4K Video generated successfully.",
  "data": {
    "taskId": "veo_task_example123",
    "info": {
      "resultUrls": [
        "https://file.aiquickdraw.com/v/example_task_1234567890.mp4"
      ],
      "imageUrls": [
        "https://file.aiquickdraw.com/v/example_task_1234567890.jpg"
      ]
    }
  }
}
```

#### 2. 失败回调示例
```json
{
  "code": 500,
  "msg": "The 4K version of this video is unavailable. Please try a different video.",
  "data": {
    "taskId": "veo_task_abcdef123456"
  }
}
```

---

## 回调字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| **code** | integer | 状态码。`200`: 成功；`500`: 失败。 |
| **msg** | string | 状态描述。成功显示成功信息，失败显示具体错误原因。 |
| **data** | object | 任务结果数据（仅在成功时包含完整内容）。 |
| ∟ **taskId** | string | 任务唯一标识符。 |
| ∟ **info.resultUrls** | array | 生成的 4K 视频下载地址数组。 |
| ∟ **info.imageUrls** | array | 相关的缩略图或预览图地址数组。 |

---

## 回调处理流程

1.  **验证状态**：检查 `code` 字段，确认视频是否生成成功。
2.  **提取结果**：从 `data.info.resultUrls` 中获取生成的 4K 视频下载地址。
3.  **响应系统**：您的服务器应返回 `200` 状态码，以确认已成功接收回调。

---

## 错误处理

如果在 4K 视频生成过程中发生错误，回调将返回错误状态码。目前支持的错误情况包括：

*   **500**: 4K 版本不可用 — *"The 4K version of this video is unavailable. Please try a different video."*

::: warning[重要提醒]
请确保您的回调接口能够处理重复的推送（幂等性），以避免在网络抖动导致系统重试时重复处理同一个任务。
:::

## 最佳实践
::: tip[4K 回调处理建议]
- **及时下载**：4K 视频文件体积较大且链接有有效期限制，请在接收回调后尽快下载并转存。
- **幂等处理**：同一任务可能触发多次回调，请确保您的逻辑支持重复接收。
- **资源追踪**：使用返回的 <code>taskId</code> 进行媒体文件的关联管理。
- **存储规划**：4K 视频占用存储空间较大，请预先规划好您的磁盘容量。
:::

## 替代方案

如果您无法使用回调机制，也可以使用主动查询：
<CardGroup cols={1}>
  <Card title="轮询查询结果" icon="lucide-text" href="/cn/veo3-api/get-veo-3-video-details">
    使用<i>“获取视频详情”</i>接口定期查询 4K 视频生成任务的状态。
  </Card>
</CardGroup>

---

如果您在集成过程中遇到任何问题，请联系我们的技术支持：[support@kie.ai](mailto:support@kie.ai)

