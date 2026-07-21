# 生成音乐回调

当音频生成完成时，系统会调用此回调通知结果。


当您向Suno API提交音乐生成任务时，可以使用 `callBackUrl` 参数设置回调URL。任务完成时，系统将自动向您指定的地址推送结果。

## 回调机制概述

:::info[]
回调机制消除了轮询API获取任务状态的需要。系统会主动向您的服务器推送任务完成结果。
:::

:::tip []
**Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统将在以下情况发送回调通知：
- 音乐生成任务成功完成
- 音乐生成任务失败
- 任务处理过程中发生错误

### 回调方式

- **HTTP方法**: POST
- **内容类型**: application/json
- **超时设置**: 15秒

## 回调请求格式

任务完成时，系统将以下格式向您的 `callBackUrl` 发送POST请求：

<Tabs>
  <TabItem value="complete" label="成功回调">
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
  <TabItem value="error" label="失败回调">
    ```json
    {
      "code": 501,
      "msg": "...",
      "data": {
        "callbackType": "error",
        "task_id": "2fac****9f72",
        "data": null
      }
    }
    ```
  </TabItem>
</Tabs>

## 状态码说明

### `code` (integer, required)
回调状态码，表示任务处理结果：

| 状态码 | 描述 |
|--------|------|
| 200 | 成功 - 请求已成功处理 |
| 400 | 验证错误 - 歌词包含受版权保护的内容 |
| 408 | 超出限制 - 超时 |
| 413 | 冲突 - 上传的音频与现有艺术作品匹配 |
| 500 | 服务器错误 - 处理请求时发生意外错误 |
| 501 | 音频生成失败 |
| 531 | 服务器错误 - 抱歉，由于问题生成失败。您的积分已退还。请重试 |

### `msg` (string, required)
状态消息，提供更详细的状态描述

### `data.callbackType` (string, required)
回调类型：
- **text** - 文本生成完成
- **first** - 第一首生成完成
- **complete** - 全部生成完成
- **error** - 生成失败

### `data.task_id` (string, required)
任务ID，与您提交任务时返回的task_id一致

### `data.data` (array)
生成的音频数据数组，成功时返回

### `data.data[].id` (string)
音频唯一标识

### `data.data[].audio_url` (string)
音频文件URL

### `data.data[].stream_audio_url` (string)
流式音频URL

### `data.data[].image_url` (string)
封面图片URL

### `data.data[].prompt` (string)
生成提示词/歌词

### `data.data[].model_name` (string)
使用的模型名称

### `data.data[].title` (string)
音乐标题

### `data.data[].tags` (string)
音乐标签

### `data.data[].createTime` (string)
创建时间

### `data.data[].duration` (number)
音频时长（秒）

## 回调接收示例

以下是常用编程语言接收回调的示例代码：

<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const express = require('express');
    const app = express();

    app.use(express.json());

    app.post('/suno-callback', (req, res) => {
      const { code, msg, data } = req.body;
      
      console.log('收到回调:', {
        taskId: data.task_id,
        status: code,
        message: msg,
        callbackType: data.callbackType
      });
      
      if (code === 200) {
        // ... 处理逻辑 ...
      }
      
      res.status(200).json({ status: 'received' });
    });

    app.listen(3000, () => {
      console.log('回调服务器运行在端口3000');
    });
    ```
  </TabItem>
  <TabItem value="python" label="Python">
    ```python
    from flask import Flask, request, jsonify
    import json

    app = Flask(__name__)

    @app.route('/suno-callback', methods=['POST'])
    def handle_callback():
        data = request.json
        # ... 处理逻辑 ...
        return jsonify({'status': 'received'}), 200

    if __name__ == '__main__':
        app.run(host='0.0.0.0', port=3000)
    ```
  </TabItem>
</Tabs>

## 最佳实践

:::tip[]
### 回调URL配置建议

1. **使用HTTPS**: 确保回调URL使用HTTPS协议以保证数据传输安全
2. **验证来源**: 在回调处理中验证请求来源的合法性
3. **幂等处理**: 同一task_id可能收到多次回调，确保处理逻辑是幂等的
4. **快速响应**: 回调处理应尽快返回200状态码以避免超时
5. **异步处理**: 复杂的业务逻辑应异步处理以避免阻塞回调响应
6. **状态跟踪**: 根据callbackType区分不同的生成阶段，合理安排业务逻辑
:::

:::warning[]
### 重要提醒

- 回调URL必须是公开可访问的地址
- 服务器必须在15秒内响应，否则将被认为超时
- 如果连续3次重试失败，系统将停止发送回调
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 注意处理不同callbackType的回调，特别是complete类型的最终结果
:::

## 故障排查

如果您未收到回调通知，请检查以下内容：

<details>
  <summary>网络连接问题</summary>
  - 确认回调URL可以从公网访问
  - 检查防火墙设置，确保入站请求未被阻止
  - 验证域名解析是否正确
</details>

<details>
  <summary>服务器响应问题</summary>
  - 确保服务器在15秒内返回HTTP 200状态码
  - 检查服务器日志是否有错误消息
  - 验证接口路径和HTTP方法是否正确
</details>

<details>
  <summary>内容格式问题</summary>
  - 确认收到的POST请求体为JSON格式
  - 检查Content-Type是否为application/json
  - 验证JSON解析是否正确
</details>

<details>
  <summary>回调类型处理</summary>
  - 确认正确处理不同的callbackType
  - 检查是否遗漏了complete类型的最终结果处理
  - 验证音频数据解析是否正确
</details>

## 替代方案

如果您无法使用回调机制，也可以使用轮询方式：

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/suno-api/get-music-details"
>
 使用获取音乐详情端点定期查询任务状态。建议每30秒查询一次。
</Card>

