# 4o Image API 快速开始

>几分钟内开始使用 4o Image API 生成高质量的AI图像

## 欢迎使用 4o Image API

4o Image API 基于强大的 GPT-4o 模型，为您提供高质量的AI图像生成服务。无论是文本转图像、图像编辑还是图像变体生成，我们的API都能满足您的创作需求。


<CardGroup cols={2}>
  <Card
    title="文本转图像"
    icon="lucide-wand-sparkles"
    href="/cn/4o-image-api/generate-4-o-image"
  >
    从文本描述生成高质量图像
  </Card>

  <Card
    title="图像编辑"
    icon="lucide-image"
    href="/cn/4o-image-api/generate-4-o-image"
  >
    使用蒙版和提示词编辑现有图像
  </Card>

  <Card
    title="图像变体"
    icon="lucide-book-copy"
    href="/cn/4o-image-api/generate-4-o-image"
  >
    基于输入图像生成多个创意变体
  </Card>

  <Card
    title="任务管理"
    icon="lucide-list-checks"
    href="/cn/4o-image-api/get-4-o-image-details"
  >
    跟踪和监控您的图像生成任务
  </Card>
</CardGroup>

## 身份验证

所有 API 请求都需要使用 Bearer 令牌进行身份验证。请从 [API 密钥管理页面](https://kie.ai/api-key) 获取您的 API 密钥。

:::caution[]
请妥善保管您的 API 密钥，切勿公开分享。如果怀疑密钥泄露，请立即重置。
:::

### API 基础 URL

```
https://api.kie.ai
```

### 身份验证请求头

```http
Authorization: Bearer YOUR_API_KEY
```

## 快速开始指南

### 第一步：生成您的第一个图像

从一个简单的文本转图像生成请求开始：

<Tabs>
<TabItem value="javascript" label="Node.js">

```javascript
async function generateImage() {
  try {
    const response = await fetch('https://api.kie.ai/api/v1/gpt4o-image/generate', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: '一幅宁静的山景，日落时湖泊倒映着橙色天空，风格写实',
        size: '1:1',
        nVariants: 1
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.code === 200) {
      console.log('任务已提交:', data);
      console.log('任务ID:', data.data.taskId);
      return data.data.taskId;
    } else {
      console.error('请求失败:', data.msg || '未知错误');
      return null;
    }
  } catch (error) {
    console.error('错误:', error.message);
    return null;
  }
}

generateImage();
```

</TabItem>
<TabItem value="python" label="Python">

```python
import requests

def generate_image():
    url = "https://api.kie.ai/api/v1/gpt4o-image/generate"
    headers = {
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json"
    }
    
    payload = {
        "prompt": "一幅宁静的山景，日落时湖泊倒映着橙色天空，风格写实",
        "size": "1:1",
        "nVariants": 1
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        result = response.json()
        
        if response.ok and result.get('code') == 200:
            print(f"任务已提交: {result}")
            print(f"任务ID: {result['data']['taskId']}")
            return result['data']['taskId']
        else:
            print(f"请求失败: {result.get('msg', '未知错误')}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"错误: {e}")
        return None

generate_image()
```

</TabItem>
<TabItem value="curl" label="cURL">

```bash
curl -X POST "https://api.kie.ai/api/v1/gpt4o-image/generate" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "一幅宁静的山景，日落时湖泊倒映着橙色天空，风格写实",
    "size": "1:1",
    "nVariants": 1
  }'
```

</TabItem>
</Tabs>

### 第二步：检查任务状态

使用返回的任务ID检查生成状态：

<Tabs>
<TabItem value="javascript" label="Node.js">

```javascript
async function checkTaskStatus(taskId) {
  try {
    const response = await fetch(`https://api.kie.ai/api/v1/gpt4o-image/record-info?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY'
      }
    });
    
    const result = await response.json();
    
    if (response.ok && result.code === 200) {
      const taskData = result.data;
      
      switch (taskData.status) {
        case 'SUCCESS':
          console.log('图像生成成功！');
          console.log('图像URLs:', taskData.response.result_urls);
          return taskData;
          
        case 'GENERATING':
          const progress = taskData.progress ? `${(parseFloat(taskData.progress) * 100).toFixed(0)}%` : '进行中';
          console.log(`正在生成中... 进度: ${progress}`);
          return taskData;
          
        case 'CREATE_TASK_FAILED':
          console.log('创建任务失败');
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          return taskData;
          
        case 'GENERATE_FAILED':
          console.log('图像生成失败');
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          return taskData;
          
        default:
          console.log('未知状态:', taskData.status);
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          return taskData;
      }
    } else {
      console.error('查询失败:', result.msg || '未知错误');
      return null;
    }
  } catch (error) {
    console.error('查询状态失败:', error.message);
    return null;
  }
}
```

</TabItem>
<TabItem value="python" label="Python">

```python
import requests
import time

def check_task_status(task_id, api_key):
    url = f"https://api.kie.ai/api/v1/gpt4o-image/record-info?taskId={task_id}"
    headers = {"Authorization": f"Bearer {api_key}"}
    
    try:
        response = requests.get(url, headers=headers)
        result = response.json()
        
        if response.ok and result.get('code') == 200:
            task_data = result['data']
            status = task_data['status']
            
            if status == 'SUCCESS':
                print("图像生成成功！")
                result_urls = task_data['response']['result_urls']
                for i, url in enumerate(result_urls):
                    print(f"图像 {i+1}: {url}")
                return task_data
            elif status == 'GENERATING':
                progress = f"{int(float(task_data.get('progress', 0)) * 100)}%" if task_data.get('progress') else '进行中'
                print(f"正在生成中... 进度: {progress}")
                return task_data
            elif status == 'CREATE_TASK_FAILED':
                print("创建任务失败")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                return task_data
            elif status == 'GENERATE_FAILED':
                print("图像生成失败")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                return task_data
            else:
                print(f"未知状态: {status}")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                return task_data
        else:
            print(f"查询失败: {result.get('msg', '未知错误')}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"查询状态失败: {e}")
        return None

# 轮询直到完成
def wait_for_completion(task_id, api_key):
    while True:
        result = check_task_status(task_id, api_key)
        if result is not None:
            # 检查是否为最终状态
            if result['status'] in ['SUCCESS', 'CREATE_TASK_FAILED', 'GENERATE_FAILED']:
                return result
            # 如果是GENERATING状态，继续等待
            time.sleep(10)  # 等待10秒后再次检查
```

</TabItem>
<TabItem value="curl" label="cURL">

```bash
curl -X GET "https://api.kie.ai/api/v1/gpt4o-image/record-info?taskId=YOUR_TASK_ID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

</TabItem>
</Tabs>

### 响应格式

**成功响应：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_4o_abc123"
  }
}
```

**任务状态响应（生成中）：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "d231a99a9a9f1dd8f895be1b97be8065",
    "paramJson": "{\"callBackUrl\":\"playground\",\"enableFallback\":true}",
    "completeTime": null,
    "response": null,
    "successFlag": 0,
    "status": "GENERATING",
    "errorCode": null,
    "errorMessage": null,
    "createTime": 1755572609000,
    "progress": "0.48"
  }
}
```

**任务状态响应（成功）：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_4o_abc123",
    "status": "SUCCESS",
    "response": {
      "result_urls": [
        "https://example.com/generated-image.png"
      ]
    },
    "successFlag": 1,
    "progress": "1.00",
    "completeTime": 1755572669000,
    "createTime": 1755572609000,
    "errorCode": null,
    "errorMessage": null
  }
}
```

**任务状态响应（失败）：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_4o_abc123",
    "status": "GENERATE_FAILED",
    "response": null,
    "successFlag": 2,
    "progress": "0.00",
    "completeTime": 1755572669000,
    "createTime": 1755572609000,
    "errorCode": 400,
    "errorMessage": "图像内容违反了内容政策，请修改提示词后重试"
  }
}
```

## 核心功能

### 文本转图像

从文本描述生成高质量图像：

```json
{
  "prompt": "一只可爱的橙色小猫坐在彩虹上，卡通风格，明亮的色彩",
  "size": "1:1",
  "nVariants": 2,
  "isEnhance": false
}
```

### 图像编辑

使用蒙版和提示词编辑现有图像：

```json
{
  "filesUrl": ["https://example.com/original-image.jpg"],
  "maskUrl": "https://example.com/mask-image.png",
  "prompt": "将天空替换成星空夜景",
  "size": "3:2"
}
```

### 图像变体

基于输入图像生成创意变体：

```json
{
  "filesUrl": ["https://example.com/base-image.jpg"],
  "prompt": "保持主要元素，改变为水彩画风格",
  "size": "2:3",
  "nVariants": 4
}
```

## 图像尺寸支持

支持三种标准图像比例：

