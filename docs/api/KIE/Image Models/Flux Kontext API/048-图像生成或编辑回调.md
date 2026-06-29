# 图像生成或编辑回调

>当您向 Flux Kontext API 提交图像生成或编辑任务时，可以通过 `callBackUrl` 参数设置回调地址。任务完成后，系统会自动将结果推送到您指定的地址。

## 回调机制概述

:::note[]
回调机制避免了您需要轮询 API 查询任务状态，系统会主动推送任务完成结果到您的服务器。
:::

:::tip[]
  **Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统会在以下情况发送回调通知：

- 图像生成或编辑任务成功完成
- 图像生成或编辑任务失败
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
  "msg": "BFL 图像生成成功。",
  "data": {
    "taskId": "task12345",
    "info": {
      "originImageUrl": "https://example.com/original.jpg",
      "resultImageUrl": "https://example.com/result.jpg"
    }
  }
}
```

</TabItem>
<TabItem value="violation" label="内容违规失败回调">

```json
{
  "code": 400,
  "msg": "您的提示词被网站标记为违反内容政策",
  "data": {
    "taskId": "task12345",
    "info": {
      "originImageUrl": "",
      "resultImageUrl": ""
    }
  }
}
```

</TabItem>
<TabItem value="generation-failed" label="生成失败回调">

```json
{
  "code": 501,
  "msg": "图像生成任务失败",
  "data": {
    "taskId": "task12345",
    "info": {
      "originImageUrl": "",
      "resultImageUrl": ""
    }
  }
}
```

</TabItem>
<TabItem value="internal-error" label="内部错误回调">

```json
{
  "code": 500,
  "msg": "内部错误，请稍后重试",
  "data": {
    "taskId": "task12345",
    "info": {
      "originImageUrl": "",
      "resultImageUrl": ""
    }
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
| `data.taskId` | string | 是 | 任务 ID，与您提交任务时返回的 taskId 一致 |
| `data.info.originImageUrl` | string | 否 | 原始图像 URL，**有效期为 10 分钟**。仅在成功时存在 |
| `data.info.resultImageUrl` | string | 否 | 生成图像在我们服务器上的 URL。仅在成功时存在 |

### 状态码详情

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 - 图像生成成功 |
| 400 | 失败 - 您的提示词被网站标记为违反内容政策 |
| 500 | 失败 - 内部错误，请稍后重试 |
| 501 | 失败 - 图像生成任务失败 |

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

app.post('/flux-image-callback', (req, res) => {
  const { code, msg, data } = req.body;
  
  console.log('收到 Flux 图像生成回调:', {
    taskId: data.taskId,
    status: code,
    message: msg
  });
  
  if (code === 200) {
    // 任务成功完成
    console.log('Flux 图像生成成功完成');
    
    const { taskId, info } = data;
    const { originImageUrl, resultImageUrl } = info;
    
    console.log(`原始图像 URL: ${originImageUrl}`);
    console.log(`生成图像 URL: ${resultImageUrl}`);
    console.log('注意：原始图像 URL 有效期为 10 分钟');
    
    // 下载生成的图像
    if (resultImageUrl) {
      downloadFile(resultImageUrl, `flux_result_${taskId}.jpg`)
        .then(() => console.log('生成图像下载成功'))
        .catch(err => console.error('生成图像下载失败:', err));
    }
    
    // 下载原始图像（如果需要）
    if (originImageUrl) {
      downloadFile(originImageUrl, `flux_original_${taskId}.jpg`)
        .then(() => console.log('原始图像下载成功'))
        .catch(err => console.error('原始图像下载失败:', err));
    }
    
  } else {
    // 任务失败
    console.log('Flux 图像生成失败:', msg);
    
    // 处理特定错误类型
    if (code === 400) {
      console.log('内容政策违规 - 请调整提示词');
    } else if (code === 500) {
      console.log('内部错误 - 请稍后重试');
    } else if (code === 501) {
      console.log('生成任务失败 - 可能需要调整参数');
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

@app.route('/flux-image-callback', methods=['POST'])
def handle_callback():
    data = request.json
    
    code = data.get('code')
    msg = data.get('msg')
    callback_data = data.get('data', {})
    task_id = callback_data.get('taskId')
    info = callback_data.get('info', {})
    origin_image_url = info.get('originImageUrl')
    result_image_url = info.get('resultImageUrl')
    
    print(f"收到 Flux 图像生成回调:")
    print(f"任务 ID: {task_id}")
    print(f"状态: {code}, 消息: {msg}")
    
    if code == 200:
        # 任务成功完成
        print("Flux 图像生成成功完成")
        
        print(f"原始图像 URL: {origin_image_url}")
        print(f"生成图像 URL: {result_image_url}")
        print("注意：原始图像 URL 有效期为 10 分钟")
        
        # 下载生成的图像
        if result_image_url:
            try:
                result_filename = f"flux_result_{task_id}.jpg"
                download_file(result_image_url, result_filename)
                print(f"生成图像已下载为 {result_filename}")
            except Exception as e:
                print(f"生成图像下载失败: {e}")
        
        # 下载原始图像（如果需要）
        if origin_image_url:
            try:
                origin_filename = f"flux_original_{task_id}.jpg"
                download_file(origin_image_url, origin_filename)
                print(f"原始图像已下载为 {origin_filename}")
            except Exception as e:
                print(f"原始图像下载失败: {e}")
                
    else:
        # 任务失败
        print(f"Flux 图像生成失败: {msg}")
        
        # 处理特定错误类型
        if code == 400:
            print("内容政策违规 - 请调整提示词")
        elif code == 500:
            print("内部错误 - 请稍后重试")
        elif code == 501:
            print("生成任务失败 - 可能需要调整参数")
    
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
$taskId = $callbackData['taskId'] ?? '';
$info = $callbackData['info'] ?? [];
$originImageUrl = $info['originImageUrl'] ?? '';
$resultImageUrl = $info['resultImageUrl'] ?? '';

error_log("收到 Flux 图像生成回调:");
error_log("任务 ID: $taskId");
error_log("状态: $code, 消息: $msg");

if ($code === 200) {
    // 任务成功完成
    error_log("Flux 图像生成成功完成");
    
    error_log("原始图像 URL: $originImageUrl");
    error_log("生成图像 URL: $resultImageUrl");
    error_log("注意：原始图像 URL 有效期为 10 分钟");
    
    // 下载生成的图像
    if (!empty($resultImageUrl)) {
        try {
            $resultFilename = "flux_result_{$taskId}.jpg";
            downloadFile($resultImageUrl, $resultFilename);
            error_log("生成图像已下载为 $resultFilename");
        } catch (Exception $e) {
            error_log("生成图像下载失败: " . $e->getMessage());
        }
    }
    
    // 下载原始图像（如果需要）
    if (!empty($originImageUrl)) {
        try {
            $originFilename = "flux_original_{$taskId}.jpg";
            downloadFile($originImageUrl, $originFilename);
            error_log("原始图像已下载为 $originFilename");
        } catch (Exception $e) {
            error_log("原始图像下载失败: " . $e->getMessage());
        }
    }
    
} else {
    // 任务失败
    error_log("Flux 图像生成失败: $msg");
    
    // 处理特定错误类型
    if ($code === 400) {
        error_log("内容政策违规 - 请调整提示词");
    } elseif ($code === 500) {
        error_log("内部错误 - 请稍后重试");
    } elseif ($code === 501) {
        error_log("生成任务失败 - 可能需要调整参数");
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
3. **幂等处理**: 同一个 taskId 可能收到多次回调，确保处理逻辑是幂等的
4. **快速响应**: 回调处理应尽快返回 200 状态码，避免超时
5. **异步处理**: 复杂的业务逻辑应异步处理，避免阻塞回调响应
6. **及时下载**: 原始图像 URL 只有 10 分钟有效期，收到成功回调后应及时下载

:::

:::caution 重要提醒

- 回调 URL 必须是公网可访问的地址
- 服务器必须在 15 秒内响应，否则会被认为是超时
- 连续 3 次重试失败后，系统将停止发送回调
- **原始图像 URL 10 分钟后过期** - 收到回调后请及时下载
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 需要处理多种错误状态码（400, 500, 501），实现完整的错误处理
- 注意内容政策违规问题，及时调整提示词

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
<Accordion title="图像处理问题">

- 确认图像 URL 可以正常访问
- 检查图像下载权限和网络连接
- 验证图像保存路径和权限
- **注意 10 分钟原始图像 URL 过期限制** - 实现及时下载逻辑
- 处理生成图像和原始图像的下载

</Accordion>
<Accordion title="内容政策问题">

- 查看错误消息中的内容政策违规提示
- 调整被标记的提示词内容
- 确保提示词符合平台内容准则
- 检查是否包含敏感或不当内容

</Accordion>
<Accordion title="任务失败问题">

- 检查生成参数是否合理
- 验证输入图像格式和质量
- 确认提示词长度和格式
- 考虑调整生成参数后重试

</Accordion>
</AccordionGroup>

## 替代方案

如果无法使用回调机制，您也可以使用轮询方式：

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/flux-kontext-api/get-image-details"
>
  使用获取图像详情接口定期查询任务状态，建议每 30 秒查询一次。
</Card>
