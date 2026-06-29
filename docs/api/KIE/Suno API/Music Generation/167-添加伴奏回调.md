# 添加伴奏回调

当伴奏生成完成时，系统会调用此回调通知结果。


当您向Suno API的 `/api/v1/generate/add-instrumental` 接口提交伴奏生成任务时，可以使用 `callBackUrl` 参数设置回调URL。任务完成时，系统将自动向您指定的地址推送结果。

## 相关API接口

此回调由以下API接口触发：

[**添加伴奏接口**](/cn/suno-api/add-instrumental)
**POST** `/api/v1/generate/add-instrumental` - 基于上传的音频文件生成伴奏音乐

## 回调机制概述

:::tip[]
**Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

:::info[]
回调机制消除了轮询API获取任务状态的需要。系统会主动向您的服务器推送任务完成结果。
:::

### 回调时机

系统将在以下情况发送回调通知：
- 文本生成完成（callbackType: "text"）
- 第一个音频轨道生成完成（callbackType: "first"）
- 所有音频轨道生成完成（callbackType: "complete"）
- 伴奏生成任务失败
- 任务处理过程中发生错误

### 回调方式

- **HTTP方法**: POST
- **内容类型**: application/json
- **超时设置**: 15秒

## 回调请求格式

当任务进行或完成时，系统将以下格式向您的 `callBackUrl` 发送POST请求：

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
            "model_name": "chirp-v4-5",
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
  <TabItem value="first" label="第一首成功回调">
    ```json
    {
      "code": 200,
      "msg": "First track generated successfully.",
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
            "model_name": "chirp-v4-5",
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
  <TabItem value="text" label="文本生成回调">
    ```json
    {
      "code": 200,
      "msg": "Text generation completed successfully.",
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
      "msg": "Audio generation failed",
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

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 - 请求已成功处理 |
| 400 | 验证错误 - 歌词包含受版权保护的内容 |
| 408 | 超出限制 - 超时 |
| 413 | 冲突 - 上传的音频与现有艺术作品匹配 |
| 500 | 服务器错误 - 处理请求时发生意外错误 |
| 501 | 音频生成失败 |
| 531 | 服务器错误 - 抱歉，由于问题生成失败。您的积分已退还。请重试 |

## 回调接收示例

以下是常用编程语言的回调接收示例代码：

<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const express = require('express');
    const app = express();

    app.use(express.json());

    app.post('/instrumental-callback', (req, res) => {
      const { code, msg, data } = req.body;
      
      console.log('收到伴奏回调:', {
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
      console.log('伴奏回调服务器运行在端口3000');
    });
    ```
  </TabItem>
</Tabs>

## 最佳实践

:::tip[]
### 回调URL配置建议

1. **使用HTTPS**: 确保您的回调URL使用HTTPS协议，保证数据传输安全
2. **验证来源**: 在回调处理中验证请求来源的合法性
3. **幂等处理**: 同一个task_id可能会收到多次回调，确保处理逻辑具有幂等性
4. **快速响应**: 回调处理应尽快返回200状态码，避免超时
5. **异步处理**: 复杂的业务逻辑应异步处理，避免阻塞回调响应
6. **阶段跟踪**: 根据callbackType区分不同生成阶段，合理安排业务逻辑
:::

:::warning[]
### 重要提醒

- 回调URL必须是公网可访问的地址
- 服务器必须在15秒内响应，否则将被认为超时
- 如果连续3次重试失败，系统将停止发送回调
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 注意处理不同callbackType的回调，特别是complete类型的最终结果
:::

## 替代方案

如果您无法使用回调机制，也可以使用轮询方式：

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/suno-api/get-music-details"
>
 使用获取音乐详情端点定期查询任务状态。建议每30秒查询一次。
</Card>
