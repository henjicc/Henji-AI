# Flux Kontext API 快速开始

> 欢迎使用 Flux Kontext API！本指南将帮助您在几分钟内开始使用最先进的AI图像生成和编辑功能。

## 概述

Flux Kontext API 让您能够使用先进的AI模型生成和编辑高质量图像。无论您是在构建应用、自动化工作流程还是创建内容，我们的API都为AI图像生成和编辑提供了简单可靠的访问方式。
<CardGroup cols={2}>
  <Card
    title="文本转图像生成"
    icon="lucide-wand-sparkles"
    href="/cn/flux-kontext-api/generate-or-edit-image"
  >
    从详细的文本描述或图片创建令人惊叹的AI图像
  </Card>

  <Card
    title="任务详情"
    icon="lucide-clock"
    href="/cn/flux-kontext-api/get-image-details"
  >
    实时状态跟踪和webhook回调通知
  </Card>
</CardGroup>

:::note[]
生成的图像存储 **14天** 并在此期间后自动过期。
:::

## 身份验证

所有API请求都需要通过Bearer Token进行身份验证。

1. **获取您的API密钥**
   
   访问 [API密钥管理页面](https://kie.ai/api-key) 获取您的API密钥。

2. **添加到请求头**
   
   在所有请求中包含您的API密钥：
   
   ```bash
   Authorization: Bearer YOUR_API_KEY
   ```

:::caution[]
请妥善保管您的API密钥，切勿公开分享。如果怀疑泄露，请立即在管理页面重置。
:::

## 基本用法

### 1. 从文本生成图像

首先创建您的第一个文本转图像生成任务：


<Tabs>
<TabItem value="javascript" label="Node.js">

```javascript
async function generateImage() {
  try {
    const response = await fetch('https://api.kie.ai/api/v1/flux/kontext/generate', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: '一幅宁静的山景，日落时湖泊倒映着橙色的天空',
        aspectRatio: '16:9',
        model: 'flux-kontext-pro'
      })
    });
    
    const result = await response.json();
    
    if (response.ok && result.code === 200) {
      console.log('任务已提交:', result);
      console.log('任务ID:', result.data.taskId);
      return result.data.taskId;
    } else {
      console.error('请求失败:', result.msg || '未知错误');
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
    url = "https://api.kie.ai/api/v1/flux/kontext/generate"
    headers = {
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json"
    }
    data = {
        "prompt": "一幅宁静的山景，日落时湖泊倒映着橙色的天空",
        "aspectRatio": "16:9",
        "model": "flux-kontext-pro"
    }
    
    try:
        response = requests.post(url, headers=headers, json=data)
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
curl -X POST "https://api.kie.ai/api/v1/flux/kontext/generate" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "一幅宁静的山景，日落时湖泊倒映着橙色的天空",
    "aspectRatio": "16:9",
    "model": "flux-kontext-pro"
  }'
```

</TabItem>
</Tabs>

**响应：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_flux_abc123"
  }
}
```

### 2. 编辑现有图像

使用文本提示修改现有图像：

<Tabs>
<TabItem value="javascript" label="Node.js">

```javascript
async function editImage() {
  try {
    const response = await fetch('https://api.kie.ai/api/v1/flux/kontext/generate', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: '在天空中添加五颜六色的热气球',
        inputImage: 'https://example.com/landscape.jpg',
        aspectRatio: '16:9'
      })
    });
    
    const result = await response.json();
    
    if (response.ok && result.code === 200) {
      console.log('任务已提交:', result);
      console.log('任务ID:', result.data.taskId);
      return result.data.taskId;
    } else {
      console.error('请求失败:', result.msg || '未知错误');
      return null;
    }
  } catch (error) {
    console.error('错误:', error.message);
    return null;
  }
}

editImage();
```

</TabItem>
<TabItem value="python" label="Python">

```python
import requests

def edit_image():
    url = "https://api.kie.ai/api/v1/flux/kontext/generate"
    headers = {
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json"
    }
    data = {
        "prompt": "在天空中添加五颜六色的热气球",
        "inputImage": "https://example.com/landscape.jpg",
        "aspectRatio": "16:9"
    }
    
    try:
        response = requests.post(url, headers=headers, json=data)
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

