# AI 视频生成回调

>当您向 Runway API 提交视频生成任务时，可以通过 `callBackUrl` 参数设置回调地址。任务完成后，系统会自动将结果推送到您指定的地址。

## 回调机制概述

:::note[]
回调机制避免了您需要轮询 API 查询任务状态，系统会主动推送任务完成结果到您的服务器。
:::

:::tip[]
  **Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统会在以下情况发送回调通知：

- AI 视频生成任务成功完成
- AI 视频生成任务失败
- 任务处理过程中发生错误

### 回调方式

- **HTTP 方法**: POST
- **内容类型**: application/json
- **超时设置**: 15 秒

## 回调请求格式

任务完成后，系统会向您的 `callBackUrl` 发送 POST 请求，格式如下：

<Tabs>
<TabItem value="success" label="成功回调">

```json
{
  "code": 200,
  "msg": "All generated successfully.",
  "data": {
    "task_id": "ee603959-debb-48d1-98c4-a6d1c717eba6",
    "video_id": "485da89c-7fca-4340-8c04-101025b2ae71",
    "video_url": "https://file.com/k/xxxxxxx.mp4",
    "image_url": "https://file.com/m/xxxxxxxx.png"
  }
}
```

</TabItem>
<TabItem value="failed" label="失败回调">

```json
{
  "code": 400,
  "msg": "检测到不当内容，请替换图像或视频。",
  "data": {
    "task_id": "ee603959-debb-48d1-98c4-a6d1c717eba6",
    "video_id": "",
    "video_url": "",
    "image_url": ""
  }
}
```

</TabItem>
</Tabs>

## 状态码说明

### 参数说明

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `code` | integer | 是 | 回调状态码，表示任务处理结果 |
| `msg` | string | 是 | 状态消息，提供详细的状态描述 |
| `data.task_id` | string | 是 | 任务 ID，与您提交任务时返回的 taskId 一致 |
| `data.video_id` | string | 是 | 生成的视频 ID，用于标识和追踪 |
| `data.video_url` | string | 否 | 可访问的视频 URL，**有效期 14 天**。失败时为空 |
| `data.image_url` | string | 否 | 生成视频的封面图片 URL。失败时为空 |

### 状态码详情

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 - 视频生成完成 |
| 400 | 客户端错误 - 不当内容、格式错误、配额限制或其他客户端问题 |
| 500 | 服务器错误 - 视频生成过程中的内部服务器错误 |

### 常见错误消息

- "检测到不当内容，请替换图像或视频。"
- "图像格式不正确。"
- "请稍后重试。您可以升级到标准会员以立即开始生成。"
- "已达到并发生成限制。"
- "不支持的宽度或高度，请调整尺寸后重试。"
- "您的提示词被我们的AI审核器捕获。请调整后重试！"

## 回调接收示例

以下是用流行编程语言接收回调的示例代码：

<Tabs>
<TabItem value="javascript" label="Node.js">

```javascript
const express = require('express');
const fs = require('fs');
const https = require('https');
const path = require('path');
const app = express();

app.use(express.json());

app.post('/runway-video-callback', (req, res) => {
  const { code, msg, data } = req.body;
  
  console.log('收到 Runway 视频生成回调:', {
    taskId: data.task_id,
    videoId: data.video_id,
    status: code,
    message: msg
  });
  
  if (code === 200) {
    // 任务成功完成
    console.log('Runway 视频生成成功完成');
    
    const { task_id, video_id, video_url, image_url } = data;
    
    console.log(`视频 URL: ${video_url}`);
    console.log(`封面图片 URL: ${image_url}`);
    console.log('注意：视频 URL 有效期为 14 天');
    
    // 下载视频文件
    if (video_url) {
      downloadFile(video_url, `runway_video_${task_id}.mp4`)
        .then(() => console.log('视频下载成功'))
        .catch(err => console.error('视频下载失败:', err));
    }
    
    // 下载封面图片
    if (image_url) {
      downloadFile(image_url, `runway_cover_${task_id}.png`)
        .then(() => console.log('封面图片下载成功'))
        .catch(err => console.error('封面图片下载失败:', err));
    }
    
  } else {
    // 任务失败
    console.log('Runway 视频生成失败:', msg);
    
    // 处理特定错误类型
    if (code === 400) {
      console.log('客户端错误 - 检查内容、格式或配额');
    } else if (code === 500) {
      console.log('服务器错误 - 可能需要重试');
    }
  }
  
  // 返回 200 状态码确认收到回调
  res.status(200).json({ status: 'received' });
});

// 辅助函数：下载文件
function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filename);
    
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    }).on('error', reject);
  });
}

app.listen(3000, () => {
  console.log('回调服务器运行在端口 3000');
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
from flask import Flask, request, jsonify
import requests
import os

app = Flask(__name__)

@app.route('/runway-video-callback', methods=['POST'])
def handle_callback():
    data = request.json
    
    code = data.get('code')
    msg = data.get('msg')
    callback_data = data.get('data', {})
    task_id = callback_data.get('task_id')
    video_id = callback_data.get('video_id')
    video_url = callback_data.get('video_url')
    image_url = callback_data.get('image_url')
    
    print(f"收到 Runway 视频生成回调:")
    print(f"任务 ID: {task_id}, 视频 ID: {video_id}")
    print(f"状态: {code}, 消息: {msg}")
    
    if code == 200:
        # 任务成功完成
        print("Runway 视频生成成功完成")
        
        print(f"视频 URL: {video_url}")
        print(f"封面图片 URL: {image_url}")
        print("注意：视频 URL 有效期为 14 天")
        
        # 下载视频文件
        if video_url:
            try:
                video_filename = f"runway_video_{task_id}.mp4"
                download_file(video_url, video_filename)
                print(f"视频已下载为 {video_filename}")
            except Exception as e:
                print(f"视频下载失败: {e}")
        
        # 下载封面图片
        if image_url:
            try:
                image_filename = f"runway_cover_{task_id}.png"
                download_file(image_url, image_filename)
                print(f"封面图片已下载为 {image_filename}")
            except Exception as e:
                print(f"封面图片下载失败: {e}")
                
    else:
        # 任务失败
        print(f"Runway 视频生成失败: {msg}")
        
        # 处理特定错误类型
        if code == 400:
            print("客户端错误 - 检查内容、格式或配额")
        elif code == 500:
            print("服务器错误 - 可能需要重试")
    
    # 返回 200 状态码确认收到回调
    return jsonify({'status': 'received'}), 200

def download_file(url, filename):
    """从 URL 下载文件并保存到本地"""
    response = requests.get(url, stream=True)
    response.raise_for_status()
    
    os.makedirs('downloads', exist_ok=True)
    filepath = os.path.join('downloads', filename)
    
    with open(filepath, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3000)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
<?php
header('Content-Type: application/json');

// 获取 POST 数据
$input = file_get_contents('php://input');
$data = json_decode($input, true);

$code = $data['code'] ?? null;
$msg = $data['msg'] ?? '';
$callbackData = $data['data'] ?? [];
$taskId = $callbackData['task_id'] ?? '';
$videoId = $callbackData['video_id'] ?? '';
$videoUrl = $callbackData['video_url'] ?? '';
$imageUrl = $callbackData['image_url'] ?? '';

error_log("收到 Runway 视频生成回调:");
error_log("任务 ID: $taskId, 视频 ID: $videoId");
error_log("状态: $code, 消息: $msg");

if ($code === 200) {
    // 任务成功完成
    error_log("Runway 视频生成成功完成");
    
    error_log("视频 URL: $videoUrl");
    error_log("封面图片 URL: $imageUrl");
    error_log("注意：视频 URL 有效期为 14 天");
    
    // 下载视频文件
    if (!empty($videoUrl)) {
        try {
            $videoFilename = "runway_video_{$taskId}.mp4";
            downloadFile($videoUrl, $videoFilename);
            error_log("视频已下载为 $videoFilename");
        } catch (Exception $e) {
            error_log("视频下载失败: " . $e->getMessage());
        }
    }
    
    // 下载封面图片
    if (!empty($imageUrl)) {
        try {
            $imageFilename = "runway_cover_{$taskId}.png";
            downloadFile($imageUrl, $imageFilename);
            error_log("封面图片已下载为 $imageFilename");
        } catch (Exception $e) {
            error_log("封面图片下载失败: " . $e->getMessage());
        }
    }
    
} else {
    // 任务失败
    error_log("Runway 视频生成失败: $msg");
    
    // 处理特定错误类型
    if ($code === 400) {
        error_log("客户端错误 - 检查内容、格式或配额");
    } elseif ($code === 500) {
        error_log("服务器错误 - 可能需要重试");
    }
}

// 返回 200 状态码确认收到回调
http_response_code(200);
echo json_encode(['status' => 'received']);

function downloadFile($url, $filename) {
    $downloadDir = 'downloads';
    if (!is_dir($downloadDir)) {
        mkdir($downloadDir, 0755, true);
    }
    
    $filepath = $downloadDir . '/' . $filename;
    
    $fileContent = file_get_contents($url);
    if ($fileContent === false) {
        throw new Exception("从 URL 下载文件失败");
    }
    
    $result = file_put_contents($filepath, $fileContent);
    if ($result === false) {
        throw new Exception("保存文件到本地失败");
    }
}
?>
```

</TabItem>
</Tabs>

## 最佳实践

:::tip 回调 URL 配置建议

1. **使用 HTTPS**: 确保回调 URL 使用 HTTPS 协议，保证数据传输安全
2. **验证来源**: 在回调处理中验证请求来源的合法性
3. **幂等处理**: 同一个 task_id 可能收到多次回调，确保处理逻辑是幂等的
4. **快速响应**: 回调处理应尽快返回 200 状态码，避免超时
5. **异步处理**: 复杂的业务逻辑应异步处理，避免阻塞回调响应
6. **立即下载**: 视频 URL 只有 14 天有效期，收到成功回调后应立即下载保存文件

:::

:::caution 重要提醒

- 回调 URL 必须是公网可访问的地址
- 服务器必须在 15 秒内响应，否则会被认为是超时
- 连续 3 次重试失败后，系统将停止发送回调
- **视频 URL 14 天后过期** - 收到回调后请立即下载
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 需要同时处理 video_url 和 image_url 字段，实现完整的媒体管理
- 注意错误消息中的具体失败原因（内容审核、格式问题、配额等）

:::

## 故障排查

如果没有收到回调通知，请检查以下几点：

<AccordionGroup>
<Accordion title="网络连接问题">

- 确认回调 URL 可以从公网访问
- 检查防火墙设置，确保入站请求没有被阻止
- 验证域名解析是否正确

</Accordion>
<Accordion title="服务器响应问题">

- 确保服务器在 15 秒内返回 HTTP 200 状态码
- 检查服务器日志中的错误信息
- 验证接口路径和 HTTP 方法是否正确

</Accordion>
<Accordion title="内容格式问题">

- 确认接收到的 POST 请求体是 JSON 格式
- 检查 Content-Type 是否为 application/json
- 验证 JSON 解析是否正确

</Accordion>
<Accordion title="视频处理问题">

- 确认视频 URL 可以正常访问
- 检查视频下载权限和网络连接
- 验证视频保存路径和权限
- **注意 14 天 URL 过期限制** - 实现立即下载逻辑
- 处理视频和封面图片的下载

</Accordion>
<Accordion title="内容审核问题">

- 查看错误消息中的内容政策违规提示
- 调整被 AI 审核器标记的提示词
- 确保上传的图片/视频符合内容准则
- 检查不当内容检测消息

</Accordion>
</AccordionGroup>

## 替代方案

如果无法使用回调机制，您也可以使用轮询方式：


<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/runway-api/get-ai-video-details"
>
  使用获取 AI 视频详情接口定期查询任务状态，建议每 30 秒查询一次。
</Card>
