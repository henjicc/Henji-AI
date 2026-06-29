# Aleph 视频生成回调

> 处理 Runway Alpeh 视频生成完成的 webhook 通知
 
## 概述

回调提供了一种高效的方式，当您的 Runway Aleph 视频生成任务完成时接收通知。您的应用程序可以通过 webhook 接收即时通知，无需重复轮询 API，当视频准备就绪时立即得到通知。

:::note[]
回调是生产应用程序的推荐方法，因为它们减少了 API 调用，提高了响应时间，并提供任务完成的即时通知。
:::

:::tip[]
  **Webhook 安全性**：为确保回调请求的真实性和完整性，我们强烈建议您实现 webhook 签名验证。请参阅我们的 [Webhook 校验指南](/cn/common-api/webhook-verification) 了解详细实现步骤。
:::

## 回调工作原理

### 工作流程

1. **提交生成请求**

   在您的视频生成请求中包含 `callBackUrl` 参数：

   ```json
   {
     "prompt": "转换为梦幻水彩画风格，配以柔和流动的运动效果",
     "videoUrl": "https://example.com/input-video.mp4",
     "callBackUrl": "https://your-app.com/webhook/aleph-callback"
   }
   ```

2. **接收任务 ID**

   API 立即返回任务 ID，同时开始处理：

   ```json
   {
     "code": 200,
     "msg": "success",
     "data": {
       "taskId": "ee603959-debb-48d1-98c4-a6d1c717eba6"
     }
   }
   ```

3. **处理回调**

   生成完成时，我们的系统会向您的回调 URL 发送包含结果的 POST 请求。

## 回调负载

视频生成完成时，您将收到包含以下负载的 POST 请求：

### 成功回调

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "result_video_url": "https://file.com/k/xxxxxxx.mp4",
    "result_image_url": "https://file.com/m/xxxxxxxx.png"
  },
  "taskId": "ee603959-debb-48d1-98c4-a6d1c717eba6"
}
```

### 参数说明

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `code` | integer | 是 | 指示结果的状态码 |
| `msg` | string | 是 | 描述结果的可读消息 |
| `data.result_video_url` | string | 是 | 访问和下载生成视频的 URL（有效期 14 天） |
| `data.result_image_url` | string | 是 | 生成视频的缩略图 URL |
| `taskId` | string | 是 | 来自您生成请求的原始任务 ID |

### 状态码详情

| 状态码 | 说明 |
|--------|------|
| 200 | 视频生成成功 |
| 400 | 由于内容政策或技术问题生成失败 |

### 错误回调

```json
{
  "code": 400,
  "msg": "您的提示词被我们的 AI 审查员捕获。请调整后重试！",
  "data": null,
  "taskId": "ee603959-debb-48d1-98c4-a6d1c717eba6"
}
```

## 实现回调端点

以下是用流行编程语言实现回调端点的示例：

<Tabs>
<TabItem value="javascript" label="Node.js/Express">

```javascript
const express = require('express');
const app = express();

// 解析 JSON 的中间件
app.use(express.json());

// Aleph 视频生成的回调端点
app.post('/webhook/aleph-callback', (req, res) => {
  try {
    const { code, msg, data } = req.body;
    
    console.log(`收到任务回调：${data.task_id}`);
    
    if (code === 200) {
      // 成功 - 视频已生成
      console.log('视频生成成功！');
      console.log('视频 URL:', data.video_url);
      console.log('缩略图 URL:', data.image_url);
      
      // 处理成功的生成
      handleSuccessfulGeneration(data);
      
    } else {
      // 生成过程中发生错误
      console.error('生成失败:', msg);
      
      // 处理错误
      handleGenerationError(data.task_id, msg);
    }
    
    // 始终响应 200 以确认收到
    res.status(200).json({ 
      code: 200, 
      msg: '回调接收成功' 
    });
    
  } catch (error) {
    console.error('处理回调时出错:', error);
    res.status(500).json({ 
      code: 500, 
      msg: '处理回调时出错' 
    });
  }
});