<CardGroup cols={3}>
  <Card title="1:1" icon="lucide-square">
    **方形**

    适合社交媒体帖子、头像、产品展示
  </Card>

  <Card title="3:2" icon="lucide-rectangle-horizontal">
    **横向**

    适合风景照片、桌面壁纸、展示横幅
  </Card>

  <Card title="2:3" icon="lucide-rectangle-vertical">
    **纵向**

    适合人物肖像、手机壁纸、海报设计
  </Card>
</CardGroup>

## 关键参数

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `prompt` | string | 是 | 图像生成的文本描述 |
| `size` | string | 是 | 图像尺寸比例："1:1"、"3:2" 或 "2:3" |
| `filesUrl` | array | 否 | 输入图像URL列表，最多支持5张图片 |
| `maskUrl` | string | 否 | 蒙版图像URL，用于指定需要编辑的区域 |
| `nVariants` | integer | 否 | 生成图像的变体数量（1、2 或 4） |
| `isEnhance` | boolean | 否 | 提示词增强选项（默认：false） |
| `enableFallback` | boolean | 否 | 启用托底机制（默认：false） |

### 提示词技巧

- 描述主要对象和场景
- 指定艺术风格（如"写实"、"卡通"、"水彩"）
- 添加色彩和光线描述
- 包含情绪和氛围要素

## 完整工作流程示例

以下是一个完整的图像生成和编辑示例：

<Tabs>
<TabItem value="javascript" label="JavaScript">

```javascript
class FourOImageAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.kie.ai/api/v1/gpt4o-image';
  }
  
  async generateImage(options) {
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options)
    });
    
    const result = await response.json();
    if (!response.ok || result.code !== 200) {
      throw new Error(`生成失败: ${result.msg || '未知错误'}`);
    }
    
    return result.data.taskId;
  }
  
  async waitForCompletion(taskId, maxWaitTime = 300000) { // 最长等待5分钟
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getTaskStatus(taskId);
      
      switch (status.status) {
        case 'SUCCESS':
          console.log('图像生成成功！');
          return status.response;
          
        case 'GENERATING':
          const progress = status.progress ? `${(parseFloat(status.progress) * 100).toFixed(0)}%` : '进行中';
          console.log(`正在生成中... 进度: ${progress}`);
          break;
          
        case 'CREATE_TASK_FAILED':
          const createError = status.errorMessage || '创建任务失败';
          console.error('错误信息:', createError);
          throw new Error(createError);
          
        case 'GENERATE_FAILED':
          const generateError = status.errorMessage || '图像生成失败';
          console.error('错误信息:', generateError);
          throw new Error(generateError);
          
        default:
          console.log('未知状态:', status.status);
          if (status.errorMessage) {
            console.error('错误信息:', status.errorMessage);
          }
          break;
      }
      
      // 等待10秒后再次检查
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    throw new Error('生成超时');
  }
  
  async getTaskStatus(taskId) {
    const response = await fetch(`${this.baseUrl}/record-info?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
    
    const result = await response.json();
    if (!response.ok || result.code !== 200) {
      throw new Error(`查询状态失败: ${result.msg || '未知错误'}`);
    }
    return result.data;
  }
  
  async getDownloadUrl(imageUrl) {
    const response = await fetch(`${this.baseUrl}/download-url`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ imageUrl })
    });
    
    const result = await response.json();
    if (!response.ok || result.code !== 200) {
      throw new Error(`获取下载URL失败: ${result.msg || '未知错误'}`);
    }
    return result.data.downloadUrl;
  }
}

// 使用示例
async function main() {
  const api = new FourOImageAPI('YOUR_API_KEY');
  
  try {
    // 文本转图像生成
    console.log('开始生成图像...');
    const taskId = await api.generateImage({
      prompt: '一个未来主义的城市景观，有飞行汽车和霓虹灯，赛博朋克风格',
      size: '16:9',
      nVariants: 2,
      isEnhance: true,
      enableFallback: true
    });
    
    // 等待完成
    console.log(`任务ID: ${taskId}。等待完成...`);
    const result = await api.waitForCompletion(taskId);
    
    console.log('图像生成成功！');
    result.result_urls.forEach((url, index) => {
      console.log(`图像 ${index + 1}: ${url}`);
    });
    
    // 获取下载URL
    const downloadUrl = await api.getDownloadUrl(result.result_urls[0]);
    console.log('下载URL:', downloadUrl);
    
    // 图像编辑示例
    console.log('\n开始图像编辑...');
    const editTaskId = await api.generateImage({
      filesUrl: [result.result_urls[0]],
      prompt: '在天空中添加美丽的彩虹',
      size: '3:2'
    });
    
    const editResult = await api.waitForCompletion(editTaskId);
    console.log('图像编辑成功！');
    console.log('编辑后图像:', editResult.result_urls[0]);
    
  } catch (error) {
    console.error('错误:', error.message);
  }
}

