# 4o 图片生成回调


>当4o Image任务完成后，系统会向您提供的回调URL发送POST请求通知结果

当您向4o Image API提交图片生成任务时，可以使用 `callBackUrl` 参数设置回调URL。任务完成时，系统将自动向您指定的地址推送结果。

## 回调机制概述

:::note[]
回调机制消除了轮询API获取任务状态的需要。系统会主动向您的服务器推送任务完成结果。
:::

:::tip[]
  **Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

### 回调时机

系统将在以下情况发送回调通知：

- 4o 图片生成任务成功完成
- 4o 图片生成任务失败
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
    "taskId": "task12345",
    "info": {
      "result_urls": [
        "https://example.com/result/image1.png"
      ]
    }
  }
}
```

</TabItem>
<TabItem value="failure" label="失败回调">

```json
{
  "code": 400,
  "msg": "您的内容被 OpenAI 标记为违反内容政策",
  "data": {
    "taskId": "task12345",
    "info": null
  }
}
```

</TabItem>
</Tabs>

## 状态码说明

### 参数说明

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `code` | integer | 是 | 回调状态码，表示任务处理结果 |
| `msg` | string | 是 | 状态消息，提供更详细的状态描述 |
| `data.taskId` | string | 是 | 任务ID，与您提交任务时返回的taskId一致 |
| `data.info` | object | 否 | 图片生成结果信息，成功时返回 |
| `data.info.result_urls` | array | 否 | 生成的图片URL列表，成功时返回可访问的下载链接 |

### 状态码详情

| 状态码 | 描述 |
|--------|------|
| 200 | 成功 - 图片生成完成 |
| 400 | 参数错误 - filesUrl 参数中的图片内容违反内容政策、图片尺寸超过最大限制、无法处理提供的图片文件、内容被 OpenAI 标记为违反内容政策 |
| 451 | 下载失败 - 无法从提供的 filesUrl 下载图片 |
| 500 | 服务器错误 - 请稍后重试、获取用户令牌失败、生成图片失败、GPT 4O 编辑图片失败 |

## 回调接收示例

以下是常用编程语言接收回调的示例代码：

<Tabs>
<TabItem value="javascript" label="Node.js">

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/4o-image-callback', (req, res) => {
  const { code, msg, data } = req.body;
  
  console.log('收到4o图片生成回调:', {
    taskId: data.taskId,
    status: code,
    message: msg
  });
  
  if (code === 200) {
    // 任务成功完成
    console.log('4o图片生成完成');
    const resultUrls = data.info?.result_urls || [];
    
    console.log(`共生成 ${resultUrls.length} 张图片:`);
    resultUrls.forEach((url, index) => {
      console.log(`图片 ${index + 1}: ${url}`);
    });
    
    // 处理生成的图片
    // 可以下载图片、保存到本地等
    
  } else {
    // 任务失败
    console.log('4o图片生成失败:', msg);
    
    // 处理失败情况...
    if (code === 400) {
      console.log('内容政策违规或参数错误');
    } else if (code === 451) {
      console.log('图片下载失败');
    } else if (code === 500) {
      console.log('服务器内部错误');
    }
  }
  
  // 返回200状态码确认收到回调
  res.status(200).json({ status: 'received' });
});

app.listen(3000, () => {
  console.log('回调服务器运行在端口3000');
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
from flask import Flask, request, jsonify
import requests

app = Flask(__name__)

@app.route('/4o-image-callback', methods=['POST'])
def handle_callback():
    data = request.json
    
    code = data.get('code')
    msg = data.get('msg')
    callback_data = data.get('data', {})
    task_id = callback_data.get('taskId')
    info = callback_data.get('info')
    
    print(f"收到4o图片生成回调: {task_id}, 状态: {code}, 消息: {msg}")
    
    if code == 200:
        # 任务成功完成
        print("4o图片生成完成")
        result_urls = info.get('result_urls', []) if info else []
        
        print(f"共生成 {len(result_urls)} 张图片:")
        for i, url in enumerate(result_urls):
            print(f"图片 {i + 1}: {url}")
            
            # 下载图片示例
            try:
                response = requests.get(url)
                if response.status_code == 200:
                    filename = f"4o_image_{task_id}_{i + 1}.png"
                    with open(filename, "wb") as f:
                        f.write(response.content)
                    print(f"图片已保存为 {filename}")
            except Exception as e:
                print(f"下载图片失败: {e}")
                
    else:
        # 任务失败
        print(f"4o图片生成失败: {msg}")
        
        # 处理失败情况...
        if code == 400:
            print("内容政策违规或参数错误")
        elif code == 451:
            print("图片下载失败")
        elif code == 500:
            print("服务器内部错误")
    
    # 返回200状态码确认收到回调
    return jsonify({'status': 'received'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3000)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
<?php
header('Content-Type: application/json');

// 获取POST数据
$input = file_get_contents('php://input');
$data = json_decode($input, true);

$code = $data['code'] ?? null;
$msg = $data['msg'] ?? '';
$callbackData = $data['data'] ?? [];
$taskId = $callbackData['taskId'] ?? '';
$info = $callbackData['info'] ?? null;

error_log("收到4o图片生成回调: $taskId, 状态: $code, 消息: $msg");

if ($code === 200) {
    // 任务成功完成
    error_log("4o图片生成完成");
    $resultUrls = $info['result_urls'] ?? [];
    
    error_log("共生成 " . count($resultUrls) . " 张图片:");
    foreach ($resultUrls as $index => $url) {
        error_log("图片 " . ($index + 1) . ": $url");
        
        // 下载图片示例
        try {
            $imageContent = file_get_contents($url);
            if ($imageContent !== false) {
                $filename = "4o_image_{$taskId}_" . ($index + 1) . ".png";
                file_put_contents($filename, $imageContent);
                error_log("图片已保存为 $filename");
            }
        } catch (Exception $e) {
            error_log("下载图片失败: " . $e->getMessage());
        }
    }
    
} else {
    // 任务失败
    error_log("4o图片生成失败: $msg");
    
    // 处理失败情况...
    if ($code === 400) {
        error_log("内容政策违规或参数错误");
    } elseif ($code === 451) {
        error_log("图片下载失败");
    } elseif ($code === 500) {
        error_log("服务器内部错误");
    }
}

// 返回200状态码确认收到回调
http_response_code(200);
echo json_encode(['status' => 'received']);
?>
```