async function handleSuccessfulGeneration(data) {
  try {
    // 使用视频信息更新数据库
    await updateTaskStatus(data.task_id, 'completed', {
      videoUrl: data.video_url,
      thumbnailUrl: data.image_url,
      videoId: data.video_id
    });
    
    // 可选择下载并存储视频
    await downloadAndStoreVideo(data.video_url, data.task_id);
    
    // 通知用户或触发工作流程中的下一步
    await notifyUser(data.task_id, '视频生成完成！');
    
  } catch (error) {
    console.error('处理成功生成时出错:', error);
  }
}

async function handleGenerationError(taskId, errorMessage) {
  try {
    // 使用错误状态更新数据库
    await updateTaskStatus(taskId, 'failed', { error: errorMessage });
    
    // 通知用户失败
    await notifyUser(taskId, `视频生成失败：${errorMessage}`);
    
  } catch (error) {
    console.error('处理生成错误时出错:', error);
  }
}

app.listen(3000, () => {
  console.log('Webhook 服务器监听端口 3000');
});
```

</TabItem>
<TabItem value="python" label="Python/Flask">

```python
from flask import Flask, request, jsonify
import logging
import requests
from datetime import datetime

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

@app.route('/webhook/aleph-callback', methods=['POST'])
def aleph_callback():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'code': 400, 'msg': '无效的 JSON 负载'}), 400
        
        code = data.get('code')
        msg = data.get('msg', '')
        callback_data = data.get('data', {})
        task_id = data.get('taskId')
        
        logging.info(f"收到任务回调：{task_id}")
        
        if code == 200:
            # 成功 - 视频已生成
            video_url = callback_data.get('result_video_url')
            image_url = callback_data.get('result_image_url')
            
            logging.info(f"视频生成成功：{video_url}")
            
            # 处理成功生成
            handle_successful_generation(task_id, callback_data)
            
        else:
            # 发生错误
            logging.error(f"任务 {task_id} 生成失败：{msg}")
            handle_generation_error(task_id, msg)
        
        # 始终返回 200 以确认收到
        return jsonify({'code': 200, 'msg': '回调接收成功'})
        
    except Exception as e:
        logging.error(f"处理回调时出错：{str(e)}")
        return jsonify({'code': 500, 'msg': '处理回调时出错'}), 500

def handle_successful_generation(task_id, data):
    """处理成功的视频生成"""
    try:
        # 更新数据库
        update_task_status(task_id, 'completed', {
            'video_url': data['result_video_url'],
            'image_url': data['result_image_url'],
            'completed_at': datetime.utcnow()
        })
        
        # 如需要下载视频
        # download_video(video_url, task_id)
        
        # 发送通知
        notify_user(task_id, '您的 Aleph 视频已准备就绪！')
        
    except Exception as e:
        logging.error(f"处理成功生成时出错：{str(e)}")

def handle_generation_error(task_id, error_message):
    """处理生成错误"""
    try:
        # 更新数据库
        update_task_status(task_id, 'failed', {
            'error_message': error_message,
            'failed_at': datetime.utcnow()
        })
        
        # 发送错误通知
        notify_user(task_id, f'视频生成失败：{error_message}')
        
    except Exception as e:
        logging.error(f"处理生成错误时出错：{str(e)}")

def update_task_status(task_id, status, additional_data=None):
    """在数据库中更新任务状态"""
    # 在此处实现您的数据库更新逻辑
    logging.info(f"更新任务 {task_id} 状态为 {status}")

def notify_user(task_id, message):
    """发送用户通知"""
    # 在此处实现您的通知逻辑
    logging.info(f"为任务 {task_id} 通知用户：{message}")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
<?php
header('Content-Type: application/json');

// 启用错误日志记录
error_reporting(E_ALL);
ini_set('log_errors', 1);
ini_set('error_log', 'callback_errors.log');

