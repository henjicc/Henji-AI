# Veo3.1 视频生成回调

当您向 Veo3.1 API 提交视频生成任务时，可以通过 `callBackUrl` 参数设置回调地址。任务完成后，系统会自动将结果推送到您指定的地址。

## 回调机制概述

回调机制避免了您需要轮询 API 查询任务状态，系统会主动推送任务完成结果到您的服务器。

### 回调时机

系统会在以下情况发送回调通知：
*   视频生成任务成功完成
*   视频生成任务失败
*   任务处理过程中发生错误

### 回调方式
*   **HTTP 方法**: POST
*   **内容类型**: application/json
*   **超时设置**: 15 秒

## 回调请求格式

任务完成后，系统会向您的 `callBackUrl` 发送 POST 请求，格式如下：

```json
{
  "code": 200,
  "msg": "Veo3.1 视频生成成功。",
  "data": {
    "taskId": "veo_task_abcdef123456",
    "info": {
      "resultUrls": ["http://example.com/video1.mp4"],
      "originUrls": ["http://example.com/original_video1.mp4"],
      "resolution": "1080p"
    },
    "fallbackFlag": false
  }
}
```

## 状态码说明

### code
*   **类型**: integer
*   **必需**: 是
*   **说明**: 回调状态码，表示任务处理结果。

| 状态码 | 说明 |
| :--- | :--- |
| 200 | 成功 - 视频生成任务成功 |
| 400 | 客户端错误 - 提示词违反内容政策或其他输入错误 |
| 422 | 托底失败 - 当未开启托底且遇到特定错误时返回 |
| 500 | 内部错误 - 请稍后重试，内部错误或超时 |
| 501 | 失败 - 视频生成任务失败 |

### msg
*   **类型**: string
*   **必需**: 是
*   **说明**: 状态消息，提供详细的状态描述。

**400 状态码错误信息：**
*   您的提示词被网站标记为违反内容政策
*   仅支持英文提示词
*   无法获取图片。请验证您或您的服务提供商设置的任何访问限制
*   公共错误：不安全的图片上传

**422 状态码错误信息：**
*   Your request was rejected by Flow(原始错误信息). You may consider using our other fallback channels, which are likely to succeed. Please refer to the documentation.

**托底机制说明：**
当开启 `enableFallback` 且遇到以下错误时，系统会尝试使用备用模型：
*   public error minor upload
*   Your prompt was flagged by Website as violating content policies
*   public error prominent people upload

### data.taskId
*   **类型**: string
*   **必需**: 是
*   **说明**: 任务 ID，与您提交任务时返回的 taskId 一致。

### data.info.resultUrls
*   **类型**: array
*   **说明**: 生成的视频URL数组（仅成功时返回）。

### data.info.originUrls
*   **类型**: array
*   **说明**: 原始视频URL数组（仅成功时返回），仅当aspectRatio不是16:9时才有值。

### data.info.resolution
*   **类型**: string
*   **说明**: 视频分辨率信息（仅成功时返回），表示生成视频的分辨率。

### data.fallbackFlag
*   **类型**: boolean
*   **说明**: 是否通过托底模型生成。true表示使用了备用模型生成，false表示使用主模型生成。

## 托底功能说明

托底功能为智能备用生成机制，当主要模型遇到特定错误时，自动切换到备用模型继续生成，提高任务成功率。

### 启用条件

托底功能需要同时满足以下条件：
1.  请求中 `enableFallback` 参数设置为 `true`
2.  宽高比为 `16:9`
3.  遇到以下特定错误之一：
    *   public error minor upload
    *   Your prompt was flagged by Website as violating content policies
    *   public error prominent people upload

### 托底限制
*   **分辨率**: 托底生成的视频默认使用 1080p 分辨率，无法通过获取1080P视频接口访问。
*   **图片要求**: 如果使用图片生成视频，图片必须是 16:9 比例，否则会进行自动截取。
*   **积分计算**: 成功兜底的积分消耗是不同的，具体计费详情请查看 <https://kie.ai/billing>。

### 错误处理
*   **开启托底**: 遇到特定错误时自动切换备用模型，任务继续执行。
*   **未开启托底**: 遇到特定错误时返回 422 状态码，提示使用托底功能。

托底功能仅在特定错误场景下生效。如果是其他类型的错误（如积分不足、网络问题等），托底功能不会启用。

## 回调接收示例

