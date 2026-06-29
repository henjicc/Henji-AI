# 音乐扩展回调

当音乐扩展完成时，系统会调用此回调通知结果


当您向 Suno API 提交音乐扩展任务时，可以通过 `callBackUrl` 参数设置回调地址。任务完成后，系统会自动将结果推送到您指定的地址。

## 回调机制概述

:::info[]
回调机制避免了您需要轮询 API 查询任务状态，系统会主动推送任务完成结果到您的服务器。
:::

:::tip[]
**Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统会在以下情况发送回调通知：
- 文本生成完成（callbackType: "text"）
- 第一首音乐扩展完成（callbackType: "first"）
- 全部音乐扩展完成（callbackType: "complete"）
- 音乐扩展任务失败
- 任务处理过程中发生错误

### 回调方式

- **HTTP 方法**: POST
- **内容类型**: application/json
- **超时设置**: 15 秒

## 回调请求格式

任务进展或完成后，系统会向您的 `callBackUrl` 发送 POST 请求，格式如下：

<Tabs>
  <TabItem value="complete" label="完成成功回调">
    ```json
    {
      "code": 200,
      "msg": "All generated successfully.",
      "data": {
        "callbackType": "complete",
        "task_id": "2fac****9f72",
        "data": [
          {
            "id": "e231****-****-****-****-****8cadc7dc",
            "audio_url": "https://example.cn/****.mp3",
            "stream_audio_url": "https://example.cn/****",
            "image_url": "https://example.cn/****.jpeg",
            "prompt": "[Verse] 夜晚城市 灯火辉煌",
            "model_name": "chirp-v3-5",
            "title": "钢铁侠",
            "tags": "electrifying, rock",
            "createTime": "2025-01-01 00:00:00",
            "duration": 198.44
          }
        ]
      }
    }
    ```
  </TabItem>
  <TabItem value="first" label="第一首完成回调">
    ```json
    {
      "code": 200,
      "msg": "第一首音乐扩展成功。",
      "data": {
        "callbackType": "first",
        "task_id": "2fac****9f72",
        "data": [
          {
            "id": "e231****-****-****-****-****8cadc7dc",
            "audio_url": "https://example.cn/****.mp3",
            "stream_audio_url": "https://example.cn/****",
            "image_url": "https://example.cn/****.jpeg",
            "prompt": "[Verse] 夜晚城市 灯火辉煌",
            "model_name": "chirp-v3-5",
            "title": "钢铁侠",
            "tags": "electrifying, rock",
            "createTime": "2025-01-01 00:00:00",
            "duration": 198.44
          }
        ]
      }
    }
    ```
  </TabItem>
  <TabItem value="text" label="文本生成完成回调">
    ```json
    {
      "code": 200,
      "msg": "文本生成完成。",
      "data": {
        "callbackType": "text",
        "task_id": "2fac****9f72",
        "data": []
      }
    }
    ```
  </TabItem>
  <TabItem value="error" label="失败回调">
    ```json
    {
      "code": 501,
      "msg": "音频生成失败。",
      "data": {
        "callbackType": "error",
        "task_id": "2fac****9f72",
        "data": []
      }
    }
    ```
  </TabItem>
</Tabs>

## 状态码说明

### `code` (integer, required)
回调状态码，表示任务处理结果：

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 - 请求已成功处理 |
| 400 | 验证错误 - 歌词包含受版权保护的内容 |
| 408 | 超出限制 - 超时 |
| 413 | 冲突 - 上传的音频与现有艺术作品匹配 |
| 500 | 服务器错误 - 处理请求时发生意外错误 |
| 501 | 音频生成失败 |
| 531 | 服务器错误 - 抱歉，由于问题生成失败。您的积分已退还。请重试 |

### `msg` (string, required)
状态消息，提供详细的状态描述

### `data.callbackType` (string, required)
回调类型，表示生成阶段：
- **text**: 文本生成完成
- **first**: 第一首完成
- **complete**: 全部完成
- **error**: 生成失败

### `data.task_id` (string, required)
任务 ID，与您提交任务时返回的 taskId 一致

### `data.data` (array, required)
生成的音乐数组。文本回调或失败时为空。

### `data.data[].id` (string)
音乐唯一标识

### `data.data[].audio_url` (string)
音频文件 URL，用于下载

### `data.data[].stream_audio_url` (string)
流式音频 URL，用于实时播放

### `data.data[].image_url` (string)
封面图片 URL

### `data.data[].prompt` (string)
使用的生成提示词/歌词

### `data.data[].model_name` (string)
使用的模型名称（如 "chirp-v3-5"）

### `data.data[].title` (string)
音乐标题

### `data.data[].tags` (string)
音乐标签/风格

### `data.data[].createTime` (string)
创建时间戳

### `data.data[].duration` (number)
音频时长（秒）

## 回调接收示例

以下是用流行编程语言接收回调的示例代码：

<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const express = require('express');
    const app = express();

    app.use(express.json());

    app.post('/suno-extend-callback', (req, res) => {
      const { code, msg, data } = req.body;
      
      console.log('收到 Suno 音乐扩展回调:', {
        taskId: data.task_id,
        callbackType: data.callbackType,
        status: code,
        message: msg
      });
      
      if (code === 200) {
        // ... 处理逻辑 ...
      }
      
      res.status(200).json({ status: 'received' });
    });

    app.listen(3000, () => {
      console.log('回调服务器运行在端口 3000');
    });
    ```
  </TabItem>
</Tabs>

## 最佳实践

:::tip[]
### 回调 URL 配置建议

1. **使用 HTTPS**: 确保回调 URL 使用 HTTPS 协议，保证数据传输安全
2. **验证来源**: 在回调处理中验证请求来源的合法性
3. **幂等处理**: 同一个 task_id 可能收到多次回调，确保处理逻辑是幂等的
4. **快速响应**: 回调处理应尽快返回 200 状态码，避免超时
5. **异步处理**: 复杂的业务逻辑应异步处理，避免阻塞回调响应
6. **处理多次回调**: 准备接收同一任务的 text、first、complete 回调
7. **扩展管理**: 妥善管理扩展后的音频文件和元数据
:::

:::warning[]
### 重要提醒

- 回调 URL 必须是公网可访问的地址
- 服务器必须在 15 秒内响应，否则会被认为是超时
- 如果连续 3 次重试失败，系统将停止发送回调
- 您可能收到同一任务的多次回调（text → first → complete）
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 适当处理版权和冲突错误（代码 400, 413）
- 某些服务器错误会自动退还积分（代码 531）
- 扩展后的音频时长通常会比原音频更长
:::

## 故障排查

如果您没有收到回调通知，请检查以下几点：

<details>
  <summary>网络连接问题</summary>
  - 确认回调 URL 可以从公网访问
  - 检查防火墙设置，确保入站请求没有被阻止
  - 验证域名解析是否正确
</details>

<details>
  <summary>服务器响应问题</summary>
  - 确保服务器在 15 秒内返回 HTTP 200 状态码
  - 检查服务器日志中的错误信息
  - 验证接口路径和 HTTP 方法是否正确
</details>

<details>
  <summary>内容格式问题</summary>
  - 确认接收到的 POST 请求体是 JSON 格式
  - 检查 Content-Type 是否为 application/json
  - 验证 JSON 解析是否正确
</details>

<details>
  <summary>音频处理问题</summary>
  - 确认音频 URL 可以正常访问
  - 检查音频下载权限和网络连接
  - 验证音频保存路径和权限
  - 适当处理常规和流式音频 URL
  - 在同一回调中处理多个音频扩展
</details>

## 替代方案

如果无法使用回调机制，您也可以使用轮询方式：

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/suno-api/get-music-details"
>
 使用获取音乐详情端点定期查询任务状态。建议每30秒查询一次。
</Card>