</TabItem>
</Tabs>

## 最佳实践

:::tip 回调URL配置建议

1. **使用HTTPS**: 确保回调URL使用HTTPS协议以保证数据传输安全
2. **验证来源**: 在回调处理中验证请求来源的合法性
3. **幂等处理**: 同一taskId可能收到多次回调，确保处理逻辑是幂等的
4. **快速响应**: 回调处理应尽快返回200状态码以避免超时
5. **异步处理**: 复杂的业务逻辑应异步处理以避免阻塞回调响应
6. **图片处理**: 图片下载和处理应在异步任务中进行，避免阻塞回调响应

:::

:::caution 重要提醒

- 回调URL必须是公开可访问的地址
- 服务器必须在15秒内响应，否则将被认为超时
- 如果连续3次重试失败，系统将停止发送回调
- 请确保回调处理逻辑的稳定性，避免因异常导致回调失败
- 生成的图片URL可能有时效性，建议及时下载保存
- 注意内容政策合规，避免违规内容导致生成失败

:::

## 故障排查

如果您未收到回调通知，请检查以下内容：

<AccordionGroup>
<Accordion title="网络连接问题">

- 确认回调URL可以从公网访问
- 检查防火墙设置，确保入站请求未被阻止
- 验证域名解析是否正确

</Accordion>
<Accordion title="服务器响应问题">

- 确保服务器在15秒内返回HTTP 200状态码
- 检查服务器日志是否有错误消息
- 验证接口路径和HTTP方法是否正确

</Accordion>
<Accordion title="内容格式问题">

- 确认收到的POST请求体为JSON格式
- 检查Content-Type是否为application/json
- 验证JSON解析是否正确

</Accordion>
<Accordion title="图片处理问题">

- 确认图片URL是否可访问
- 检查图片下载权限和网络连接
- 验证图片保存路径和权限
- 注意图片内容是否符合内容政策

</Accordion>
</AccordionGroup>

## 替代方案

如果您无法使用回调机制，也可以使用轮询方式：

<Card
  title="轮询查询结果"
  icon="lucide-radar"
  href="/cn/4o-image-api/get-4-o-image-details"
>
  使用获取4o图片详情端点定期查询任务状态。我们建议每30秒查询一次。
</Card>