main();
```

</TabItem>
<TabItem value="python" label="Python">

```python
import requests
import time

class FourOImageAPI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = 'https://api.kie.ai/api/v1/gpt4o-image'
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    
    def generate_image(self, **options):
        response = requests.post(f'{self.base_url}/generate', 
                               headers=self.headers, json=options)
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"生成失败: {result.get('msg', '未知错误')}")
        
        return result['data']['taskId']
    
    def wait_for_completion(self, task_id, max_wait_time=300):
        start_time = time.time()
        
        while time.time() - start_time < max_wait_time:
            status = self.get_task_status(task_id)
            
            if status['status'] == 'SUCCESS':
                print("图像生成成功！")
                return status['response']
            elif status['status'] == 'GENERATING':
                progress = f"{int(float(status.get('progress', 0)) * 100)}%" if status.get('progress') else '进行中'
                print(f"正在生成中... 进度: {progress}")
            elif status['status'] == 'CREATE_TASK_FAILED':
                error_msg = status.get('errorMessage', '创建任务失败')
                print(f"错误信息: {error_msg}")
                raise Exception(error_msg)
            elif status['status'] == 'GENERATE_FAILED':
                error_msg = status.get('errorMessage', '图像生成失败')
                print(f"错误信息: {error_msg}")
                raise Exception(error_msg)
            else:
                print(f"未知状态: {status['status']}")
                if status.get('errorMessage'):
                    print(f"错误信息: {status['errorMessage']}")
            
            time.sleep(10)  # 等待10秒
        
        raise Exception('生成超时')
    
    def get_task_status(self, task_id):
        response = requests.get(f'{self.base_url}/record-info?taskId={task_id}',
                              headers={'Authorization': f'Bearer {self.api_key}'})
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"查询状态失败: {result.get('msg', '未知错误')}")
        
        return result['data']
    
    def get_download_url(self, image_url):
        response = requests.post(f'{self.base_url}/download-url',
                               headers=self.headers, 
                               json={'imageUrl': image_url})
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"获取下载URL失败: {result.get('msg', '未知错误')}")
        
        return result['data']['downloadUrl']

# 使用示例
def main():
    api = FourOImageAPI('YOUR_API_KEY')
    
    try:
        # 文本转图像生成
        print('开始生成图像...')
        task_id = api.generate_image(
            prompt='一个未来主义的城市景观，有飞行汽车和霓虹灯，赛博朋克风格',
            size='1:1',
            nVariants=2,
            isEnhance=True,
            enableFallback=True
        )
        
        # 等待完成
        print(f'任务ID: {task_id}。等待完成...')
        result = api.wait_for_completion(task_id)
        
        print('图像生成成功！')
        for i, url in enumerate(result['result_urls']):
            print(f'图像 {i + 1}: {url}')
        
        # 获取下载URL
        download_url = api.get_download_url(result['result_urls'][0])
        print(f'下载URL: {download_url}')
        
        # 图像编辑示例
        print('\n开始图像编辑...')
        edit_task_id = api.generate_image(
            filesUrl=[result['result_urls'][0]],
            prompt='在天空中添加美丽的彩虹',
            size='3:2'
        )
        
        edit_result = api.wait_for_completion(edit_task_id)
        print('图像编辑成功！')
        print(f'编辑后图像: {edit_result["result_urls"][0]}')
        
    except Exception as error:
        print(f'错误: {error}')

if __name__ == '__main__':
    main()
```

</TabItem>
</Tabs>

## 高级功能

### 蒙版编辑

使用蒙版进行精确的图像编辑：

```javascript
const editTaskId = await api.generateImage({
  filesUrl: ['https://example.com/original.jpg'],
  maskUrl: 'https://example.com/mask.png',
  prompt: '将蒙版区域替换为美丽的花园',
  size: '3:2'
});
```

:::note[]
蒙版图像中的黑色区域将被编辑，白色区域保持不变。蒙版必须与原图尺寸一致。
:::

### 托底机制

启用托底机制确保服务可靠性：

```javascript
const taskId = await api.generateImage({
  prompt: '艺术概念设计',
  size: '1:1',
  enableFallback: true,
  fallbackModel: 'FLUX_MAX' // 或 'GPT_IMAGE_1'
});
```

### 使用回调

设置webhook回调以获得自动通知：

```javascript
const taskId = await api.generateImage({
  prompt: '数字艺术作品',
  size: '1:1',
  callBackUrl: 'https://your-server.com/4o-callback'
});

