# Minimax Hailuo 2.3 图生视频

Minimax Hailuo 2.3 是全新升级的视频生成模型，在肢体动作、物理效果和对指令的理解与执行能力等方面表现更为出色。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求示例

**请求**

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/minimax-hailuo-2.3-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "image": "<string>",
  "duration": 123,
  "resolution": "<string>",
  "enable_prompt_expansion": true
}
'
```

**响应**

```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | `string` | 是 | 必须为 `application/json`。 |
| `Authorization` | `string` | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` | `string` | 是 | 指导生成所需的提示词文本。范围: `1 <= x <= 2000`。支持 15 种运镜指令的指令:<br>• 左右移: `[左移]`, `[右移]`<br>• 左右摇: `[左摇]`, `[右摇]`<br>• 推拉: `[推进]`, `[拉远]`<br>• 升降: `[上升]`, `[下降]`<br>• 上下摇: `[上摇]`, `[下摇]`<br>• 变焦: `[变焦推近]`, `[变焦拉远]`<br>• 其他: `[晃动]`, `[跟随]`, `[固定]`<br><br>**使用规则:**<br>• **组合运镜**: 同一组 `[]` 内的多个指令会同时生效，如 `[左摇,上升]`，建议组合不超过 3 个。<br>• **顺序运镜**: `prompt` 中前后出现的指令会依次生效，如 `“…[推进], 然后…[拉远]”`。<br>• **自然语言**: 也支持通过自然语言描述运镜，但使用标准指令能获得更准确的响应。 |
| `image` | `string` | 是 | 用于视频生成的图片。支持公网 URL 或 Base64 编码（如 `data:image/jpeg;base64,...`）。 |
| `duration` | `integer` | 否 | 生成视频的时长（秒）。<br>**默认值**: `6`<br>**可选值**: `6`, `10` |
| `resolution` | `string` | 否 | 生成视频的分辨率。<br>**默认值**: `768P`<br>• 6 秒视频支持：`768P`、`1080P`<br>• 10 秒视频仅支持：`768P` |
| `enable_prompt_expansion` | `boolean` | 否 | 是否启用提示词优化。<br>**默认值**: `true` |

## 响应

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | `string` | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |