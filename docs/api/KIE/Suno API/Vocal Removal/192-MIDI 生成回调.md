# MIDI 生成回调

当从分离音频生成 MIDI 完成时,系统将调用此回调。

当您向 Suno API 提交 MIDI 生成任务时,可以使用 `callBackUrl` 参数设置回调 URL。系统将在任务完成时自动将结果推送到您指定的地址。

## 回调机制概述

:::info[]
回调机制无需轮询 API 查询任务状态。系统将主动向您的服务器推送任务完成结果。
:::

:::tip[]
**Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统将在以下情况发送回调通知:
- MIDI 生成任务成功完成
- MIDI 生成任务失败
- 任务处理过程中发生错误

### 回调方法

- **HTTP 方法**: POST
- **Content Type**: application/json
- **超时设置**: 15 秒

## 回调请求格式

当任务完成时,系统将向您的 `callBackUrl` 发送 POST 请求:

<Tabs>
  <TabItem value="success" label="成功回调">
    ```json
    {
      "code": 200,
      "msg": "success",
      "data": {
        "taskId": "5c79****be8e",
        "state": "complete",
        "instruments": [
          {
            "name": "Drums",
            "notes": [
              {
                "pitch": 73,
                "start": "0.036458333333333336",
                "end": "0.18229166666666666",
                "velocity": 1
              },
              {
                "pitch": 61,
                "start": 0.046875,
                "end": "0.19270833333333334",
                "velocity": 1
              }
            ]
          }
        ]
      }
    }
    ```
  </TabItem>
  <TabItem value="failure" label="失败回调">
    ```json
    {
      "code": 500,
      "msg": "MIDI generation failed",
      "data": {
        "taskId": "5c79****be8e"
      }
    }
    ```
  </TabItem>
</Tabs>

## 状态码说明

### `code` (integer, required)
回调状态码,指示任务处理结果:

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 - MIDI 生成已成功完成 |
| 500 | 内部错误 - 请重试或联系技术支持 |

### `msg` (string, required)
状态消息,提供详细的状态描述

### `taskId` (string, required)
任务 ID,与您提交任务时返回的 taskId 一致

### `data` (object)
MIDI 生成结果信息,成功时返回

## 成功响应字段

### `data.state` (string)
处理状态。成功时值为 `complete`

### `data.instruments` (array)
检测到的乐器数组及其 MIDI 音符数据