edit_image()
```

</TabItem>
<TabItem value="curl" label="cURL">

```bash
curl -X POST "https://api.kie.ai/api/v1/flux/kontext/generate" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "在天空中添加五颜六色的热气球",
    "inputImage": "https://example.com/landscape.jpg",
    "aspectRatio": "16:9"
  }'
```

</TabItem>
</Tabs>

### 3. 检查生成状态

使用返回的 `taskId` 监控进度：

<Tabs>
<TabItem value="javascript" label="Node.js">

```javascript
async function checkStatus(taskId) {
  try {
    const response = await fetch(`https://api.kie.ai/api/v1/flux/kontext/record-info?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY'
      }
    });
    
    const result = await response.json();
    
    if (response.ok && result.code === 200) {
      const taskData = result.data;
      
      switch (taskData.successFlag) {
        case 0:
          console.log('任务生成中...');
          console.log('创建时间:', taskData.createTime);
          return taskData;
          
        case 1:
          console.log('任务生成成功！');
          console.log('结果图像:', taskData.response?.resultImageUrl);
          console.log('原始图像URL（10分钟有效）:', taskData.response?.originImageUrl);
          console.log('完成时间:', taskData.completeTime);
          return taskData;
          
        case 2:
          console.log('创建任务失败');
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          if (taskData.errorCode) {
            console.error('错误代码:', taskData.errorCode);
          }
          return taskData;
          
        case 3:
          console.log('生成失败 - 任务创建成功但生成失败');
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          if (taskData.errorCode) {
            console.error('错误代码:', taskData.errorCode);
          }
          return taskData;
          
        default:
          console.log('未知状态:', taskData.successFlag);
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

// 使用方法
const status = await checkStatus('task_flux_abc123');
```

</TabItem>
<TabItem value="python" label="Python">

```python
import requests

def check_status(task_id):
    url = f"https://api.kie.ai/api/v1/flux/kontext/record-info?taskId={task_id}"
    headers = {"Authorization": "Bearer YOUR_API_KEY"}
    
    try:
        response = requests.get(url, headers=headers)
        result = response.json()
        
        if response.ok and result.get('code') == 200:
            task_data = result['data']
            success_flag = task_data['successFlag']
            
            if success_flag == 0:
                print("任务生成中...")
                print(f"创建时间: {task_data['createTime']}")
                return task_data
            elif success_flag == 1:
                print("任务生成成功！")
                print(f"结果图像: {task_data.get('response', {}).get('resultImageUrl', '')}")
                print(f"原始图像URL（10分钟有效）: {task_data.get('response', {}).get('originImageUrl', '')}")
                print(f"完成时间: {task_data['completeTime']}")
                return task_data
            elif success_flag == 2:
                print("创建任务失败")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                if task_data.get('errorCode'):
                    print(f"错误代码: {task_data['errorCode']}")
                return task_data
            elif success_flag == 3:
                print("生成失败 - 任务创建成功但生成失败")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                if task_data.get('errorCode'):
                    print(f"错误代码: {task_data['errorCode']}")
                return task_data
            else:
                print(f"未知状态: {success_flag}")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                return task_data
        else:
            print(f"查询失败: {result.get('msg', '未知错误')}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"查询状态失败: {e}")
        return None

# 使用方法
status = check_status('task_flux_abc123')
```

</TabItem>
<TabItem value="curl" label="cURL">

```bash
curl -X GET "https://api.kie.ai/api/v1/flux/kontext/record-info?taskId=task_flux_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

</TabItem>
</Tabs>

**状态值：**

- `0`: 生成中 - 任务正在处理
- `1`: 成功 - 任务成功完成
- `2`: 创建任务失败 - 创建任务失败
- `3`: 生成失败 - 任务创建成功但生成失败

## 完整工作流程示例

以下是一个生成图像并等待完成的完整示例：

<Tabs>
<TabItem value="javascript" label="JavaScript">

```javascript
class FluxKontextAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.kie.ai/api/v1/flux/kontext';
  }
  
  async generateImage(prompt, options = {}) {
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        aspectRatio: options.aspectRatio || '16:9',
        model: options.model || 'flux-kontext-pro',
        enableTranslation: options.enableTranslation !== false,
        outputFormat: options.outputFormat || 'jpeg',
        ...options
      })
    });
    
    const result = await response.json();
    if (!response.ok || result.code !== 200) {
      throw new Error(`生成失败: ${result.msg || '未知错误'}`);
    }
    
    return result.data.taskId;
  }
  
  async editImage(prompt, inputImage, options = {}) {
    return this.generateImage(prompt, {
      ...options,
      inputImage
    });
  }
  
  async waitForCompletion(taskId, maxWaitTime = 300000) { // 最长等待5分钟
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getTaskStatus(taskId);
      
      switch (status.successFlag) {
        case 0:
          console.log('任务生成中，继续等待...');
          break;
          
        case 1:
          console.log('生成成功完成！');
          return status.response;
          
        case 2:
          const createError = status.errorMessage || '创建任务失败';
          console.error('创建任务失败:', createError);
          if (status.errorCode) {
            console.error('错误代码:', status.errorCode);
          }
          throw new Error(createError);
          
        case 3:
          const generateError = status.errorMessage || '生成失败';
          console.error('生成失败:', generateError);
          if (status.errorCode) {
            console.error('错误代码:', status.errorCode);
          }
          throw new Error(generateError);
          
        default:
          console.log(`未知状态: ${status.successFlag}`);
          if (status.errorMessage) {
            console.error('错误信息:', status.errorMessage);
          }
          break;
      }
      
      // 等待3秒后再次检查
      await new Promise(resolve => setTimeout(resolve, 3000));
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
}

