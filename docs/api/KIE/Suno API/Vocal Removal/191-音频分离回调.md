# 音频分离回调

当人声和乐器分离生成完成时，系统会调用此回调通知结果。


当您向Suno API提交人声分离任务时，可以使用 `callBackUrl` 参数设置回调URL。任务完成时，系统将自动向您指定的地址推送结果。

## 回调机制概述

:::info[]
回调机制消除了轮询API获取任务状态的需要。系统会主动向您的服务器推送任务完成结果。
:::

:::tip[]
**Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统将在以下情况发送回调通知：
- 人声分离任务成功完成
- 人声分离任务失败
- 任务处理过程中发生错误

### 回调方式

- **HTTP方法**: POST
- **内容类型**: application/json
- **超时设置**: 15秒

## 回调请求格式

任务完成时，系统将根据您选择的分离类型向您的 `callBackUrl` 发送POST请求。不同的分离类型对应不同的回调数据结构：

### separate_vocal 类型回调

<Tabs>
  <TabItem value="success" label="成功回调 - separate_vocal">
    ```json
    {
      "code": 200,
      "msg": "vocal Removal generated successfully.",
      "data": {
        "task_id": "3e63b4cc88d52611159371f6af5571e7",
        "vocal_removal_info": {
          "instrumental_url": "https://file.aiquickdraw.com/s/d92a13bf-c6f4-4ade-bb47-f69738435528_Instrumental.mp3",
          "origin_url": "",
          "vocal_url": "https://file.aiquickdraw.com/s/3d7021c9-fa8b-4eda-91d1-3b9297ddb172_Vocals.mp3"
        }
      }
    }
    ```
  </TabItem>
  <TabItem value="failure" label="失败回调 - separate_vocal">
    ```json
    {
      "code": 501,
      "msg": "人声分离失败",
      "data": {
        "task_id": "3e63b4cc88d52611159371f6af5571e7",
        "vocal_removal_info": null
      }
    }
    ```
  </TabItem>
</Tabs>

### split_stem 类型回调

<Tabs>
  <TabItem value="success" label="成功回调 - split_stem">
    ```json
    {
      "code": 200,
      "msg": "vocal Removal generated successfully.",
      "data": {
        "task_id": "e649edb7abfd759285bd41a47a634b10",
        "vocal_removal_info": {
          "origin_url": "",
          "vocal_url": "https://file.aiquickdraw.com/s/07420749-29a2-4054-9b62-e6a6f8b90ccb_Vocals.mp3",
          "backing_vocals_url": "https://file.aiquickdraw.com/s/aadc51a3-4c88-4c8e-a4c8-e867c539673d_Backing_Vocals.mp3"
          // ... 其他乐器 URL ...
        }
      }
    }
    ```
  </TabItem>
  <TabItem value="failure" label="失败回调 - split_stem">
    ```json
    {
      "code": 501,
      "msg": "乐器分离失败",
      "data": {
        "task_id": "e649edb7abfd759285bd41a47a634b10",
        "vocal_removal_info": null
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

### `data.task_id` (string, required)
任务ID，与您提交任务时返回的task_id一致

### `data.vocal_removal_info` (object)
人声分离结果信息，成功时返回。返回的字段取决于分离类型（type参数）

## separate_vocal 类型回调字段

### `data.vocal_removal_info.instrumental_url` (string)
伴奏部分音频URL（separate_vocal类型专有）

### `data.vocal_removal_info.origin_url` (string)
原始音频URL

### `data.vocal_removal_info.vocal_url` (string)
人声部分音频URL

## split_stem 类型回调字段

### `data.vocal_removal_info.origin_url` (string)
原始音频URL

### `data.vocal_removal_info.vocal_url` (string)
主人声音频URL

### `data.vocal_removal_info.backing_vocals_url` (string)
背景人声音频URL（split_stem类型专有）

### `data.vocal_removal_info.drums_url` (string)
鼓声部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.bass_url` (string)
贝斯部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.guitar_url` (string)
吉他部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.keyboard_url` (string)
键盘部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.percussion_url` (string)
打击乐部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.strings_url` (string)
弦乐部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.synth_url` (string)
合成器部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.fx_url` (string)
效果器部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.brass_url` (string)
铜管部分音频URL（split_stem类型专有）

### `data.vocal_removal_info.woodwinds_url` (string)
木管部分音频URL（split_stem类型专有）

## 回调接收示例

以下是常用编程语言接收回调的示例代码：

<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const express = require('express');
    const app = express();

    app.use(express.json());

    app.post('/suno-vocal-separation-callback', (req, res) => {
      const { code, msg, data } = req.body;
      // ... 处理逻辑 ...
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
6. **分类处理**: 根据不同的分离类型处理不同的音频文件结构
7. **批量下载**: split_stem类型产生多个文件，建议批量下载并按类型整理
:::

:::warning[]
### 重要提醒

- 回调URL必须是公开可访问的地址
- 服务器必须在15秒内响应，否则将被认为超时
- 如果连续3次重试失败，系统将停止发送回调
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 人声分离生成的音频文件URL可能有时效性，建议及时下载保存
- 注意检查各个音频部分的URL是否可用，某些乐器分离可能为空
- separate_vocal和split_stem类型返回的字段不同，请根据请求时的type参数处理相应字段
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
  - 确认各个音频文件URL是否可访问
  - 检查文件下载权限和网络连接
  - 验证文件保存路径和权限
  - 注意某些乐器分离结果可能为空的情况
  - 注意separate_vocal和split_stem类型的字段差异
</details>

## 替代方案

如果无法使用回调机制，您也可以使用轮询方式：

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/suno-api/get-vocal-separation-details"
>
 使用获取人声分离详情端点定期查询任务状态。我们建议每30秒查询一次。
</Card>