<details>
  <summary>乐器对象属性</summary>
  
  - **name** (string): 乐器名称(例如:"Drums"、"Electric Bass (finger)"、"Acoustic Grand Piano")
  - **notes** (array): 该乐器的 MIDI 音符数组
  
  <details>
    <summary>音符对象属性</summary>
    
    - **pitch** (integer): MIDI 音符编号(0-127)。中央 C = 60。[MIDI 音符参考](https://inspiredacoustics.com/en/MIDI_note_numbers_and_center_frequencies)
    - **start** (number | string): 音符起始时间,从音频开头算起的秒数
    - **end** (number | string): 音符结束时间,从音频开头算起的秒数
    - **velocity** (number): 音符力度/强度(0-1 范围)。1 = 最大力度
  </details>
</details>

## 回调接收示例

以下是使用主流编程语言接收回调的示例代码:

<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const express = require('express');
    const app = express();

    app.use(express.json());

    app.post('/suno-midi-callback', (req, res) => {
      const { code, msg, taskId, data } = req.body;
      
      console.log('收到 MIDI 生成回调:', {
        taskId: taskId,
        status: code,
        message: msg
      });
      
      if (code === 200) {
        // 任务成功完成
        console.log('MIDI 生成完成');
        
        if (data && data.instruments) {
          console.log(`检测到 ${data.instruments.length} 个乐器`);
          
          data.instruments.forEach(instrument => {
            console.log(`\n乐器: ${instrument.name}`);
            console.log(`  音符数量: ${instrument.notes.length}`);
            
            // 处理每个音符
            instrument.notes.forEach((note, idx) => {
              if (idx < 3) { // 显示前3个音符作为示例
                console.log(`  音符 ${idx + 1}: 音高 ${note.pitch}, ` +
                           `起始 ${note.start}秒, 结束 ${note.end}秒, ` +
                           `力度 ${note.velocity}`);
              }
            });
          });
        }
        
      } else {
        // 任务失败
        console.log('MIDI 生成失败:', msg);
      }
      
      // 返回 200 状态码确认收到回调
      res.status(200).json({ status: 'received' });
    });

    app.listen(3000, () => {
      console.log('回调服务器运行在 3000 端口');
    });
    ```
  </TabItem>
  <TabItem value="python" label="Python">
    ```python
    from flask import Flask, request, jsonify
    import json

    app = Flask(__name__)

    @app.route('/suno-midi-callback', methods=['POST'])
    def handle_callback():
        data = request.json
        
        code = data.get('code')
        msg = data.get('msg')
        taskId = data.get('taskId')
        callback_data = data.get('data', {})
        
        print(f"收到 MIDI 生成回调: {taskId}, 状态: {code}, 消息: {msg}")
        
        if code == 200:
            # 任务成功完成
            print("MIDI 生成完成")
            
            if callback_data and 'instruments' in callback_data:
                instruments = callback_data['instruments']
                print(f"检测到 {len(instruments)} 个乐器")
                
                for instrument in instruments:
                    name = instrument.get('name')
                    notes = instrument.get('notes', [])
                    print(f"\n乐器: {name}")
                    print(f"  音符数量: {len(notes)}")
            
            # 保存 MIDI 数据到文件
            with open(f"midi_{taskId}.json", "w") as f:
                json.dump(callback_data, f, indent=2)
            print(f"MIDI 数据已保存到 midi_{taskId}.json")
            
        else:
            # 任务失败
            print(f"MIDI 生成失败: {msg}")
        
        # 返回 200 状态码确认收到回调
        return jsonify({'status': 'received'}), 200

    if __name__ == '__main__':
        app.run(host='0.0.0.0', port=3000)
    ```
  </TabItem>
  <TabItem value="php" label="PHP">
    ```php
    <?php
    header('Content-Type: application/json');
    // ... PHP 示例代码 ...
    ?>
    ```
  </TabItem>
</Tabs>

## 最佳实践

:::tip[]
### 回调 URL 配置建议

1. **使用 HTTPS**: 确保回调 URL 使用 HTTPS 协议以保证数据传输安全
2. **验证来源**: 在回调处理中验证请求来源的合法性
3. **幂等处理**: 同一 taskId 可能收到多次回调,确保处理逻辑是幂等的
4. **快速响应**: 回调处理应快速返回 200 状态码以避免超时
5. **异步处理**: 复杂的业务逻辑(如 MIDI 文件转换)应异步处理
6. **处理缺失乐器**: 不是所有乐器都会被检测到 - 优雅地处理空的或缺失的乐器数组
7. **存储原始数据**: 保存完整的 JSON 响应以供未来参考和重新处理
:::

:::warning[]
### 重要提醒

- 回调 URL 必须可从公网访问
- 服务器必须在 15 秒内响应,否则将被视为超时
- 如果连续 3 次重试失败,系统将停止发送回调
- 请确保回调处理逻辑的稳定性,避免因异常导致回调失败
- MIDI 数据保留 14 天 - 如需长期保存请及时下载保存
- 检测到的乐器数量和类型取决于音频内容
- 音符时间(start/end)可能是字符串 or 数字 - 需要处理这两种类型
:::

## 故障排查

如果您没有收到回调通知,请检查以下内容:

<details>
  <summary>网络连接问题</summary>
  - 确认回调 URL 可从公网访问
  - 检查防火墙设置,确保入站请求未被阻止
  - 验证域名解析正确
</details>

<details>
  <summary>服务器响应问题</summary>
  - 确保服务器在 15 秒内返回 HTTP 200 状态码
  - 检查服务器日志是否有错误消息
  - 验证端点路径和 HTTP 方法正确
</details>

<details>
  <summary>内容格式问题</summary>
  - 确认收到的 POST 请求体为 JSON 格式
  - 检查 Content-Type 是否为 application/json
  - 验证 JSON 解析正确
  - 处理时间值的字符串和数字两种类型
</details>

<details>
  <summary>数据处理问题</summary>
  - 某些乐器可能有空的音符数组
  - 并非所有音频都会检测到所有乐器类型
  - 验证原始人声分离使用的是 `split_stem` 类型(而非 `separate_vocal`)
  - 检查源 taskId 是否来自成功完成的分离任务
</details>

## 替代方案

如果您无法使用回调机制,也可以使用轮询方式:

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/suno-api/get-midi-details"
>
 使用获取 MIDI 生成详情接口定期查询任务状态。我们建议每 10-30 秒查询一次。
</Card>