// 使用示例
async function main() {
  const api = new FluxKontextAPI('YOUR_API_KEY');
  
  try {
    // 文本转图像生成
    console.log('开始图像生成...');
    const taskId = await api.generateImage(
      '夜晚的未来主义城市景观，有霓虹灯和飞行汽车',
      { 
        aspectRatio: '16:9',
        model: 'flux-kontext-max',
        promptUpsampling: true
      }
    );
    
    // 等待完成
    console.log(`任务ID: ${taskId}。等待完成...`);
    const result = await api.waitForCompletion(taskId);
    
    console.log('图像生成成功！');
    console.log('结果图像URL:', result.resultImageUrl);
    console.log('原始图像URL（10分钟有效）:', result.originImageUrl);
    
    // 图像编辑示例
    console.log('\n开始图像编辑...');
    const editTaskId = await api.editImage(
      '在天空中添加彩虹',
      result.resultImageUrl,
      { aspectRatio: '16:9' }
    );
    
    const editResult = await api.waitForCompletion(editTaskId);
    console.log('图像编辑成功！');
    console.log('编辑后图像URL:', editResult.resultImageUrl);
    
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

class FluxKontextAPI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = 'https://api.kie.ai/api/v1/flux/kontext'
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    
    def generate_image(self, prompt, **options):
        data = {
            'prompt': prompt,
            'aspectRatio': options.get('aspectRatio', '16:9'),
            'model': options.get('model', 'flux-kontext-pro'),
            'enableTranslation': options.get('enableTranslation', True),
            'outputFormat': options.get('outputFormat', 'jpeg'),
            **options
        }
        
        response = requests.post(f'{self.base_url}/generate', 
                               headers=self.headers, json=data)
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"生成失败: {result.get('msg', '未知错误')}")
        
        return result['data']['taskId']
    
    def edit_image(self, prompt, input_image, **options):
        return self.generate_image(prompt, inputImage=input_image, **options)
    
    def wait_for_completion(self, task_id, max_wait_time=300):
        start_time = time.time()
        
        while time.time() - start_time < max_wait_time:
            status = self.get_task_status(task_id)
            success_flag = status['successFlag']
            
            if success_flag == 0:
                print("任务生成中，继续等待...")
            elif success_flag == 1:
                print("生成成功完成！")
                return status['response']
            elif success_flag == 2:
                create_error = status.get('errorMessage', '创建任务失败')
                print(f"创建任务失败: {create_error}")
                if status.get('errorCode'):
                    print(f"错误代码: {status['errorCode']}")
                raise Exception(create_error)
            elif success_flag == 3:
                generate_error = status.get('errorMessage', '生成失败')
                print(f"生成失败: {generate_error}")
                if status.get('errorCode'):
                    print(f"错误代码: {status['errorCode']}")
                raise Exception(generate_error)
            else:
                print(f"未知状态: {success_flag}")
                if status.get('errorMessage'):
                    print(f"错误信息: {status['errorMessage']}")
            
            time.sleep(3)  # 等待3秒
        
        raise Exception('生成超时')
    
    def get_task_status(self, task_id):
        response = requests.get(f'{self.base_url}/record-info?taskId={task_id}',
                              headers={'Authorization': f'Bearer {self.api_key}'})
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"查询状态失败: {result.get('msg', '未知错误')}")
        
        return result['data']