### Node.js
```javascript
const express = require('express');
const fs = require('fs');
const https = require('https');
const app = express();

app.use(express.json());

app.post('/veo3-1-callback', (req, res) => {
  const { code, msg, data } = req.body;
  
  console.log('收到 Veo3 视频生成回调:', {
    taskId: data.taskId,
    status: code,
    message: msg
  });
  
  if (code === 200) {
    // 视频生成成功
    const { taskId, info, fallbackFlag } = data;
    const { resultUrls, originUrls, resolution } = info;
    
    console.log('视频生成成功！');
    console.log(`任务 ID: ${taskId}`);
    console.log(`生成视频 URL: ${resultUrls}`);
    console.log(`视频分辨率: ${resolution}`);
    console.log(`是否使用托底模型: ${fallbackFlag ? '是' : '否'}`);
    if (originUrls) {
      console.log(`原始视频 URL: ${originUrls}`);
    }
    
    // 下载生成的视频文件
    resultUrls.forEach((url, index) => {
      if (url) {
        downloadFile(url, `veo3.1_generated_${taskId}_${index}.mp4`)
          .then(() => console.log(`视频 ${index + 1} 下载成功`))
          .catch(err => console.error(`视频 ${index + 1} 下载失败:`, err));
      }
    });
    
    // 下载原始视频文件（如果存在）
    if (originUrls) {
      originUrls.forEach((url, index) => {
        if (url) {
          downloadFile(url, `veo3.1_original_${taskId}_${index}.mp4`)
            .then(() => console.log(`原始视频 ${index + 1} 下载成功`))
            .catch(err => console.error(`原始视频 ${index + 1} 下载失败:`, err));
        }
      });
    }
    
  } else {
    // 视频生成失败
    console.log('Veo3.1 视频生成失败:', msg);
    
    // 处理特定错误类型
    if (code === 400) {
      console.log('客户端错误 - 检查提示词和内容政策');
    } else if (code === 422) {
      console.log('托底失败 - 建议开启托底功能（enableFallback: true）');
    } else if (code === 500) {
      console.log('服务器内部错误 - 请稍后重试');
    } else if (code === 501) {
      console.log('任务失败 - 视频生成失败');
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

### Python
```python
from flask import Flask, request, jsonify
import requests
import json
import os

app = Flask(__name__)

@app.route('/veo3-1-callback', methods=['POST'])
def handle_callback():
    data = request.json
    
    code = data.get('code')
    msg = data.get('msg')
    callback_data = data.get('data', {})
    task_id = callback_data.get('taskId')
    
    print(f"收到 Veo3.1 视频生成回调:")
    print(f"任务 ID: {task_id}")
    print(f"状态: {code}, 消息: {msg}")
    
    if code == 200:
        # 视频生成成功
        info = callback_data.get('info', {})
        result_urls = info.get('resultUrls')
        origin_urls = info.get('originUrls')
        resolution = info.get('resolution')
        fallback_flag = callback_data.get('fallbackFlag', False)
        
        print("视频生成成功！")
        print(f"生成视频 URL: {result_urls}")
        print(f"视频分辨率: {resolution}")
        print(f"是否使用托底模型: {'是' if fallback_flag else '否'}")
        if origin_urls:
            print(f"原始视频 URL: {origin_urls}")
        
        # 下载生成的视频文件
        if result_urls:
            for i, url in enumerate(result_urls):
                if url:
                    try:
                        video_filename = f"veo3.1_generated_{task_id}_{i}.mp4"
                        download_file(url, video_filename)
                        print(f"视频 {i + 1} 下载成功")
                    except Exception as e:
                        print(f"视频 {i + 1} 下载失败: {e}")
        
        # 下载原始视频文件（如果存在）
        if origin_urls:
            for i, url in enumerate(origin_urls):
                if url:
                    try:
                        original_filename = f"veo3.1_original_{task_id}_{i}.mp4"
                        download_file(url, original_filename)
                        print(f"原始视频 {i + 1} 下载成功")
                    except Exception as e:
                        print(f"原始视频 {i + 1} 下载失败: {e}")
                
    else:
        # 视频生成失败
        print(f"Veo3.1 视频生成失败: {msg}")
        
        # 处理特定错误类型
        if code == 400:
            print("客户端错误 - 检查提示词和内容政策")
            if '内容政策' in msg:
                print("内容审核失败 - 请修改提示词")
            elif '英文提示词' in msg:
                print("语言错误 - 仅支持英文提示词")
            elif '不安全的图片' in msg:
                print("图片安全检查失败 - 请更换图片")
        elif code == 422:
            print("托底失败 - 建议开启托底功能（enableFallback: true）")
        elif code == 500:
            print("服务器内部错误 - 请稍后重试")
        elif code == 501:
            print("任务失败 - 视频生成失败")
    
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

