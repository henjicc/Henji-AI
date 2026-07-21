# AI 视频扩展回调

>您向 Runway API 提交视频扩展任务时，可以通过 `callBackUrl` 参数设置回调地址。任务完成后，系统会自动将结果推送到您指定的地址。

## 回调机制概述

:::note[]
回调机制避免了您需要轮询 API 查询任务状态，系统会主动推送任务完成结果到您的服务器。
:::

:::tip[]
  **Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统会在以下情况发送回调通知：

- 视频扩展任务成功完成
- 视频扩展任务失败
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
    "image_url": "https://file.com/m/xxxxxxxx.png",
    "task_id": "ee603959-debb-48d1-98c4-a6d1c717eba6",
    "video_id": "485da89c-7fca-4340-8c04-101025b2ae71",
    "video_url": "https://file.com/k/xxxxxxx.mp4"
  }
}
```

</TabItem>
<TabItem value="failed" label="失败回调">

```json
{
  "code": 400,
  "msg": "获取图像信息失败。",
  "data": {
    "task_id": "ee603959-debb-48d1-98c4-a6d1c717eba6"
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
| `data.video_id` | string | 否 | 视频唯一标识（仅成功时返回） |
| `data.video_url` | string | 否 | 可访问的视频 URL，有效期 14 天（仅成功时返回） |
| `data.image_url` | string | 否 | 生成视频的封面图片 URL（仅成功时返回） |

### 状态码详情

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 - 请求已成功处理 |
| 400 | 客户端错误 - 请求参数有误或内容不当 |
| 500 | 服务器错误 - 处理请求时发生意外错误 |

### 常见错误消息

当 code 为 400 时，可能的错误信息包括：

- 获取图像信息失败
- 检测到不当内容，请替换图像或视频
- 图像格式不正确
- 请稍后重试。您可以升级到标准会员以立即开始生成
- 已达到并发生成限制
- 不支持的宽度或高度，请调整尺寸后重试
- 由于网络原因上传失败，请重新输入
- 您的提示词被我们的AI审核器捕获。请调整后重试！
- 您的提示词/负面提示词不能超过2048个字符。请检查您的输入是否过长
- 您的视频创建提示词包含NSFW内容，这不符合我们的政策。请修改您的提示词并重新生成

## 回调接收示例

以下是用流行编程语言接收回调的示例代码：

<Tabs>
<TabItem value="javascript" label="Node.js">

```javascript
const express = require('express');
const fs = require('fs');
const https = require('https');
const app = express();

app.use(express.json());

app.post('/runway-extend-callback', (req, res) => {
  const { code, msg, data } = req.body;
  
  console.log('收到 Runway 视频扩展回调:', {
    taskId: data.task_id,
    status: code,
    message: msg
  });
  
  if (code === 200) {
    // 视频扩展成功
    const { task_id, video_id, video_url, image_url } = data;
    
    console.log('视频扩展成功！');
    console.log(`任务 ID: ${task_id}`);
    console.log(`视频 ID: ${video_id}`);
    console.log(`视频 URL: ${video_url}`);
    console.log(`封面 URL: ${image_url}`);
    
    // 下载视频文件
    if (video_url) {
      downloadFile(video_url, `runway_extend_${task_id}.mp4`)
        .then(() => console.log('视频下载成功'))
        .catch(err => console.error('视频下载失败:', err));
    }
    
    // 下载封面图片
    if (image_url) {
      downloadFile(image_url, `runway_extend_cover_${task_id}.png`)
        .then(() => console.log('封面下载成功'))
        .catch(err => console.error('封面下载失败:', err));
    }
    
  } else {
    // 视频扩展失败
    console.log('Runway 视频扩展失败:', msg);
    
    // 处理特定错误类型
    if (code === 400) {
      console.log('客户端错误 - 检查输入参数和内容');
    } else if (code === 500) {
      console.log('服务器错误 - 请稍后重试');
    }
  }
  
  // 返回 200 状态码确认收到回调
  res.status(200).json({ code: 200, msg: 'success' });
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

@app.route('/runway-extend-callback', methods=['POST'])
def handle_callback():
    data = request.json
    
    code = data.get('code')
    msg = data.get('msg')
    callback_data = data.get('data', {})
    task_id = callback_data.get('task_id')
    
    print(f"收到 Runway 视频扩展回调:")
    print(f"任务 ID: {task_id}")
    print(f"状态: {code}, 消息: {msg}")
    
    if code == 200:
        # 视频扩展成功
        video_id = callback_data.get('video_id')
        video_url = callback_data.get('video_url')
        image_url = callback_data.get('image_url')
        
        print("视频扩展成功！")
        print(f"视频 ID: {video_id}")
        print(f"视频 URL: {video_url}")
        print(f"封面 URL: {image_url}")
        
        # 下载视频文件
        if video_url:
            try:
                video_filename = f"runway_extend_{task_id}.mp4"
                download_file(video_url, video_filename)
                print("视频下载成功")
            except Exception as e:
                print(f"视频下载失败: {e}")
        
        # 下载封面图片
        if image_url:
            try:
                image_filename = f"runway_extend_cover_{task_id}.png"
                download_file(image_url, image_filename)
                print("封面下载成功")
            except Exception as e:
                print(f"封面下载失败: {e}")
                
    else:
        # 视频扩展失败
        print(f"Runway 视频扩展失败: {msg}")
        
        # 处理特定错误类型
        if code == 400:
            print("客户端错误 - 检查输入参数和内容")
            if '不当内容' in msg:
                print("内容审核失败 - 请替换图像或视频")
            elif '格式不正确' in msg:
                print("格式错误 - 请检查图像格式")
            elif '并发生成限制' in msg:
                print("并发限制 - 请等待或升级会员")
            elif 'NSFW内容' in msg:
                print("内容违规 - 请修改提示词")
        elif code == 500:
            print("服务器错误 - 请稍后重试")
    
    # 返回 200 状态码确认收到回调
    return jsonify({'code': 200, 'msg': 'success'}), 200

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

error_log("收到 Runway 视频扩展回调:");
error_log("任务 ID: $taskId");
error_log("状态: $code, 消息: $msg");

if ($code === 200) {
    // 视频扩展成功
    $videoId = $callbackData['video_id'] ?? '';
    $videoUrl = $callbackData['video_url'] ?? '';
    $imageUrl = $callbackData['image_url'] ?? '';
    
    error_log("视频扩展成功！");
    error_log("视频 ID: $videoId");
    error_log("视频 URL: $videoUrl");
    error_log("封面 URL: $imageUrl");
    
    // 下载视频文件
    if (!empty($videoUrl)) {
        try {
            $videoFilename = "runway_extend_{$taskId}.mp4";
            downloadFile($videoUrl, $videoFilename);
            error_log("视频下载成功");
        } catch (Exception $e) {
            error_log("视频下载失败: " . $e->getMessage());
        }
    }
    
    // 下载封面图片
    if (!empty($imageUrl)) {
        try {
            $imageFilename = "runway_extend_cover_{$taskId}.png";
            downloadFile($imageUrl, $imageFilename);
            error_log("封面下载成功");
        } catch (Exception $e) {
            error_log("封面下载失败: " . $e->getMessage());
        }
    }
    
} else {
    // 视频扩展失败
    error_log("Runway 视频扩展失败: $msg");
    
    // 处理特定错误类型
    if ($code === 400) {
        error_log("客户端错误 - 检查输入参数和内容");
        if (strpos($msg, '不当内容') !== false) {
            error_log("内容审核失败 - 请替换图像或视频");
        } elseif (strpos($msg, '格式不正确') !== false) {
            error_log("格式错误 - 请检查图像格式");
        } elseif (strpos($msg, '并发生成限制') !== false) {
            error_log("并发限制 - 请等待或升级会员");
        } elseif (strpos($msg, 'NSFW内容') !== false) {
            error_log("内容违规 - 请修改提示词");
        }
    } elseif ($code === 500) {
        error_log("服务器错误 - 请稍后重试");
    }
}

// 返回 200 状态码确认收到回调
http_response_code(200);
echo json_encode(['code' => 200, 'msg' => 'success']);

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
6. **及时下载**: 视频 URL 有效期仅 14 天，请及时下载保存
7. **扩展管理**: 妥善管理扩展后的视频文件和封面图片

:::

:::caution 重要提醒

- 回调 URL 必须是公网可访问的地址
- 服务器必须在 15 秒内响应，否则会被认为是超时
- 连续 3 次重试失败后，系统将停止发送回调
- **视频 URL 有效期仅 14 天**，请及时下载并保存到您的存储系统
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 适当处理内容审核错误，确保输入内容符合平台政策
- 扩展后的视频时长通常会比原视频更长
- 注意并发生成限制，避免同时提交过多任务

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
- 注意视频 URL 的 14 天有效期限制
- 及时备份视频到长期存储系统

</Accordion>
<Accordion title="内容审核问题">

- 查看内容审核错误消息
- 确保输入图像或视频不包含不当内容
- 检查提示词是否符合平台政策
- 避免使用 NSFW 相关的描述词汇
- 确保图像格式正确且尺寸合适

</Accordion>
<Accordion title="并发限制问题">

- 监控当前并发任务数量
- 实现适当的任务队列机制
- 考虑升级到标准会员以获得更高并发限制
- 合理安排任务提交时间

</Accordion>
<Accordion title="扩展质量问题">

- 检查扩展后视频的连贯性
- 验证视频时长是否符合预期
- 评估扩展部分的画质和风格一致性
- 确保扩展后的视频过渡自然

</Accordion>
</AccordionGroup>

## 扩展特定注意事项

:::note AI 视频扩展特性

AI 视频扩展功能会基于现有视频继续生成，有以下特点：

1. **时长增加**: 扩展后的视频时长会比原视频更长
2. **风格延续**: 系统会尽量保持原视频的视觉风格和运动模式
3. **平滑过渡**: 扩展部分会与原视频自然衔接
4. **质量保持**: 扩展后的视频质量应与原视频相当
5. **运动连贯**: 物体运动和场景变化会保持逻辑连贯性
6. **URL 有效期**: 生成的视频 URL 仅有 14 天有效期

:::

## 替代方案

如果无法使用回调机制，您也可以使用轮询方式：

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/runway-api/get-ai-video-details"
>
  使用获取 AI 视频详情接口定期查询任务状态，建议每 30 秒查询一次。
</Card>
