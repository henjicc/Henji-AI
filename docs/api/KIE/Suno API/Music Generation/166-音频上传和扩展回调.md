# 音频上传和扩展回调

当音频生成完成时，系统会调用此回调通知结果

当您向 Suno API 提交音频上传和扩展任务时，可以通过 `callBackUrl` 参数设置回调地址。任务完成后，系统会自动将结果推送到您指定的地址。

## 回调机制概述

:::info[]
回调机制避免了您需要轮询 API 查询任务状态，系统会主动推送任务完成结果到您的服务器。
:::

### 回调时机

系统会在以下情况发送回调通知：
- 文本生成完成（callbackType: "text"）
- 第一首音频生成完成（callbackType: "first"）
- 全部音频生成完成（callbackType: "complete"）
- 音频生成任务失败
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
        "source_audio_url": "https://example.cn/****.mp3",
        "stream_audio_url": "https://example.cn/****",
        "source_stream_audio_url": "https://example.cn/****",
        "image_url": "https://example.cn/****.jpeg",
        "source_image_url": "https://example.cn/****.jpeg",
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
  "msg": "第一首音频生成成功。",
  "data": {
    "callbackType": "first",
    "task_id": "2fac****9f72",
    "data": [
      {
        "id": "e231****-****-****-****-****8cadc7dc",
        "audio_url": "https://example.cn/****.mp3",
        "source_audio_url": "https://example.cn/****.mp3",
        "stream_audio_url": "https://example.cn/****",
        "source_stream_audio_url": "https://example.cn/****",
        "image_url": "https://example.cn/****.jpeg",
        "source_image_url": "https://example.cn/****.jpeg",
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

### 回调参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | integer | 是 | 回调状态码，表示任务处理结果：<br/>- **200**: 成功 - 请求已成功处理<br/>- **400**: 验证错误 - 歌词包含受版权保护的内容<br/>- **408**: 超出限制 - 超时<br/>- **413**: 冲突 - 上传的音频与现有艺术作品匹配<br/>- **500**: 服务器错误 - 处理请求时发生意外错误<br/>- **501**: 音频生成失败<br/>- **531**: 服务器错误 - 抱歉，由于问题生成失败。您的积分已退还。请重试 |
| `msg` | string | 是 | 状态消息，提供详细的状态描述 |
| `data.callbackType` | string | 是 | 回调类型，表示生成阶段：<br/>- **text**: 文本生成完成<br/>- **first**: 第一首完成<br/>- **complete**: 全部完成<br/>- **error**: 生成失败 |
| `data.task_id` | string | 是 | 任务 ID，与您提交任务时返回的 taskId 一致 |
| `data.data` | array | 是 | 生成的音频数组。文本回调或失败时为空。 |

### 音频对象参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `data.data[].id` | string | 否 | 音频唯一标识 |
| `data.data[].audio_url` | string | 否 | 生成的音频文件 URL，用于下载 |
| `data.data[].source_audio_url` | string | 否 | 原始音频文件 URL |
| `data.data[].stream_audio_url` | string | 否 | 生成的流式音频 URL，用于实时播放 |
| `data.data[].source_stream_audio_url` | string | 否 | 原始流式音频 URL |
| `data.data[].image_url` | string | 否 | 生成的封面图片 URL |
| `data.data[].source_image_url` | string | 否 | 原始封面图片 URL |
| `data.data[].prompt` | string | 否 | 使用的生成提示词/歌词 |
| `data.data[].model_name` | string | 否 | 使用的模型名称（如 "chirp-v3-5"） |
| `data.data[].title` | string | 否 | 音乐标题 |
| `data.data[].tags` | string | 否 | 音乐标签/风格 |
| `data.data[].createTime` | string | 否 | 创建时间戳 |
| `data.data[].duration` | number | 否 | 音频时长（秒） |

## 回调接收示例

以下是用流行编程语言接收回调的示例代码：

<Tabs>
<TabItem value="nodejs" label="Node.js">

```javascript
const express = require('express');
const fs = require('fs');
const https = require('https');
const app = express();

app.use(express.json());

app.post('/suno-extend-callback', (req, res) => {
  const { code, msg, data } = req.body;
  
  console.log('收到 Suno 音频扩展回调:', {
    taskId: data.task_id,
    callbackType: data.callbackType,
    status: code,
    message: msg
  });
  
  if (code === 200) {
    // 任务进展或成功完成
    const { callbackType, task_id, data: tracks } = data;
    
    console.log(`回调类型: ${callbackType}`);
    console.log(`音频数量: ${tracks.length}`);
    
    switch (callbackType) {
      case 'text':
        console.log('文本生成完成，等待音频生成...');
        break;
        
      case 'first':
        console.log('第一首完成，正在处理剩余音频...');
        downloadTracks(tracks, task_id);
        break;
        
      case 'complete':
        console.log('全部音频生成完成！');
        downloadTracks(tracks, task_id);
        break;
    }
    
  } else {
    // 任务失败
    console.log('Suno 音频扩展失败:', msg);
    
    // 处理特定错误类型
    if (code === 400) {
      console.log('验证错误 - 检查版权内容');
    } else if (code === 408) {
      console.log('速率限制 - 请等待后重试');
    } else if (code === 413) {
      console.log('内容冲突 - 上传音频与现有作品匹配');
    } else if (code === 501) {
      console.log('生成失败 - 可能需要调整参数');
    } else if (code === 531) {
      console.log('服务器错误已退还积分 - 可安全重试');
    }
  }
  
  // 返回 200 状态码确认收到回调
  res.status(200).json({ status: 'received' });
});

// 下载音频函数
function downloadTracks(tracks, taskId) {
  tracks.forEach((track, index) => {
    const { 
      id, 
      audio_url, 
      source_audio_url,
      image_url, 
      source_image_url,
      title, 
      duration 
    } = track;
    
    console.log(`音频 ${index + 1}: ${title} (${duration}秒)`);
    
    // 下载生成的音频文件
    if (audio_url) {
      downloadFile(audio_url, `suno_extend_${taskId}_${id}.mp3`)
        .then(() => console.log(`生成音频下载成功: ${id}`))
        .catch(err => console.error(`生成音频下载失败 ${id}:`, err));
    }
    
    // 下载原始音频文件
    if (source_audio_url) {
      downloadFile(source_audio_url, `suno_source_${taskId}_${id}.mp3`)
        .then(() => console.log(`原始音频下载成功: ${id}`))
        .catch(err => console.error(`原始音频下载失败 ${id}:`, err));
    }
    
    // 下载生成的封面图片
    if (image_url) {
      downloadFile(image_url, `suno_cover_img_${taskId}_${id}.jpeg`)
        .then(() => console.log(`生成封面下载成功: ${id}`))
        .catch(err => console.error(`生成封面下载失败 ${id}:`, err));
    }
    
    // 下载原始封面图片
    if (source_image_url) {
      downloadFile(source_image_url, `suno_source_img_${taskId}_${id}.jpeg`)
        .then(() => console.log(`原始封面下载成功: ${id}`))
        .catch(err => console.error(`原始封面下载失败 ${id}:`, err));
    }
  });
}

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

@app.route('/suno-extend-callback', methods=['POST'])
def handle_callback():
    data = request.json
    
    code = data.get('code')
    msg = data.get('msg')
    callback_data = data.get('data', {})
    callback_type = callback_data.get('callbackType')
    task_id = callback_data.get('task_id')
    tracks = callback_data.get('data', [])
    
    print(f"收到 Suno 音频扩展回调:")
    print(f"任务 ID: {task_id}, 类型: {callback_type}")
    print(f"状态: {code}, 消息: {msg}")
    
    if code == 200:
        # 任务进展或成功完成
        print(f"回调类型: {callback_type}")
        print(f"音频数量: {len(tracks)}")
        
        if callback_type == 'text':
            print("文本生成完成，等待音频生成...")
        elif callback_type == 'first':
            print("第一首完成，正在处理剩余音频...")
            download_tracks(tracks, task_id)
        elif callback_type == 'complete':
            print("全部音频生成完成！")
            download_tracks(tracks, task_id)
            
    else:
        # 任务失败
        print(f"Suno 音频扩展失败: {msg}")
        
        # 处理特定错误类型
        if code == 400:
            print("验证错误 - 检查版权内容")
        elif code == 408:
            print("速率限制 - 请等待后重试")
        elif code == 413:
            print("内容冲突 - 上传音频与现有作品匹配")
        elif code == 501:
            print("生成失败 - 可能需要调整参数")
        elif code == 531:
            print("服务器错误已退还积分 - 可安全重试")
    
    # 返回 200 状态码确认收到回调
    return jsonify({'status': 'received'}), 200

def download_tracks(tracks, task_id):
    """下载音频和封面图片"""
    for i, track in enumerate(tracks):
        track_id = track.get('id')
        audio_url = track.get('audio_url')
        source_audio_url = track.get('source_audio_url')
        image_url = track.get('image_url')
        source_image_url = track.get('source_image_url')
        title = track.get('title')
        duration = track.get('duration')
        
        print(f"音频 {i + 1}: {title} ({duration}秒)")
        
        # 下载生成的音频文件
        if audio_url:
            try:
                audio_filename = f"suno_extend_{task_id}_{track_id}.mp3"
                download_file(audio_url, audio_filename)
                print(f"生成音频下载成功: {track_id}")
            except Exception as e:
                print(f"生成音频下载失败 {track_id}: {e}")
        
        # 下载原始音频文件
        if source_audio_url:
            try:
                source_audio_filename = f"suno_source_{task_id}_{track_id}.mp3"
                download_file(source_audio_url, source_audio_filename)
                print(f"原始音频下载成功: {track_id}")
            except Exception as e:
                print(f"原始音频下载失败 {track_id}: {e}")
        
        # 下载生成的封面图片
        if image_url:
            try:
                image_filename = f"suno_cover_img_{task_id}_{track_id}.jpeg"
                download_file(image_url, image_filename)
                print(f"生成封面下载成功: {track_id}")
            except Exception as e:
                print(f"生成封面下载失败 {track_id}: {e}")
        
        # 下载原始封面图片
        if source_image_url:
            try:
                source_image_filename = f"suno_source_img_{task_id}_{track_id}.jpeg"
                download_file(source_image_url, source_image_filename)
                print(f"原始封面下载成功: {track_id}")
            except Exception as e:
                print(f"原始封面下载失败 {track_id}: {e}")

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
$callbackType = $callbackData['callbackType'] ?? '';
$taskId = $callbackData['task_id'] ?? '';
$tracks = $callbackData['data'] ?? [];

error_log("收到 Suno 音频扩展回调:");
error_log("任务 ID: $taskId, 类型: $callbackType");
error_log("状态: $code, 消息: $msg");

if ($code === 200) {
    // 任务进展或成功完成
    error_log("回调类型: $callbackType");
    error_log("音频数量: " . count($tracks));
    
    switch ($callbackType) {
        case 'text':
            error_log("文本生成完成，等待音频生成...");
            break;
            
        case 'first':
            error_log("第一首完成，正在处理剩余音频...");
            downloadTracks($tracks, $taskId);
            break;
            
        case 'complete':
            error_log("全部音频生成完成！");
            downloadTracks($tracks, $taskId);
            break;
    }
    
} else {
    // 任务失败
    error_log("Suno 音频扩展失败: $msg");
    
    // 处理特定错误类型
    if ($code === 400) {
        error_log("验证错误 - 检查版权内容");
    } elseif ($code === 408) {
        error_log("速率限制 - 请等待后重试");
    } elseif ($code === 413) {
        error_log("内容冲突 - 上传音频与现有作品匹配");
    } elseif ($code === 501) {
        error_log("生成失败 - 可能需要调整参数");
    } elseif ($code === 531) {
        error_log("服务器错误已退还积分 - 可安全重试");
    }
}

// 返回 200 状态码确认收到回调
http_response_code(200);
echo json_encode(['status' => 'received']);

function downloadTracks($tracks, $taskId) {
    foreach ($tracks as $i => $track) {
        $trackId = $track['id'] ?? '';
        $audioUrl = $track['audio_url'] ?? '';
        $sourceAudioUrl = $track['source_audio_url'] ?? '';
        $imageUrl = $track['image_url'] ?? '';
        $sourceImageUrl = $track['source_image_url'] ?? '';
        $title = $track['title'] ?? '';
        $duration = $track['duration'] ?? 0;
        
        error_log("音频 " . ($i + 1) . ": $title ({$duration}秒)");
        
        // 下载生成的音频文件
        if (!empty($audioUrl)) {
            try {
                $audioFilename = "suno_extend_{$taskId}_{$trackId}.mp3";
                downloadFile($audioUrl, $audioFilename);
                error_log("生成音频下载成功: $trackId");
            } catch (Exception $e) {
                error_log("生成音频下载失败 $trackId: " . $e->getMessage());
            }
        }
        
        // 下载原始音频文件
        if (!empty($sourceAudioUrl)) {
            try {
                $sourceAudioFilename = "suno_source_{$taskId}_{$trackId}.mp3";
                downloadFile($sourceAudioUrl, $sourceAudioFilename);
                error_log("原始音频下载成功: $trackId");
            } catch (Exception $e) {
                error_log("原始音频下载失败 $trackId: " . $e->getMessage());
            }
        }
        
        // 下载生成的封面图片
        if (!empty($imageUrl)) {
            try {
                $imageFilename = "suno_cover_img_{$taskId}_{$trackId}.jpeg";
                downloadFile($imageUrl, $imageFilename);
                error_log("生成封面下载成功: $trackId");
            } catch (Exception $e) {
                error_log("生成封面下载失败 $trackId: " . $e->getMessage());
            }
        }
        
        // 下载原始封面图片
        if (!empty($sourceImageUrl)) {
            try {
                $sourceImageFilename = "suno_source_img_{$taskId}_{$trackId}.jpeg";
                downloadFile($sourceImageUrl, $sourceImageFilename);
                error_log("原始封面下载成功: $trackId");
            } catch (Exception $e) {
                error_log("原始封面下载失败 $trackId: " . $e->getMessage());
            }
        }
    }
}

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
6. **处理多次回调**: 准备接收同一任务的 text、first、complete 回调
7. **下载双版本**: 考虑下载生成文件和原始文件用于对比

:::

:::warning 重要提醒

- 回调 URL 必须是公网可访问的地址
- 服务器必须在 15 秒内响应，否则会被认为是超时
- 连续 3 次重试失败后，系统将停止发送回调
- 您可能收到同一任务的多次回调（text → first → complete）
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 适当处理版权和冲突错误（代码 400, 413）
- 某些服务器错误会自动退还积分（代码 531）
- 注意生成文件和原始文件 URL 的完整资产管理

:::

## 故障排查

如果没有收到回调通知，请检查以下几点：

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
- 在同一回调中处理多个音频
- 根据需要下载生成和原始音频文件

</details>

<details>
<summary>版权和内容问题</summary>

- 查看版权违规错误消息（代码 400）
- 检查与现有作品的内容冲突（代码 413）
- 确保遵循平台内容政策
- 如被标记，调整上传音频或提示词
- 验证上传音频的原创性

</details>

<details>
<summary>速率限制问题</summary>

- 优雅处理超时错误（代码 408）
- 实现适当的退避重试逻辑
- 监控 API 使用情况以避免速率限制
- 如需要，考虑升级服务计划

</details>

<details>
<summary>文件管理问题</summary>

- 按类型组织下载的文件（生成 vs 原始）
- 实现适当的文件命名约定
- 优雅处理潜在的重复下载
- 监控大音频文件的磁盘空间

</details>

## 替代方案

如果无法使用回调机制，您也可以使用轮询方式：

<Card title="轮询查询结果" icon="lucide-radar" href="/cn/suno-api/get-music-details">
使用获取音乐详情接口定期查询任务状态，建议每 30 秒查询一次。
</Card>