### PHP
```php
<?php
header('Content-Type: application/json');

// 获取 POST 数据
$input = file_get_contents('php://input');
$data = json_decode($input, true);

$code = $data['code'] ?? null;
$msg = $data['msg'] ?? '';
$callbackData = $data['data'] ?? [];
$taskId = $callbackData['taskId'] ?? '';

error_log("收到 Veo3.1 视频生成回调:");
error_log("任务 ID: $taskId");
error_log("状态: $code, 消息: $msg");

if ($code === 200) {
    // 视频生成成功
    $info = $callbackData['info'] ?? [];
    $resultUrls = $info['resultUrls'] ?? '';
    $originUrls = $info['originUrls'] ?? '';
    $resolution = $info['resolution'] ?? '';
    $fallbackFlag = $callbackData['fallbackFlag'] ?? false;
    
    error_log("视频生成成功！");
    error_log("生成视频 URL: $resultUrls");
    error_log("视频分辨率: $resolution");
    error_log("是否使用托底模型: " . ($fallbackFlag ? '是' : '否'));
    if (!empty($originUrls)) {
        error_log("原始视频 URL: $originUrls");
    }
    
    // 下载生成的视频文件
    if (!empty($resultUrls) && is_array($resultUrls)) {
        foreach ($resultUrls as $index => $url) {
            if (!empty($url)) {
                try {
                    $videoFilename = "veo3.1_generated_{$taskId}_{$index}.mp4";
                    downloadFile($url, $videoFilename);
                    error_log("视频 " . ($index + 1) . " 下载成功");
                } catch (Exception $e) {
                    error_log("视频 " . ($index + 1) . " 下载失败: " . $e->getMessage());
                }
            }
        }
    }
    
    // 下载原始视频文件（如果存在）
    if (!empty($originUrls) && is_array($originUrls)) {
        foreach ($originUrls as $index => $url) {
            if (!empty($url)) {
                try {
                    $originalFilename = "veo3.1_original_{$taskId}_{$index}.mp4";
                    downloadFile($url, $originalFilename);
                    error_log("原始视频 " . ($index + 1) . " 下载成功");
                } catch (Exception $e) {
                    error_log("原始视频 " . ($index + 1) . " 下载失败: " . $e->getMessage());
                }
            }
        }
    }
    
} else {
    // 视频生成失败
    error_log("Veo3.1 视频生成失败: $msg");
    
    // 处理特定错误类型
    if ($code === 400) {
        error_log("客户端错误 - 检查提示词和内容政策");
        if (strpos($msg, '内容政策') !== false) {
            error_log("内容审核失败 - 请修改提示词");
        } elseif (strpos($msg, '英文提示词') !== false) {
            error_log("语言错误 - 仅支持英文提示词");
        } elseif (strpos($msg, '不安全的图片') !== false) {
            error_log("图片安全检查失败 - 请更换图片");
        }
    } elseif ($code === 422) {
        error_log("托底失败 - 建议开启托底功能（enableFallback: true）");
    } elseif ($code === 500) {
        error_log("服务器内部错误 - 请稍后重试");
    } elseif ($code === 501) {
        error_log("任务失败 - 视频生成失败");
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

## 最佳实践

### 回调 URL 配置建议
1.  **使用 HTTPS**: 确保回调 URL 使用 HTTPS 协议，保证数据传输安全。
2.  **验证来源**: 在回调处理中验证请求来源的合法性。
3.  **幂等处理**: 同一个 taskId 可能收到多次回调，确保处理逻辑是幂等的。
4.  **快速响应**: 回调处理应尽快返回 200 状态码，避免超时。
5.  **异步处理**: 复杂的业务逻辑应异步处理，避免阻塞回调响应。
6.  **及时下载**: 视频 URL 有一定有效期，请及时下载保存。
7.  **数组处理**: resultUrls 和 originUrls 是直接的数组格式，可以直接遍历使用。
8.  **英文提示词**: 确保使用英文提示词，避免语言相关错误。

### 重要提醒
*   回调 URL 必须是公网可访问的地址。
*   服务器必须在 15 秒内响应，否则会被认为是超时。
*   连续 3 次重试失败后，系统将停止发送回调。
*   **仅支持英文提示词**，请确保提示词使用英文。
*   请确保回调处理逻辑的稳定性，避免因异常导致回调失败。
*   适当处理内容审核错误，确保输入内容符合平台政策。
*   resultUrls 和 originUrls 返回的是直接的数组格式，可以直接遍历使用。
*   originUrls 仅在 aspectRatio 不是 16:9 时才有值。
*   注意图片上传的安全检查，避免上传不安全的图片。

## 故障排查

如果没有收到回调通知，请检查以下几点：

### 网络连接问题
*   确认回调 URL 可以从公网访问。
*   检查防火墙设置，确保入站请求没有被阻止。
*   验证域名解析是否正确。

### 服务器响应问题
*