// 您的回调端点将接收：
app.post('/4o-callback', (req, res) => {
  const { code, data } = req.body;
  
  if (code === 200) {
    console.log('图像准备就绪:', data.info.result_urls);
  } else {
    console.log('生成失败:', req.body.msg);
  }
  
  res.status(200).json({ status: 'received' });
});
```

<Card
  title="了解更多关于回调"
  icon="webhook"
  href="/cn/4o-image-api/generate-4-o-image-callbacks"
>
  设置webhook回调以在图像准备就绪时接收自动通知。
</Card>

## 任务状态说明

| 状态 | 描述 |
|------|------|
| `GENERATING` | 任务正在处理中，请等待 |
| `SUCCESS` | 图像生成任务成功完成，可获取生成的图像 |
| `CREATE_TASK_FAILED` | 任务创建失败，请检查参数或联系技术支持 |
| `GENERATE_FAILED` | 图像生成过程失败，可能由于内容违规、资源不足等原因 |

### 响应字段说明

| 参数 | 类型 | 描述 |
|------|------|------|
| `successFlag` | integer | 成功标志：0（生成中）、1（成功）、2（失败） |
| `progress` | string | 生成进度，范围从 "0.00" 到 "1.00" |
| `createTime` | integer | 任务创建时间戳（毫秒） |
| `completeTime` | integer | 任务完成时间戳（毫秒），未完成时为 null |

## 最佳实践


<AccordionGroup>
<Accordion title="提示词优化">

- 使用详细、具体的描述
- 包含风格和技法描述（如"写实"、"印象派"、"数字艺术"）
- 指定色彩、光线和构图要求
- 避免过于复杂或矛盾的描述

</Accordion>
<Accordion title="图像质量">

- 选择合适的尺寸比例适配您的用途
- 对于复杂场景考虑启用提示词增强
- 使用高质量的输入图像进行编辑
- 确保蒙版图像准确标记编辑区域

</Accordion>
<Accordion title="性能优化">

- 使用回调而不是频繁轮询
- 启用托底机制确保服务可靠性
- 合理设置变体数量平衡质量和成本
- 及时下载图像，避免14天后过期

</Accordion>
<Accordion title="错误处理">

- 实施适当的重试逻辑，特别是对于网络相关错误
- 监控所有任务状态，包括 GENERATING、SUCCESS、CREATE_TASK_FAILED、GENERATE_FAILED
- 当任务失败时，始终检查并记录 errorMessage 字段的内容
- 验证输入图像的可访问性和格式兼容性
- 对于 CREATE_TASK_FAILED，检查参数是否符合API要求
- 对于 GENERATE_FAILED，检查是否存在内容违规或技术问题
- 记录完整的错误信息用于调试和问题排查

</Accordion>
</AccordionGroup>

## 图像存储和下载

:::caution[]
生成的图像存储 **14天** 后自动删除。下载URL有效期为 **20分钟**。
:::

- 图像URL在生成后14天内保持可访问
- 使用下载URL API解决跨域下载问题
- 下载URL有效期为20分钟
- 建议及时下载并本地存储重要图像

## 下一步

<CardGroup cols={2}>
  <Card
    title="生成图像"
    icon="lucide-image"
    href="/cn/4o-image-api/generate-4-o-image"
  >
    图像生成的完整API参考
  </Card>

  <Card
    title="任务详情"
    icon="lucide-search"
    href="/cn/4o-image-api/get-4-o-image-details"
  >
    查询和监控任务状态
  </Card>

  <Card
    title="下载URL"
    icon="lucide-download"
    href="/cn/4o-image-api/get-4-o-image-download-url"
  >
    获取直接下载URL
  </Card>

  <Card
    title="回调设置"
    icon="lucide-webhook"
    href="/cn/4o-image-api/generate-4-o-image-callbacks"
  >
    设置自动通知回调
  </Card>
</CardGroup>

## 支持

:::note 需要帮助吗
我们的技术支持团队随时为您提供帮助。

- **邮箱**: [support@kie.ai](mailto:support@kie.ai)
- **文档**: [docs.kie.ai](https://docs.kie.ai)
- **API状态**: 查看我们的状态页面了解实时API健康状况
:::

---

准备开始创建令人惊叹的AI图像了吗？[获取您的API密钥](https://kie.ai/api-key)，立即开始创作！
