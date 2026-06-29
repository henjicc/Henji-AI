# 替换音乐分区回调

当音乐分区替换完成时，系统会调用此回调通知结果。


当您向Suno API提交音乐分区替换任务时，可以使用 `callBackUrl` 参数设置回调URL。任务完成时，系统将自动向您指定的地址推送结果。

## 回调机制概述

:::info[]
回调机制消除了轮询API获取任务状态的需要。系统会主动向您的服务器推送任务完成结果。
:::

:::tip[]
**Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统将在以下情况发送回调通知：
- 音乐分区替换任务成功完成
- 音乐分区替换任务失败
- 任务处理过程中发生错误

### 回调方式

- **HTTP方法**: POST
- **内容类型**: application/json
- **超时设置**: 15秒

## 回调请求格式

任务完成时，系统将以下格式向您的 `callBackUrl` 发送POST请求：

<Tabs>
  <TabItem value="success" label="成功回调">
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
            "prompt": "[Verse] 替换后的音乐内容",
            "model_name": "chirp-v3-5",
            "title": "替换后的标题",
            "tags": "electrifying, rock",
            "createTime": "2025-01-01 00:00:00",
            "duration": 198.44
          }
        ]
      }
    }
    ```
  </TabItem>
  <TabItem value="failure" label="失败回调">
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
| 400 | 验证错误 - 参数验证失败 |
| 408 | 超出限制 - 超时 |
| 500 | 服务器错误 - 处理请求时发生意外错误 |
| 501 | 音频生成失败 |
| 531 | 服务器错误 - 抱歉，由于问题生成失败。您的积分已退还。请重试 |

### `msg` (string, required)
状态消息，提供更详细的状态描述

## 响应数据字段

### `data` (object, required)
包含回调数据的容器对象

### `data.callbackType` (string, required)
回调类型，表示当前回调阶段：

| 类型 | 描述 |
|------|------|
| complete | 替换任务全部完成 |
| error | 任务失败或发生错误 |

### `data.task_id` (string, required)
任务唯一标识符，用于追踪和查询

### `data.data` (array)
生成的音乐数据数组。成功时包含替换后的音乐详细信息，失败时为 null

<details>
  <summary>音乐对象属性</summary>
  
  - **id** (string): 音乐片段的唯一标识符
  - **audio_url** (string): 替换后音乐的完整URL，可直接下载
  - **stream_audio_url** (string): 替换后音乐的流媒体URL，用于在线播放
  - **image_url** (string): 替换后音乐的封面图片URL
  - **prompt** (string): 用于生成替换片段的提示词
  - **model_name** (string): 使用的AI模型名称（例如 chirp-v3-5）
  - **title** (string): 替换后的音乐标题
  - **tags** (string): 替换片段的音乐风格标签
  - **createTime** (string): 替换任务创建时间（格式：YYYY-MM-DD HH:MM:SS）
  - **duration** (number): 替换后音乐的总时长（秒）
</details>

## 实现回调处理器

以下示例展示如何实现回调处理器：

<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const express = require('express');
    const app = express();

    app.use(express.json());

    app.post('/suno-replace-section-callback', (req, res) => {
      const { code, msg, data } = req.body;
      
      console.log('收到替换分区回调:', {
        taskId: data.task_id,
        type: data.callbackType,
        status: code
      });
      
      if (code === 200 && data.callbackType === 'complete') {
        // ... 处理逻辑 ...
      }
      
      res.status(200).json({ status: 'received' });
    });

    app.listen(3000, () => {
      console.log('回调服务器运行在端口 3000');
    });
    ```
  </TabItem>
  <TabItem value="python" label="Python Flask">
    ```python
    from flask import Flask, request, jsonify
    import json

    app = Flask(__name__)

    @app.route('/suno-replace-section-callback', methods=['POST'])
    def handle_replace_section_callback():
        data = request.json
        # ... 处理逻辑 ...
        return jsonify({'status': 'received'}), 200

    if __name__ == '__main__':
        app.run(host='0.0.0.0', port=3000)
    ```
  </TabItem>
</Tabs>

## 回调安全建议

:::warning[]
为确保回调的安全性，建议实施以下措施：

1. **验证请求来源**：检查请求IP或使用签名验证
2. **使用HTTPS**：确保回调URL使用HTTPS协议
3. **实现幂等性**：处理可能的重复回调
4. **超时处理**：确保在15秒内响应回调请求
5. **错误日志**：记录所有回调详情以便调试
:::

## 常见问题

<details>
  <summary>为什么没有收到回调？</summary>
  可能的原因：
  - 回调URL不可访问（检查防火墙设置）
  - 回调处理器响应超时（超过15秒）
  - URL格式错误或使用了HTTP而非HTTPS
  - 服务器返回了非200状态码
</details>

<details>
  <summary>如何处理回调重试？</summary>
  系统可能会在以下情况重试回调：
  - 回调URL返回非200状态码
  - 请求超时
  - 网络错误

  建议：
  - 实现幂等性处理，使用task_id识别重复回调
  - 快速响应200状态码，然后异步处理数据
</details>

## 替代方案：轮询查询

如果您不使用回调，也可以通过轮询方式查询任务状态：

<Card
  title="查询任务状态"
  icon="lucide-radar"
  href="/cn/suno-api/get-music-details"
>
 使用获取音乐详情接口定期查询任务状态，建议每30秒查询一次。
</Card>
## 下一步

<Card
  title="替换音乐分区"
  icon="lucide-radar"
  href="/cn/suno-api/replace-section"
>
 了解如何使用替换分区接口
</Card>
<Card
  title="获取音乐详情"
  icon="lucide-radar"
  href="/cn/suno-api/get-music-details"
>
 查询替换任务的状态和结果
</Card>
