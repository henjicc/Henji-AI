# Suno API 快速开始

> 几分钟内开始使用 Suno API 生成AI音乐、歌词和音频内容

## 欢迎使用 Suno API

Suno API 让您能够使用最先进的AI模型创建高质量的AI生成音乐、歌词和音频内容。无论您是在构建音乐应用、自动化创意工作流程，还是开发音频内容，我们的API都为音乐生成和音频处理提供了全面的工具。


<CardGroup cols={3}>
  <Card title="生成音乐" icon="lucide-wand-sparkles" href="/cn/suno-api/generate-music">
    创建带或不带歌词的原创音乐曲目
  </Card>

  <Card title="延长音乐" icon="lucide-plus" href="/cn/suno-api/extend-music">
    无缝延长现有音乐曲目
  </Card>

  <Card title="生成歌词" icon="lucide-list-checks" href="/cn/suno-api/generate-lyrics">
    从文本提示创建创意歌词
  </Card>

  <Card title="音乐视频" icon="lucide-video" href="/cn/suno-api/create-music-video">
    将音频轨道转换为可视化音乐视频
  </Card>

  <Card title="上传翻唱" icon="lucide-upload" href="/cn/suno-api/upload-and-cover-audio">
    将上传的音频转换为新风格
  </Card>

  <Card title="上传扩展" icon="lucide-square-arrow-out-up-right" href="/cn/suno-api/upload-and-extend-audio">
    上传音频文件并无缝扩展
  </Card>

  <Card title="添加伴奏" icon="lucide-music" href="/cn/suno-api/add-instrumental">
    为上传的音频生成伴奏音乐
  </Card>

  <Card title="添加人声" icon="lucide-mic" href="/cn/suno-api/add-vocals">
    为上传的音频文件添加人声演唱
  </Card>

  <Card title="人声分离" icon="lucide-activity" href="/cn/suno-api/separate-vocals">
    从音乐中分离人声和伴奏
  </Card>

  <Card title="WAV转换" icon="lucide-file-audio" href="/cn/suno-api/convert-to-wav">
    将音频转换为高质量WAV格式
  </Card>

  <Card title="获取歌词" icon="lucide-align-left" href="/cn/suno-api/get-timestamped-lyrics">
    获取带时间戳的同步歌词
  </Card>
</CardGroup>

## 身份验证