try {
    // 获取 JSON 输入
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    
    if (!$data) {
        http_response_code(400);
        echo json_encode(['code' => 400, 'msg' => '无效的 JSON 负载']);
        exit;
    }
    
    $code = $data['code'] ?? null;
    $msg = $data['msg'] ?? '';
    $callbackData = $data['data'] ?? [];
    $taskId = $callbackData['task_id'] ?? null;
    
    error_log("收到任务回调：" . $taskId);
    
    if ($code === 200) {
        // 成功 - 视频已生成
        $videoUrl = $callbackData['video_url'] ?? '';
        $imageUrl = $callbackData['image_url'] ?? '';
        $videoId = $callbackData['video_id'] ?? '';
        
        error_log("视频生成成功：" . $videoUrl);
        
        handleSuccessfulGeneration($taskId, $videoUrl, $imageUrl, $videoId);
        
    } else {
        // 发生错误
        error_log("任务 $taskId 生成失败：" . $msg);
        handleGenerationError($taskId, $msg);
    }
    
    // 始终返回 200 以确认收到
    http_response_code(200);
    echo json_encode(['code' => 200, 'msg' => '回调接收成功']);
    
} catch (Exception $e) {
    error_log("处理回调时出错：" . $e->getMessage());
    http_response_code(500);
    echo json_encode(['code' => 500, 'msg' => '处理回调时出错']);
}

function handleSuccessfulGeneration($taskId, $videoUrl, $imageUrl, $videoId) {
    try {
        // 更新数据库
        updateTaskStatus($taskId, 'completed', [
            'video_url' => $videoUrl,
            'image_url' => $imageUrl,
            'video_id' => $videoId,
            'completed_at' => date('Y-m-d H:i:s')
        ]);
        
        // 发送通知
        notifyUser($taskId, '您的 Aleph 视频已准备就绪！');
        
    } catch (Exception $e) {
        error_log("处理成功生成时出错：" . $e->getMessage());
    }
}

function handleGenerationError($taskId, $errorMessage) {
    try {
        // 更新数据库
        updateTaskStatus($taskId, 'failed', [
            'error_message' => $errorMessage,
            'failed_at' => date('Y-m-d H:i:s')
        ]);
        
        // 发送通知
        notifyUser($taskId, "视频生成失败：$errorMessage");
        
    } catch (Exception $e) {
        error_log("处理生成错误时出错：" . $e->getMessage());
    }
}

function updateTaskStatus($taskId, $status, $additionalData = []) {
    // 在此处实现您的数据库更新逻辑
    error_log("更新任务 $taskId 状态为 $status");
    
    // 使用 PDO 的示例：
    /*
    $pdo = new PDO($dsn, $username, $password);
    $stmt = $pdo->prepare("UPDATE tasks SET status = ?, updated_at = NOW() WHERE task_id = ?");
    $stmt->execute([$status, $taskId]);
    */
}

function notifyUser($taskId, $message) {
    // 在此处实现您的通知逻辑
    error_log("为任务 $taskId 通知用户：$message");
    
    // 示例：发送邮件、推送通知等
}
?>
```

</TabItem>
</Tabs>

## 安全最佳实践

<AccordionGroup>
<Accordion title="验证回调来源">

**验证请求来源：**

- 检查来自 kie.ai 的请求的 `User-Agent` 头
- 考虑实现 IP 白名单以增加安全性
- 在处理前验证回调负载结构

```javascript
// 示例：基本验证
app.post('/webhook/aleph-callback', (req, res) => {
  // 验证必需字段
  const { code, data } = req.body;
  
  if (typeof code !== 'number' || !data || !data.task_id) {
    return res.status(400).json({ 
      code: 400, 
      msg: '无效的回调负载' 
    });
  }
  
  // 处理有效回调
  // ...
});
```

</Accordion>
<Accordion title="处理重复回调">

**实现幂等性：**

- 跟踪已处理的任务 ID 以避免重复处理
- 使用数据库约束或缓存防止竞态条件

```javascript
const processedTasks = new Set();