# 使用示例
def main():
    api = FluxKontextAPI('YOUR_API_KEY')
    
    try:
        # 文本转图像生成
        print('开始图像生成...')
        task_id = api.generate_image(
            '夜晚的未来主义城市景观，有霓虹灯和飞行汽车',
            aspectRatio='16:9',
            model='flux-kontext-max',
            promptUpsampling=True
        )
        
        # 等待完成
        print(f'任务ID: {task_id}。等待完成...')
        result = api.wait_for_completion(task_id)
        
        print('图像生成成功！')
        print(f'结果图像URL: {result["resultImageUrl"]}')
        print(f'原始图像URL（10分钟有效）: {result["originImageUrl"]}')
        
        # 图像编辑示例
        print('\n开始图像编辑...')
        edit_task_id = api.edit_image(
            '在天空中添加彩虹',
            result['resultImageUrl'],
            aspectRatio='16:9'
        )
        
        edit_result = api.wait_for_completion(edit_task_id)
        print('图像编辑成功！')
        print(f'编辑后图像URL: {edit_result["resultImageUrl"]}')
        
        # 下载图像
        download_image(result['resultImageUrl'], 'generated_image.jpg')
        download_image(edit_result['resultImageUrl'], 'edited_image.jpg')
        
    except Exception as error:
        print(f'错误: {error}')

def download_image(url, filename):
    response = requests.get(url)
    response.raise_for_status()
    
    with open(filename, 'wb') as f:
        f.write(response.content)
    print(f'已下载: {filename}')

if __name__ == '__main__':
    main()
```

</TabItem>
</Tabs>

## 高级功能

### 模型选择

根据您的需求选择合适的模型：

```javascript
// 标准模型，平衡性能
const taskId = await api.generateImage('美丽的风景', {
  model: 'flux-kontext-pro'
});

// 增强模型，适用于复杂场景和更高质量
const taskId = await api.generateImage('复杂的建筑内部，有精细的细节', {
  model: 'flux-kontext-max'
});
```

### 宽高比选项

支持各种图像格式：

```javascript
const aspectRatios = {
  'ultra-wide': '21:9',    // 电影显示器
  'widescreen': '16:9',    // 高清视频，桌面壁纸
  'standard': '4:3',       // 传统显示器
  'square': '1:1',         // 社交媒体帖子
  'portrait': '3:4',       // 杂志布局
  'mobile': '9:16',        // 智能手机壁纸
  'ultra-tall': '16:21'    // 移动应用启动画面
};

const taskId = await api.generateImage('现代办公空间', {
  aspectRatio: aspectRatios.widescreen
});
```

### 提示词增强

让AI优化您的提示词：

```javascript
const taskId = await api.generateImage('日落', {
  promptUpsampling: true // AI会增强提示词以获得更好的结果
});
```

### 安全容忍度控制

调整内容审核级别：

```javascript
// 用于图像生成（0-6）
const taskId = await api.generateImage('艺术概念', {
  safetyTolerance: 4 // 对艺术内容更宽松
});

// 用于图像编辑（0-2）
const editTaskId = await api.editImage('风格化改变', inputImage, {
  safetyTolerance: 2 // 平衡审核
});
```

### 使用回调

设置webhook回调以获得自动通知：

```javascript
const taskId = await api.generateImage('数字艺术杰作', {
  aspectRatio: '1:1',
  callBackUrl: 'https://your-server.com/flux-callback'
});