所有 API 请求都需要使用 Bearer 令牌进行身份验证。请从 [API 密钥管理页面](https://kie.ai/api-key) 获取您的 API 密钥。

:::warning[]
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

### 第一步：生成您的第一个音乐曲目

从一个简单的音乐生成请求开始：


<Tabs>
  <TabItem value="curl" label="cURL">

```bash
curl -X POST "https://api.kie.ai/api/v1/generate" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "一首平静舒缓的钢琴曲，带有柔和的旋律",
    "customMode": false,
    "instrumental": true,
    "model": "V3_5",
    "callBackUrl": "https://your-app.com/callback"
  }'
```

  </TabItem>
  
  <TabItem value="javascript" label="JavaScript">

```javascript
async function generateMusic() {
  try {
    const response = await fetch('https://api.kie.ai/api/v1/generate', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: '一首平静舒缓的钢琴曲，带有柔和的旋律',
        customMode: false,
        instrumental: true,
        model: 'V3_5',
        callBackUrl: 'https://your-app.com/callback'
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

generateMusic();
```

  </TabItem>
  
  <TabItem value="python" label="Python">

```python
import requests

def generate_music():
    url = "https://api.kie.ai/api/v1/generate"
    headers = {
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json"
    }
    
    payload = {
        "prompt": "一首平静舒缓的钢琴曲，带有柔和的旋律",
        "customMode": False,
        "instrumental": True,
        "model": "V3_5",
        "callBackUrl": "https://your-app.com/callback"
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

generate_music();
```

  </TabItem>
</Tabs>

### 第二步：检查任务状态

使用返回的任务ID检查生成状态：

<Tabs>
  <TabItem value="javascript" label="JavaScript">

```javascript
async function checkTaskStatus(taskId) {
  try {
    const response = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${taskId}`, {
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
          console.log('所有音轨生成成功！');
          console.log('音频轨道:', taskData.response.sunoData);
          return taskData.response;
          
        case 'FIRST_SUCCESS':
          console.log('第一个音轨生成完成');
          if (taskData.response.sunoData && taskData.response.sunoData.length > 0) {
            console.log('音频轨道:', taskData.response.sunoData);
          }
          return taskData.response;
          
        case 'TEXT_SUCCESS':
          console.log('歌词/文本生成成功');
          return taskData.response;
          
        case 'PENDING':
          console.log('任务等待处理中...');
          return taskData.response;
          
        case 'CREATE_TASK_FAILED':
          console.log('创建任务失败');
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          return taskData.response;
          
        case 'GENERATE_AUDIO_FAILED':
          console.log('音频生成失败');
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          return taskData.response;
          
        case 'CALLBACK_EXCEPTION':
          console.log('回调过程中出错');
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          return taskData.response;
          
        case 'SENSITIVE_WORD_ERROR':
          console.log('内容因敏感词被过滤');
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          return taskData.response;
          
        default:
          console.log('未知状态:', taskData.status);
          if (taskData.errorMessage) {
            console.error('错误信息:', taskData.errorMessage);
          }
          return taskData.response;
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
    url = f"https://api.kie.ai/api/v1/generate/record-info?taskId={task_id}"
    headers = {"Authorization": f"Bearer {api_key}"}
    
    try:
        response = requests.get(url, headers=headers)
        result = response.json()
        
        if response.ok and result.get('code') == 200:
            task_data = result['data']
            status = task_data['status']
            
            response_data = task_data['response']
            
            if status == 'SUCCESS':
                print("所有音轨生成成功！")
                for i, track in enumerate(response_data['sunoData']):
                    print(f"音轨 {i+1}: {track.get('audioUrl', '未完成')}")
                return task_data
            elif status == 'FIRST_SUCCESS':
                print("第一个音轨生成完成")
                if response_data.get('sunoData'):
                    for i, track in enumerate(response_data['sunoData']):
                        if track.get('audioUrl'):  # 只显示已完成的音轨
                            print(f"音轨 {i+1}: {track['audioUrl']}")
                return task_data
            elif status == 'TEXT_SUCCESS':
                print("歌词/文本生成成功")
                return task_data
            elif status == 'PENDING':
                print("任务等待处理中...")
                return task_data
            elif status == 'CREATE_TASK_FAILED':
                print("创建任务失败")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                return task_data
            elif status == 'GENERATE_AUDIO_FAILED':
                print("音频生成失败")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                return task_data
            elif status == 'CALLBACK_EXCEPTION':
                print("回调过程中出错")
                if task_data.get('errorMessage'):
                    print(f"错误信息: {task_data['errorMessage']}")
                return task_data
            elif status == 'SENSITIVE_WORD_ERROR':
                print("内容因敏感词被过滤")
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
            # 检查是否为最终状态（成功或失败）
            if result.get('status') in ['SUCCESS', 'FIRST_SUCCESS', 'TEXT_SUCCESS', 'CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'CALLBACK_EXCEPTION', 'SENSITIVE_WORD_ERROR']:
                return result
            # 如果是PENDING状态，继续等待
        time.sleep(30)  # 等待30秒后再次检查
```

  </TabItem>
  
  <TabItem value="curl" label="cURL">

```bash
curl -X GET "https://api.kie.ai/api/v1/generate/record-info?taskId=YOUR_TASK_ID" \
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
    "taskId": "5c79****be8e"
  }
}
```

**任务状态响应（成功）：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "5c79****be8e",
    "parentMusicId": "",
    "param": "{\"prompt\":\"一首平静舒缓的钢琴曲\",\"style\":\"平静, 舒缓, 钢琴\"}",
    "response": {
      "taskId": "5c79****be8e",
      "sunoData": [
        {
          "id": "e231****-****-****-****-****8cadc7dc",
          "audioUrl": "https://example.cn/****.mp3",
          "streamAudioUrl": "https://example.cn/****",
          "imageUrl": "https://example.cn/****.jpeg",
          "prompt": "[Verse] 夜晚城市 灯火辉煌",
          "modelName": "chirp-v3-5",
          "title": "钢铁侠",
          "tags": "electrifying, rock",
          "createTime": "2025-01-01 00:00:00",
          "duration": 198.44
        }
      ]
    },
    "status": "SUCCESS",
    "type": "GENERATE",
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
    "taskId": "5c79****be8e",
    "parentMusicId": "",
    "param": "{\"prompt\":\"一首平静舒缓的钢琴曲\",\"style\":\"平静, 舒缓, 钢琴\"}",
    "response": {
      "taskId": "5c79****be8e",
      "sunoData": [],
      "errorMessage": "生成失败，请重试或联系客服"
    },
    "status": "GENERATE_AUDIO_FAILED",
    "type": "GENERATE",
    "errorCode": 501,
    "errorMessage": "生成失败，请重试或联系客服"
  }
}
```

## 核心功能

* **文本转音乐**：输入文字描述，生成相应的音乐作品
* **延长音乐**：基于现有音频，无缝创建更长版本
* **生成歌词**：从创意提示生成结构化歌词内容
* **上传翻唱**：上传音频文件，转换为不同的音乐风格
* **添加伴奏**：为上传的音频文件生成伴奏音乐
* **添加人声**：为上传的音频文件添加自定义风格的人声演唱
* **人声分离**：将音乐分离为人声、伴奏等独立轨道
* **格式转换**：支持WAV等多种高质量音频格式输出

## AI 模型

为您的需求选择合适的模型：

<CardGroup cols={3}>
  <Card title="V3_5" icon="lucide-list-checks">
    **更好的歌曲结构**

    最长4分钟，改进的歌曲组织
  </Card>

  <Card title="V4" icon="lucide-wand-sparkles">
    **改进的人声**

    最长4分钟，增强的人声质量
  </Card>

  <Card title="V4_5" icon="lucide-rocket">
    **智能提示词**

    最长8分钟，更快的生成速度
  </Card>

  <Card title="V4_5PLUS" icon="lucide-image">
    **更丰富的音色**

    最长8分钟，新的创作方式
  </Card>

  <Card title="V4_5ALL" icon="lucide-bolt">
    **智能且快速**

    最长8分钟，更智能的提示词，更快的生成速度
  </Card>

  <Card title="V5" icon="lucide-sparkles">
    **生成更快**

    最长8分钟，更卓越的音乐表现力，速度更快
  </Card>
    
  <Card title="V5_5" icon="lucide-star">
    **释放你的声音**

    量身定制的专属模型，贴合您的独特品味。
  </Card>
</CardGroup>

## 生成模式

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `customMode` | boolean | 是 | 控制参数复杂度：<br/>• `false`: 简单模式，仅需要提示词<br/>• `true`: 高级模式，需要风格和标题 |
| `instrumental` | boolean | 是 | 决定音乐是否包含人声：<br/>• `true`: 仅纯音乐（无歌词）<br/>• `false`: 包含人声/歌词 |

## 关键参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 对所需音乐的文本描述。请具体说明流派、情绪和乐器。<br/>**字符限制：**<br/>• 非自定义模式：500字符<br/>• 自定义模式（V3\_5 & V4）：3000字符<br/>• 自定义模式（V4\_5、V4\_5PLUS & V5）：5000字符 |
| `style` | string | 否 | 音乐风格规范（仅自定义模式）。<br/>**示例：** 爵士、古典、电子、流行、摇滚、嘻哈<br/>**字符限制：**<br/>• V3\_5 & V4：200字符<br/>• V4\_5、V4\_5PLUS & V5：1000字符 |
| `title` | string | 否 | 生成音乐曲目的标题（仅自定义模式）。<br/>**最大长度：** 80字符 |

## 完整工作流程示例

以下是一个生成带歌词音乐并等待完成的完整示例：

<Tabs>
  <TabItem value="javascript" label="JavaScript">

```javascript
class SunoAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.kie.ai/api/v1';
  }
  
  async generateMusic(prompt, options = {}) {
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        customMode: options.customMode || false,
        instrumental: options.instrumental || false,
        model: options.model || 'V3_5',
        style: options.style,
        title: options.title,
        negativeTags: options.negativeTags,
        callBackUrl: options.callBackUrl || 'https://your-app.com/callback'
      })
    });
    
    const result = await response.json();
    if (!response.ok || result.code !== 200) {
      throw new Error(`生成失败: ${result.msg || '未知错误'}`);
    }
    
    return result.data.taskId;
  }
  
  async extendMusic(audioId, options = {}) {
    const response = await fetch(`${this.baseUrl}/generate/extend`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audioId,
        defaultParamFlag: options.defaultParamFlag || false,
        model: options.model || 'V3_5',
        prompt: options.prompt,
        style: options.style,
        title: options.title,
        continueAt: options.continueAt,
        callBackUrl: options.callBackUrl || 'https://your-app.com/callback'
      })
    });
    
    const result = await response.json();
    if (!response.ok || result.code !== 200) {
      throw new Error(`延长失败: ${result.msg || '未知错误'}`);
    }
    
    return result.data.taskId;
  }
  
  async generateLyrics(prompt, callBackUrl) {
    const response = await fetch(`${this.baseUrl}/lyrics`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        callBackUrl
      })
    });
    
    const result = await response.json();
    if (!response.ok || result.code !== 200) {
      throw new Error(`歌词生成失败: ${result.msg || '未知错误'}`);
    }
    
    return result.data.taskId;
  }
  
  async waitForCompletion(taskId, maxWaitTime = 600000) { // 最长等待10分钟
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getTaskStatus(taskId);
      
      switch (status.status) {
        case 'SUCCESS':
          console.log('所有音轨生成成功！');
          return status.response;
          
        case 'FIRST_SUCCESS':
          console.log('第一个音轨生成完成！');
          return status.response;
          
        case 'TEXT_SUCCESS':
          console.log('歌词/文本生成成功！');
          return status.response;
          
        case 'PENDING':
          console.log('任务等待处理中...');
          break;
          
        case 'CREATE_TASK_FAILED':
          const createError = status.errorMessage || '创建任务失败';
          console.error('错误信息:', createError);
          throw new Error(createError);
          
        case 'GENERATE_AUDIO_FAILED':
          const audioError = status.errorMessage || '音频生成失败';
          console.error('错误信息:', audioError);
          throw new Error(audioError);
          
        case 'CALLBACK_EXCEPTION':
          const callbackError = status.errorMessage || '回调过程中出错';
          console.error('错误信息:', callbackError);
          throw new Error(callbackError);
          
        case 'SENSITIVE_WORD_ERROR':
          const sensitiveError = status.errorMessage || '内容因敏感词被过滤';
          console.error('错误信息:', sensitiveError);
          throw new Error(sensitiveError);
          
        default:
          console.log(`未知状态: ${status.status}`);
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
    const response = await fetch(`${this.baseUrl}/generate/record-info?taskId=${taskId}`, {
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
  const api = new SunoAPI('YOUR_API_KEY');
  
  try {
    // 生成带歌词的音乐
    console.log('开始生成音乐...');
    const taskId = await api.generateMusic(
      '一首关于童年回忆的怀旧民谣',
      { 
        customMode: true,
        instrumental: false,
        model: 'V4_5',
        style: '民谣, 原声吉他, 怀旧',
        title: '童年梦想'
      }
    );
    
    // 等待完成
    console.log(`任务ID: ${taskId}。等待完成...`);
    const result = await api.waitForCompletion(taskId);
    
    console.log('音乐生成成功！');
    console.log('生成的曲目：');
    result.sunoData.forEach((track, index) => {
      console.log(`曲目 ${index + 1}:`);
      console.log(`  标题: ${track.title}`);
      console.log(`  音频URL: ${track.audioUrl}`);
      console.log(`  时长: ${track.duration}秒`);
      console.log(`  标签: ${track.tags}`);
    });
    
    // 延长第一个曲目
    const firstTrack = result.sunoData[0];
    console.log('\n延长第一个曲目...');
    const extendTaskId = await api.extendMusic(firstTrack.id, {
      defaultParamFlag: true,
      prompt: '继续一个充满希望的副歌',
      style: '民谣, 振奋',
      title: '童年梦想延长版',
      continueAt: 60,
      model: 'V4_5'
    });
    
    const extendResult = await api.waitForCompletion(extendTaskId);
    console.log('音乐延长成功！');
    console.log('延长曲目URL:', extendResult.sunoData[0].audioUrl);
    
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

class SunoAPI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = 'https://api.kie.ai/api/v1'
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    
    def generate_music(self, prompt, **options):
        data = {
            'prompt': prompt,
            'customMode': options.get('customMode', False),
            'instrumental': options.get('instrumental', False),
            'model': options.get('model', 'V3_5'),
            'callBackUrl': options.get('callBackUrl', 'https://your-app.com/callback')
        }
        
        if options.get('style'):
            data['style'] = options['style']
        if options.get('title'):
            data['title'] = options['title']
        if options.get('negativeTags'):
            data['negativeTags'] = options['negativeTags']
        
        response = requests.post(f'{self.base_url}/generate', 
                               headers=self.headers, json=data)
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"生成失败: {result.get('msg', '未知错误')}")
        
        return result['data']['taskId']
    
    def extend_music(self, audio_id, **options):
        data = {
            'audioId': audio_id,
            'defaultParamFlag': options.get('defaultParamFlag', False),
            'model': options.get('model', 'V3_5'),
            'callBackUrl': options.get('callBackUrl', 'https://your-app.com/callback')
        }
        
        if options.get('prompt'):
            data['prompt'] = options['prompt']
        if options.get('style'):
            data['style'] = options['style']
        if options.get('title'):
            data['title'] = options['title']
        if options.get('continueAt'):
            data['continueAt'] = options['continueAt']
        
        response = requests.post(f'{self.base_url}/generate/extend', 
                               headers=self.headers, json=data)
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"延长失败: {result.get('msg', '未知错误')}")
        
        return result['data']['taskId']
    
    def generate_lyrics(self, prompt, callback_url):
        data = {
            'prompt': prompt,
            'callBackUrl': callback_url
        }
        
        response = requests.post(f'{self.base_url}/lyrics', 
                               headers=self.headers, json=data)
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"歌词生成失败: {result.get('msg', '未知错误')}")
        
        return result['data']['taskId']
    
    def wait_for_completion(self, task_id, max_wait_time=600):
        start_time = time.time()
        
        while time.time() - start_time < max_wait_time:
            status = self.get_task_status(task_id)
            
            if status['status'] == 'SUCCESS':
                print("所有音轨生成成功！")
                return status['response']
            elif status['status'] == 'FIRST_SUCCESS':
                print("第一个音轨生成完成！")
                return status['response']
            elif status['status'] == 'TEXT_SUCCESS':
                print("歌词/文本生成成功！")
                return status['response']
            elif status['status'] == 'PENDING':
                print("任务等待处理中...")
            elif status['status'] == 'CREATE_TASK_FAILED':
                error_msg = status.get('errorMessage', '创建任务失败')
                print(f"错误信息: {error_msg}")
                raise Exception(error_msg)
            elif status['status'] == 'GENERATE_AUDIO_FAILED':
                error_msg = status.get('errorMessage', '音频生成失败')
                print(f"错误信息: {error_msg}")
                raise Exception(error_msg)
            elif status['status'] == 'CALLBACK_EXCEPTION':
                error_msg = status.get('errorMessage', '回调过程中出错')
                print(f"错误信息: {error_msg}")
                raise Exception(error_msg)
            elif status['status'] == 'SENSITIVE_WORD_ERROR':
                error_msg = status.get('errorMessage', '内容因敏感词被过滤')
                print(f"错误信息: {error_msg}")
                raise Exception(error_msg)
            else:
                print(f"未知状态: {status['status']}")
                if status.get('errorMessage'):
                    print(f"错误信息: {status['errorMessage']}")
            
            time.sleep(10)  # 等待10秒
        
        raise Exception('生成超时')
    
    def get_task_status(self, task_id):
        response = requests.get(f'{self.base_url}/generate/record-info?taskId={task_id}',
                              headers={'Authorization': f'Bearer {self.api_key}'})
        result = response.json()
        
        if not response.ok or result.get('code') != 200:
            raise Exception(f"查询状态失败: {result.get('msg', '未知错误')}")
        
        return result['data']

# 使用示例
def main():
    api = SunoAPI('YOUR_API_KEY')
    
    try:
        # 生成带歌词的音乐
        print('开始生成音乐...')
        task_id = api.generate_music(
            '一首关于童年回忆的怀旧民谣',
            customMode=True,
            instrumental=False,
            model='V4_5',
            style='民谣, 原声吉他, 怀旧',
            title='童年梦想'
        )
        
        # 等待完成
        print(f'任务ID: {task_id}。等待完成...')
        result = api.wait_for_completion(task_id)
        
        print('音乐生成成功！')
        print('生成的曲目：')
        for i, track in enumerate(result['response']['sunoData']):
            print(f"曲目 {i + 1}:")
            print(f"  标题: {track['title']}")
            print(f"  音频URL: {track['audioUrl']}")
            print(f"  时长: {track['duration']}秒")
            print(f"  标签: {track['tags']}")
        
        # 延长第一个曲目
        first_track = result['response']['sunoData'][0]
        print('\n延长第一个曲目...')
        extend_task_id = api.extend_music(
            first_track['id'],
            defaultParamFlag=True,
            prompt='继续一个充满希望的副歌',
            style='民谣, 振奋',
            title='童年梦想延长版',
            continueAt=60,
            model='V4_5'
        )
        
        extend_result = api.wait_for_completion(extend_task_id)
        print('音乐延长成功！')
        print(f"延长曲目URL: {extend_result['response']['sunoData'][0]['audioUrl']}")
        
    except Exception as error:
        print(f'错误: {error}')

if __name__ == '__main__':
    main()
```

  </TabItem>
</Tabs>

## 状态码和任务状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `PENDING` | 处理中 | 任务正在等待处理或正在生成中 |
| `TEXT_SUCCESS` | 部分完成 | 歌词/文本生成成功完成 |
| `FIRST_SUCCESS` | 部分完成 | 第一个曲目生成完成 |
| `SUCCESS` | 完成 | 所有曲目生成成功 |
| `CREATE_TASK_FAILED` | 错误 | 创建任务失败 |
| `GENERATE_AUDIO_FAILED` | 错误 | 生成音频失败 |
| `CALLBACK_EXCEPTION` | 错误 | 回调过程中出错 |
| `SENSITIVE_WORD_ERROR` | 错误 | 内容因敏感词被过滤 |

## 最佳实践


<AccordionGroup>
  <Accordion title="提示词工程">
    * 具体说明流派、情绪和乐器
    * 使用描述性形容词获得更好的风格控制
    * 包含节拍和能量水平描述
    * 参考音乐时代或特定艺术家进行风格指导
  </Accordion>

  <Accordion title="模型选择">
    * V3\_5：最适合有清晰段落/副歌模式的结构化歌曲
    * V4：当人声质量最重要时选择
    * V4\_5：用于更快的生成和智能提示处理
    * V4\_5PLUS：选择最高质量和最长的曲目
    * V5：生成速度更快，更卓越的音乐表现力
  </Accordion>

  <Accordion title="性能优化">
    * 使用回调而不是频繁轮询
    * 从非自定义模式开始满足简单需求
    * 实施适当的错误处理以应对生成失败
    * 缓存生成内容，因为文件14天后到期
  </Accordion>

  <Accordion title="内容指南">
    * 避免在提示中使用受版权保护的材料
    * 使用原创歌词和音乐描述
    * 注意歌词内容的内容政策
    * 测试提示变化以避免敏感词过滤器
  </Accordion>
</AccordionGroup>

## 错误处理

<AccordionGroup>
  <Accordion title="内容政策违反（代码 400）">

```javascript
try {
  const taskId = await api.generateMusic('受版权保护的歌词');
} catch (error) {
  if (error.data.code === 400) {
    console.log('请仅使用原创内容');
  }
}
```

  </Accordion>

  <Accordion title="积分不足（代码 402）">

```javascript
try {
  const taskId = await api.generateMusic('原创作品');
} catch (error) {
  if (error.data.code === 402) {
    console.log('请为您的账户添加更多积分');
  }
}
```

  </Accordion>

  <Accordion title="速率限制（代码 429）">

```javascript
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(prompt, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await api.generateMusic(prompt, options);
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

## 支持

:::info[]
需要帮助吗？我们的技术支持团队随时为您提供帮助。

* **邮箱**: [support@kie.ai](mailto:support@kie.ai)
* **文档**: [docs.kie.ai](https://docs.kie.ai)
* **API状态**: 查看我们的状态页面了解实时API健康状况
:::

---

准备开始创作令人惊叹的AI音乐了吗？[获取您的API密钥](https://kie.ai/api-key)，立即开始创作！

