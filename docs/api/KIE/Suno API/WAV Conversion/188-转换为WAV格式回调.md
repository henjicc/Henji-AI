# 转换为WAV格式回调

当WAV格式音频生成完成时，系统会调用此回调通知结果。


当您向Suno API提交WAV格式转换任务时，可以使用 `callBackUrl` 参数设置回调URL。任务完成时，系统将自动向您指定的地址推送结果。

## 回调机制概述

:::info[]
回调机制消除了轮询API获取任务状态的需要。系统会主动向您的服务器推送任务完成结果。
:::

:::tip[]
**Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统将在以下情况发送回调通知：
- WAV格式转换任务成功完成
- WAV格式转换任务失败
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
      "msg": "success",
      "data": {
        "audio_wav_url": "https://example.com/s/04e6****e727.wav",
        "task_id": "988e****c8d3"
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
        "audio_wav_url": null,
        "task_id": "988e****c8d3"
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
| 200 | 成功 - WAV格式转换成功完成 |
| 400 | 验证错误 - 输入参数错误或文件格式不支持 |
| 500 | 服务器错误 - 处理请求时发生意外错误 |
| 501 | 失败 - WAV格式转换失败 |

### `msg` (string, required)
状态消息，提供更详细的状态描述

### `data.task_id` (string, required)
任务ID，与您提交任务时返回的task_id一致

### `data.audio_wav_url` (string)
WAV格式音频文件URL，成功时返回可访问的下载链接

## 回调接收示例

以下是常用编程语言接收回调的示例代码：

<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const express = require('express');
    const app = express();

    app.use(express.json());

    app.post('/suno-wav-callback', (req, res) => {
      const { code, msg, data } = req.body;
      
      console.log('收到WAV转换回调:', {
        taskId: data.task_id,
        status: code,
        message: msg
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
</Tabs>

## 最佳实践

:::tip[]
### 回调URL配置建议

1. **使用HTTPS**: 确保回调URL使用HTTPS协议以保证数据传输安全
2. **验证来源**: 在回调处理中验证请求来源的合法性
3. **幂等处理**: 同一task_id可能收到多次回调，确保处理逻辑是幂等的
4. **快速响应**: 回调处理应尽快返回200状态码以避免超时
5. **异步处理**: 复杂的业务逻辑应异步处理以避免阻塞回调响应
6. **文件处理**: WAV文件下载和处理应在异步任务中进行，避免阻塞回调响应
:::

:::warning[]
### 重要提醒

- 回调URL必须是公开可访问的地址
- 服务器必须在15秒内响应，否则将被认为超时
- 如果连续3次重试失败，系统将停止发送回调
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- WAV文件URL可能有时效性，建议及时下载保存
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
  - 检查 Content-Type 是否为 application/json
  - 验证 JSON 解析是否正确
</details>

<details>
  <summary>文件处理问题</summary>
  - 确认WAV文件URL是否可访问
  - 检查文件下载权限和网络连接
  - 验证文件保存路径和权限
</details>

## 替代方案

如果您无法使用回调机制，也可以使用轮询方式：

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/suno-api/get-wav-details"
>
 使用获取WAV详情端点定期查询任务状态。我们建议每30秒查询一次。
</Card>