app.post('/webhook/aleph-callback', (req, res) => {
  const taskId = req.body.data?.task_id;
  
  if (processedTasks.has(taskId)) {
    console.log(`任务 ${taskId} 已处理，跳过`);
    return res.status(200).json({ code: 200, msg: '已处理' });
  }
  
  // 处理回调
  processCallback(req.body);
  processedTasks.add(taskId);
  
  res.status(200).json({ code: 200, msg: '处理成功' });
});
```

</Accordion>
<Accordion title="错误处理和重试逻辑">

**健壮的错误处理：**

- 始终为成功的回调接收返回 HTTP 200
- 记录错误以供调试，但不要暴露内部详细信息
- 为关键操作实现重试逻辑

```javascript
app.post('/webhook/aleph-callback', async (req, res) => {
  try {
    await processCallbackWithRetry(req.body);
    res.status(200).json({ code: 200, msg: '成功' });
  } catch (error) {
    // 记录错误但仍返回 200 以防止重试
    console.error('回调处理错误:', error);
    res.status(200).json({ code: 200, msg: '已接收' });
  }
});

async function processCallbackWithRetry(data, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await processCallback(data);
      return; // 成功
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delay = Math.pow(2, attempt) * 1000; // 指数退避
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

</Accordion>
</AccordionGroup>

## 测试回调

### 本地开发

对于本地测试，使用 ngrok 等工具暴露您的本地服务器：

```bash
# 安装 ngrok
npm install -g ngrok

# 暴露本地端口 3000
ngrok http 3000

# 使用提供的 HTTPS URL 作为您的回调 URL
# 示例：https://abc123.ngrok.io/webhook/aleph-callback
```

### Webhook 测试工具

<CardGroup cols={2}>
  <Card
    title="Webhook.site"
    icon="globe"
    href="https://webhook.site"
  >
    生成临时 URL 来测试回调负载
  </Card>

  <Card
    title="RequestBin"
    icon="inbox"
    href="https://requestbin.com"
  >
    检查和调试 webhook 请求
  </Card>
</CardGroup>

## 故障排除

<AccordionGroup>
<Accordion title="未收到回调">

**常见问题：**

- 回调 URL 不可公开访问
- 服务器返回非 200 状态码
- 防火墙阻止传入请求
- HTTPS URL 的 SSL 证书问题

**解决方案：**

- 使用 curl 或 Postman 等工具测试您的回调 URL
- 确保您的服务器响应 HTTP 200 状态
- 检查服务器日志中的传入请求
- 验证 SSL 证书是否有效

</Accordion>
<Accordion title="重复或丢失的回调">

**回调传递：**

- 我们的系统最多重试失败的回调 3 次
- 每个任务完成只发送一次回调
- 如果您的服务器宕机，回调可能会丢失

**最佳实践：**

- 实现幂等性以处理潜在的重复
- 对关键任务使用轮询作为备份
- 监控回调接收并在缺少通知时发出警报

</Accordion>
<Accordion title="回调负载问题">

**数据验证：**

- 始终验证回调负载结构
- 优雅地处理缺失或意外的字段
- 记录负载内容以供调试

```javascript
function validateCallback(payload) {
  const required = ['code', 'msg', 'data'];
  const missing = required.filter(field => !(field in payload));
  
  if (missing.length > 0) {
    throw new Error(`缺少必需字段：${missing.join(', ')}`);
  }
  
  if (payload.code === 200 && payload.data) {
    const dataRequired = ['task_id', 'video_url', 'image_url'];
    const dataMissing = dataRequired.filter(field => !(field in payload.data));
    
    if (dataMissing.length > 0) {
      throw new Error(`缺少数据字段：${dataMissing.join(', ')}`);
    }
  }
}
```

</Accordion>
</AccordionGroup>

## 相关文档

<CardGroup cols={2}>
  <Card
    title="生成 Aleph 视频"
    icon="lucide-video"
    href="/cn/runway-api/generate-aleph-video"
  >
    学习如何创建带有回调的视频生成请求
  </Card>

  <Card
    title="获取任务详情"
    icon="lucide-search"
    href="/cn/runway-api/get-aleph-video-details"
  >
    检查任务状态的替代轮询方法
  </Card>
</CardGroup>

---

:::note 需要帮助
请联系我们的支持团队 [support@kie.ai](mailto:support@kie.ai) 获取回调实现的帮助。
:::
