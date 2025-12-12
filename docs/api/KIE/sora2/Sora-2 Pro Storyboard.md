# Sora-2 Pro Storyboard

使用 `sora-2-pro-storyboard` 模型，从图像生成分镜视频。

**请求方法**: `POST`
**请求路径**: `/api/v1/jobs/createTask`

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "sora-2-pro-storyboard",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "shots": [
      {
        "Scene": "一只可爱的蓬松橘白相间的小猫戴着橘色耳机，坐在舒适的室内桌子旁，盘子里有一小块蛋糕，附近有一个玩具鱼和银色麦克风，温暖柔和的光线，电影特写，浅景深，温柔的ASMR氛围。",
        "duration": 7.5
      },
      {
        "Scene": "同一只可爱的蓬松橘白相间的小猫戴着橘色耳机，在同一个舒适的室内ASMR设置中，玩具鱼和麦克风，蛋糕现在吃完了，小猫轻轻舔着嘴唇，带着满足的微笑，温暖的环境照明，电影特写，浅景深，平静而满足的心情。",
        "duration": 7.5
      }
    ],
    "n_frames": "15",
    "image_urls": [
      "https://file.aiquickdraw.com/custom-page/akr/section-images/1760776438785hyue5ogz.png"
    ],
    "aspect_ratio": "landscape"
  }
}
'
```

## 响应示例

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_sora-2-pro-storyboard_1765188271139"
  }
}
```

## 查询任务状态

提交任务后，使用统一的查询端点检查进度并获取结果。建议查阅 [获取任务详情](/cn/market/common/get-task-detail) 文档。

对于生产环境，我们建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

## 请求参数说明

### 认证 (Authorization)

*   **类型**: `string`
*   **位置**: `header`
*   **是否必需**: 是
*   **描述**: 所有 API 都需要通过 Bearer Token 进行身份验证。
    *   **获取方式**: 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。
    *   **使用方法**: 添加到请求头：`Authorization: Bearer YOUR_API_KEY`
    *   **注意**: 请妥善保管您的 API Key，不要与他人共享。如果您怀疑 API Key 已泄露，请立即在管理页面重置。

### 请求体 (Body)

**Content-Type**: `application/json`

| 参数 | 类型 | 默认值 | 是否必需 | 描述 | 示例 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `model` | `enum<string>` | `sora-2-pro-storyboard` | 是 | 用于生成的模型名称。此端点必须使用 `sora-2-pro-storyboard`。 | `"sora-2-pro-storyboard"` |
| `callBackUrl` | `string<uri>` | - | 否 | 接收生成任务完成更新的 URL。可选但建议在生产环境中使用。当生成完成时，系统将向此 URL POST 任务状态和结果。 | `"https://your-domain.com/api/callback"` |
| `input` | `object` | - | 是 | 生成任务的输入参数。 | - |
| `input.n_frames` | `enum<string>` | `15` | 是 | 视频总长度。可用选项: `10`, `15`, `25`。 | `"15"` |
| `input.shots` | `object[]` | - | 是 | 分镜描述数组及其持续时间。所有分镜的总时长不能超过所选的 `n_frames` 值。数组长度: `1 - 10` 个元素。 | `[ { "Scene": "场景描述...", "duration": 7.5 } ]` |
| `input.shots.Scene` | `string` | - | 是 | 场景/分镜的详细描述。 | `"一只可爱的蓬松橘白相间的小猫..."` |
| `input.shots.duration` | `number` | - | 是 | 此分镜的持续时间（秒）。所有分镜的总时长不能超过 `n_frames`。范围: `0.1 <= x <= 15`。 | `7.5` |
| `input.image_urls` | `string<uri>[]` | - | 是 | 上传图片文件作为API输入（上传后的文件URL，不是文件内容；接受类型：image/jpeg, image/png, image/webp；最大大小：10.0MB）。限制为正好1张图片。 | `[ "https://example.com/image.png" ]` |
| `input.aspect_ratio` | `enum<string>` | `landscape` | 是 | 定义图片的宽高比。可用选项: `portrait`, `landscape`。 | `"landscape"` |

## 响应参数说明

| 参数 | 类型 | 描述 | 示例 |
| :--- | :--- | :--- | :--- |
| `code` | `enum<integer>` | 响应状态码。<br>• `200`: 成功 - 请求已成功处理<br>• `401`: 未授权 - 身份验证凭据缺失或无效<br>• `402`: 积分不足 - 账户没有足够的积分执行操作<br>• `404`: 未找到 - 请求的资源或端点不存在<br>• `422`: 验证错误 - 请求参数未通过验证检查<br>• `429`: 速率限制 - 已超过此资源的请求限制<br>• `455`: 服务不可用 - 系统正在维护中<br>• `500`: 服务器错误 - 处理请求时发生意外错误<br>• `501`: 生成失败 - 内容生成任务失败<br>• `505`: 功能已禁用 - 请求的功能当前已禁用 | `200` |
| `msg` | `string` | 响应消息，失败时为错误描述。 | `"success"` |
| `data` | `object` | 响应数据。 | - |
| `data.taskId` | `string` | 任务 ID，可用于通过获取任务详情端点查询任务状态。 | `"task_sora-2-pro-storyboard_1765188271139"` |