// 您的回调端点将接收：
app.post('/flux-callback', (req, res) => {
  const { code, data } = req.body;
  
  if (code === 200) {
    console.log('图像准备就绪:', data.info.resultImageUrl);
  } else {
    console.log('生成失败:', req.body.msg);
  }
  
  res.status(200).json({ status: 'received' });
});
```

<Card
  title="了解更多关于回调"
  icon="webhook"
  href="/cn/flux-kontext-api/generate-or-edit-image-callbacks"
>
  设置webhook回调以在图像准备就绪时接收自动通知。
</Card>

## 错误处理

常见错误场景及处理方法：
<AccordionGroup>
<Accordion title="内容政策违反（代码 400）">

```javascript
try {
  const taskId = await api.generateImage('不当内容');
} catch (error) {
  if (error.data.code === 400) {
    console.log('请修改您的提示词以符合内容政策');
  }
}
```

</Accordion>
<Accordion title="安全容忍度超出范围（代码 500）">

```javascript
try {
  const taskId = await api.generateImage('艺术品', {
    safetyTolerance: 7 // 对生成模式无效（最大6）
  });
} catch (error) {
  console.log('安全容忍度对于生成应为0-6，对于编辑应为0-2');
}
```

</Accordion>
<Accordion title="速率限制（代码 429）">

```javascript
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(prompt, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await api.generateImage(prompt, options);
    } catch (error) {
      if (error.data.code === 429 && i < maxRetries - 1) {
        await delay(Math.pow(2, i) * 1000); // 指数退避
        continue;
      }
      throw error;
    }
  }
}
```

</Accordion>
</AccordionGroup>

## 最佳实践

:::tip 性能优化

1. **使用回调**：设置webhook回调而不是轮询以获得更好的性能
2. **模型选择**：对标准任务使用 `flux-kontext-pro`，对复杂场景使用 `flux-kontext-max`
3. **提示词工程**：使用详细、具体的提示词以获得更好的结果
4. **图像预处理**：确保输入图像可访问且经过优化
5. **下载管理**：及时下载图像，因为它们14天后会过期
6. **翻译设置**：如果您的提示词已经是英文，请设置 `enableTranslation: false`

:::

:::caution 重要限制

- **语言支持**：提示词仅支持英文（使用 `enableTranslation: true` 进行自动翻译）
- **图像存储**：生成的图像14天后过期
- **原始图像URL**：生成后仅10分钟有效
- **安全容忍度**：生成模式（0-6），编辑模式（0-2）
- **输入图像**：必须是公开可访问的URL

:::

## 支持的参数

### 核心参数

| 参数 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| `prompt` | string | **必需**。生成/编辑的文本描述 | - |
| `aspectRatio` | string | 输出图像宽高比 | `16:9` |
| `model` | string | `flux-kontext-pro` 或 `flux-kontext-max` | `flux-kontext-pro` |
| `outputFormat` | string | `jpeg` 或 `png` | `jpeg` |

### 可选参数

| 参数 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| `inputImage` | string | 图像编辑模式的URL | - |
| `enableTranslation` | boolean | 自动翻译非英文提示词 | `true` |
| `promptUpsampling` | boolean | AI提示词增强 | `false` |
| `safetyTolerance` | integer | 内容审核级别 | `2` |
| `callBackUrl` | string | Webhook通知URL | - |
| `uploadCn` | boolean | 使用中国服务器上传 | `false` |
| `watermark` | string | 水印标识符 | - |

## 下一步

<CardGroup cols={2}>
  <Card
    title="生成或编辑图像"
    icon="lucide-image"
    href="/cn/flux-kontext-api/generate-or-edit-image"
  >
    了解所有生成和编辑参数及高级选项
  </Card>

  <Card
    title="跟踪进度"
    icon="lucide-line-chart"
    href="/cn/flux-kontext-api/get-image-details"
  >
    监控任务状态并检索详细的生成信息
  </Card>

  <Card
    title="Webhook回调"
    icon="lucide-webhook"
    href="/cn/flux-kontext-api/generate-or-edit-image-callbacks"
  >
    设置任务完成的自动通知
  </Card>
</CardGroup>

## 支持

需要帮助吗？我们的技术支持团队随时为您提供帮助。

- **邮箱**: [support@kie.ai](mailto:support@kie.ai)
- **文档**: [docs.kie.ai](https://docs.kie.ai)
- **API状态**: 查看我们的状态页面了解实时API健康状况

准备创建令人惊叹的AI图像了吗？从上面的示例开始，探索完整的API功能！
