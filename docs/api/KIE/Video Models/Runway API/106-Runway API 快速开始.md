# Runway API 快速开始

> 几分钟内开始使用 Runway API 生成令人惊叹的AI视频

## 欢迎使用 Runway API

Runway API 让您能够使用 Runway 先进AI模型的强大功能生成高质量的AI视频。无论您是在构建应用、自动化工作流程还是创建动态内容，我们的API都为AI视频生成提供了简单可靠的访问方式。

<CardGroup cols={2}>
  <Card title="文本转视频" icon="lucide-video" href="/cn/runway-api/generate-ai-video">
    将文本提示转换为动态视频内容
  </Card>

  <Card title="图像转视频" icon="lucide-play" href="/cn/runway-api/generate-ai-video">
    将现有图像制作成引人入胜的视频
  </Card>

  <Card title="视频延长" icon="lucide-plus" href="/cn/runway-api/extend-ai-video">
    延长视频以创建更长的序列
  </Card>

  <Card title="任务管理" icon="lucide-list-checks" href="/cn/runway-api/get-ai-video-details">
    跟踪和监控您的视频生成任务
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

### 第一步：生成您的第一个视频

从一个简单的文本转视频生成请求开始：

<Tabs groupId="programming-language">
  <TabItem value="javascript" label="Node.js">
    ```javascript
    async function generateVideo() {
      try {
        const response = await fetch('https://api.kie.ai/api/v1/runway/generate', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer YOUR_API_KEY',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            prompt: '一只毛茸茸的橙色小猫在彩色房间里充满活力地跳舞，周围有迪斯科灯光',
            duration: 5,
            quality: '720p',
            aspectRatio: '16:9',
            waterMark: ''
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

    generateVideo();
    ```
  </TabItem>

  <TabItem value="python" label="Python">
    ```python
    import requests

    def generate_video():
        url = "https://api.kie.ai/api/v1/runway/generate"
        headers = {
            "Authorization": "Bearer YOUR_API_KEY",
            "Content-Type": "application/json"
        }
        
        payload = {
            "prompt": "一只毛茸茸的橙色小猫在彩色房间里充满活力地跳舞，周围有迪斯科灯光",
            "duration": 5,
            "quality": "720p",
            "aspectRatio": "16:9",
            "waterMark": ""
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

    generate_video()
    ```
  </TabItem>

  <TabItem value="curl" label="cURL">
    ```bash
    curl -X POST "https://api.kie.ai/api/v1/runway/generate" \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "prompt": "一只毛茸茸的橙色小猫在彩色房间里充满活力地跳舞，周围有迪斯科灯光",
        "duration": 5,
        "quality": "720p",
        "aspectRatio": "16:9",
        "waterMark": ""
      }'
    ```
  </TabItem>
</Tabs>

### 第二步：检查任务状态

使用返回的任务ID检查生成状态：

<Tabs groupId="programming-language">
  <TabItem value="javascript" label="Node.js">
    ```javascript
    async function checkTaskStatus(taskId) {
      try {
        const response = await fetch(`https://api.kie.ai/api/v1/runway/record-detail?taskId=${taskId}`, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer YOUR_API_KEY'
          }
        });
        
        const result = await response.json();
        
        if (response.ok && result.code === 200) {
          const taskData = result.data;
          
          switch (taskData.state) {
            case 'wait':
              console.log('任务等待中...');
              console.log('创建时间:', taskData.generateTime);
              return taskData;
              
            case 'queueing':
              console.log('任务排队中...');
              console.log('创建时间:', taskData.generateTime);
              return taskData;
              
            case 'generating':
              console.log('任务生成中...');
              console.log('创建时间:', taskData.generateTime);
              return taskData;
              
            case 'success':
              console.log('任务生成成功！');
              console.log('视频URL:', taskData.videoInfo.videoUrl);
              console.log('缩略图URL:', taskData.videoInfo.imageUrl);
              console.log('生成时间:', taskData.generateTime);
              console.log('过期状态:', taskData.expireFlag === 0 ? '有效' : '已过期');
              return taskData;
              
            case 'fail':
              console.log('任务生成失败');
              if (taskData.failMsg) {
                console.error('失败原因:', taskData.failMsg);
              }
              console.log('生成时间:', taskData.generateTime);
              return taskData;
              
            default:
              console.log('未知状态:', taskData.state);
              if (taskData.failMsg) {
                console.error('错误信息:', taskData.failMsg);
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
    const status = await checkTaskStatus('YOUR_TASK_ID');
    ```
  </TabItem>

  <TabItem value="python" label="Python">
    ```python
    import requests
    import time

    def check_task_status(task_id, api_key):
        url = f"https://api.kie.ai/api/v1/runway/record-detail?taskId={task_id}"
        headers = {"Authorization": f"Bearer {api_key}"}
        
        try:
            response = requests.get(url, headers=headers)
            result = response.json()
            
            if response.ok and result.get('code') == 200:
                task_data = result['data']
                state = task_data['state']
                
                if state == 'wait':
                    print("任务等待中...")
                    print(f"创建时间: {task_data.get('generateTime', '')}")
                    return task_data
                elif state == 'queueing':
                    print("任务排队中...")
                    print(f"创建时间: {task_data.get('generateTime', '')}")
                    return task_data
                elif state == 'generating':
                    print("任务生成中...")
                    print(f"创建时间: {task_data.get('generateTime', '')}")
                    return task_data
                elif state == 'success':
                    print("任务生成成功！")
                    video_info = task_data.get('videoInfo', {})
                    print(f"视频URL: {video_info.get('videoUrl', '')}")
                    print(f"缩略图URL: {video_info.get('imageUrl', '')}")
                    print(f"生成时间: {task_data.get('generateTime', '')}")
                    expire_flag = task_data.get('expireFlag', 0)
                    print(f"过期状态: {'有效' if expire_flag == 0 else '已过期'}")
                    return task_data
                elif state == 'fail':
                    print("任务生成失败")
                    if task_data.get('failMsg'):
                        print(f"失败原因: {task_data['failMsg']}")
                    print(f"生成时间: {task_data.get('generateTime', '')}")
                    return task_data
                else:
                    print(f"未知状态: {state}")
                    if task_data.get('failMsg'):
                        print(f"错误信息: {task_data['failMsg']}")
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
            if result and result.get('state') in ['success', 'fail']:  # 最终状态
                return result
            time.sleep(30)  # 等待30秒后再次检查
    ```
  </TabItem>

  <TabItem value="curl" label="cURL">
    ```bash
    curl -X GET "https://api.kie.ai/api/v1/runway/record-detail?taskId=YOUR_TASK_ID" \
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
    "taskId": "ee603959-debb-48d1-98c4-a6d1c717eba6"
  }
}
```

**任务状态响应：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "ee603959-debb-48d1-98c4-a6d1c717eba6",
    "state": "success",
    "generateTime": "2023-08-15 14:30:45",
    "videoInfo": {
      "videoId": "485da89c-7fca-4340-8c04-101025b2ae71",
      "videoUrl": "https://file.com/k/xxxxxxx.mp4",
      "imageUrl": "https://file.com/m/xxxxxxxx.png"
    },
    "expireFlag": 0
  }
}
```

## 生成类型

<Tabs>
  <TabItem value="text-to-video" label="文本转视频">
    从文本描述生成视频：

    ```json
    {
      "prompt": "一只雄伟的老鹰在日落时分翱翔穿过山间云层",
      "duration": 5,
      "quality": "720p",
      "aspectRatio": "16:9"
    }
    ```
  </TabItem>

  <TabItem value="image-to-video" label="图像转视频">
    用文本提示为现有图像制作动画：

    ```json
    {
      "prompt": "角色开始自信地向前走",
      "imageUrl": "https://example.com/character-image.jpg",
      "duration": 5,
      "quality": "720p",
      "aspectRatio": "16:9"
    }
    ```
  </TabItem>

  <TabItem value="extend-video" label="视频延长">
    延长现有视频以创建更长的序列：

    ```json
    {
      "taskId": "ee603959-debb-48d1-98c4-a6d1c717eba6",
      "prompt": "小猫继续更有活力地跳舞并旋转",
      "quality": "720p"
    }
    ```
  </TabItem>
</Tabs>

## 视频质量选项

为您的需求选择合适的质量：

<CardGroup cols={2}>
  <Card title="720p 高清" icon="lucide-video">
    **标准质量**

    平衡文件大小和质量，适合大多数应用

    兼容5秒和10秒时长
  </Card>

  <Card title="1080p 全高清" icon="lucide-video">
    **优质质量**

    专业内容的更高分辨率

    仅适用于5秒视频
  </Card>
</CardGroup>

## 关键参数

#### `prompt` (string, required)
对所需视频内容的文本描述。请具体说明动作、移动和视觉风格。

**更好提示词的技巧：**

* 描述具体的动作和移动（如"缓慢行走"、"快速旋转"）
* 包含视觉风格描述符（如"电影感"、"动画"、"逼真"）
* 在相关时指定镜头角度（如"特写"、"远景"、"跟踪镜头"）
* 添加光线和氛围细节（如"黄金时段光线"、"戏剧性阴影"）

#### `duration` (number, required)
视频时长（秒）。可选择：

* `5` - 5秒视频（兼容720p和1080p）
* `10` - 10秒视频（仅兼容720p）

#### `quality` (string, required)
视频分辨率质量：

* `720p` - 高清质量，兼容所有时长
* `1080p` - 全高清质量，仅适用于5秒视频

#### `aspectRatio` (string, required)
视频宽高比。可选择：

* `16:9` - 宽屏（推荐用于横向内容）
* `9:16` - 垂直（完美适用于移动端和社交媒体）
* `1:1` - 方形（社交媒体帖子）
* `4:3` - 传统格式
* `3:4` - 肖像方向

#### `imageUrl` (string)
可选的参考图像URL来制作动画。提供后，AI将基于此图像创建视频。

#### `waterMark` (string)
可选的水印文本。留空表示无水印，或提供文本在右下角显示。

## 完整工作流程示例

以下是一个生成视频并等待完成的完整示例：

<Tabs groupId="programming-language">
  <TabItem value="javascript" label="JavaScript">
    ```javascript
    class RunwayAPI {
      constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.kie.ai/api/v1/runway';
      }
      
      async generateVideo(options) {
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
      
      async waitForCompletion(taskId, maxWaitTime = 600000) { // 最长等待10分钟
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
          const status = await this.getTaskStatus(taskId);
          
          switch (status.state) {
            case 'wait':
              console.log('任务等待中，继续等待...');
              break;
              
            case 'queueing':
              console.log('任务排队中，继续等待...');
              break;
              
            case 'generating':
              console.log('任务生成中，继续等待...');
              break;
              
            case 'success':
              console.log('生成成功完成！');
              return status;
              
            case 'fail':
              const error = status.failMsg || '任务生成失败';
              console.error('任务生成失败:', error);
              throw new Error(error);
              
            default:
              console.log(`未知状态: ${status.state}`);
              if (status.failMsg) {
                console.error('错误信息:', status.failMsg);
              }
              break;
          }
          
          // 等待30秒后再次检查
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
        
        throw new Error('生成超时');
      }
      
      async getTaskStatus(taskId) {
        const response = await fetch(`${this.baseUrl}/record-detail?taskId=${taskId}`, {
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
      
      async extendVideo(taskId, prompt, quality = '720p') {
        const response = await fetch(`${this.baseUrl}/extend`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            taskId,
            prompt,
            quality
          })
        });
        
        const result = await response.json();
        if (!response.ok || result.code !== 200) {
          throw new Error(`延长失败: ${result.msg || '未知错误'}`);
        }
        
        return result.data.taskId;
      }
    }

    // 使用示例
    async function main() {
      const api = new RunwayAPI('YOUR_API_KEY');
      
      try {
        // 文本转视频生成
        console.log('开始视频生成...');
        const taskId = await api.generateVideo({
          prompt: '一只毛茸茸的橙色小猫在彩色房间里充满活力地跳舞，周围有迪斯科灯光',
          duration: 5,
          quality: '720p',
          aspectRatio: '16:9',
          waterMark: ''
        });
        
        // 等待完成
        console.log(`任务ID: ${taskId}。等待完成...`);
        const result = await api.waitForCompletion(taskId);
        
        console.log('视频生成成功！');
        console.log('视频URL:', result.videoInfo.videoUrl);
        console.log('缩略图URL:', result.videoInfo.imageUrl);
        
        // 延长视频
        console.log('\n开始延长视频...');
        const extendTaskId = await api.extendVideo(taskId, '小猫旋转，活力和兴奋不断增加', '720p');
        
        const extendResult = await api.waitForCompletion(extendTaskId);
        console.log('视频延长成功！');
        console.log('延长后视频URL:', extendResult.videoInfo.videoUrl);
        
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

    class RunwayAPI:
        def __init__(self, api_key):
            self.api_key = api_key
            self.base_url = 'https://api.kie.ai/api/v1/runway'
            self.headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }
        
        def generate_video(self, **options):
            response = requests.post(f'{self.base_url}/generate', 
                                   headers=self.headers, json=options)
            result = response.json()
            
            if not response.ok or result.get('code') != 200:
                raise Exception(f"生成失败: {result.get('msg', '未知错误')}")
            
            return result['data']['taskId']
        
        def wait_for_completion(self, task_id, max_wait_time=600):
            start_time = time.time()
            
            while time.time() - start_time < max_wait_time:
                status = self.get_task_status(task_id)
                state = status['state']
                
                if state == 'wait':
                    print("任务等待中，继续等待...")
                elif state == 'queueing':
                    print("任务排队中，继续等待...")
                elif state == 'generating':
                    print("任务生成中，继续等待...")
                elif state == 'success':
                    print("生成成功完成！")
                    return status
                elif state == 'fail':
                    error = status.get('failMsg', '任务生成失败')
                    print(f"任务生成失败: {error}")
                    raise Exception(error)
                else:
                    print(f"未知状态: {state}")
                    if status.get('failMsg'):
                        print(f"错误信息: {status['failMsg']}")
                
                time.sleep(30)  # 等待30秒
            
            raise Exception('生成超时')
        
        def get_task_status(self, task_id):
            response = requests.get(f'{self.base_url}/record-detail?taskId={task_id}',
                                  headers={'Authorization': f'Bearer {self.api_key}'})
            result = response.json()
            
            if not response.ok or result.get('code') != 200:
                raise Exception(f"查询状态失败: {result.get('msg', '未知错误')}")
            
            return result['data']
        
        def extend_video(self, task_id, prompt, quality='720p'):
            data = {
                'taskId': task_id,
                'prompt': prompt,
                'quality': quality
            }
            
            response = requests.post(f'{self.base_url}/extend', 
                                   headers=self.headers, json=data)
            result = response.json()
            
            if not response.ok or result.get('code') != 200:
                raise Exception(f"延长失败: {result.get('msg', '未知错误')}")
            
            return result['data']['taskId']

    # 使用示例
    def main():
        api = RunwayAPI('YOUR_API_KEY')
        
        try:
            # 文本转视频生成
            print('开始视频生成...')
            task_id = api.generate_video(
                prompt='一只毛茸茸的橙色小猫在彩色房间里充满活力地跳舞，周围有迪斯科灯光',
                duration=5,
                quality='720p',
                aspectRatio='16:9',
                waterMark=''
            )
            
            # 等待完成
            print(f'任务ID: {task_id}。等待完成...')
            result = api.wait_for_completion(task_id)
            
            print('视频生成成功！')
            print(f'视频URL: {result["videoInfo"]["videoUrl"]}')
            print(f'缩略图URL: {result["videoInfo"]["imageUrl"]}')
            
            # 延长视频
            print('\n开始延长视频...')
            extend_task_id = api.extend_video(task_id, '小猫旋转，活力和兴奋不断增加', '720p')
            
            extend_result = api.wait_for_completion(extend_task_id)
            print('视频延长成功！')
            print(f'延长后视频URL: {extend_result["videoInfo"]["videoUrl"]}')
            
        except Exception as error:
            print(f'错误: {error}')

    if __name__ == '__main__':
        main()
    ```
  </TabItem>
</Tabs>

## 使用回调的异步处理

对于生产应用，使用回调而不是轮询：

```json
{
  "prompt": "一个宁静的花园，樱花在微风中摇摆",
  "duration": 5,
  "quality": "720p",
  "aspectRatio": "16:9",
  "callBackUrl": "https://your-app.com/webhook/runway-callback"
}
```

当生成完成时，系统会将结果POST到您的回调URL。

<Card title="了解更多关于回调" icon="webhook" href="/cn/runway-api/generate-ai-video-callbacks-cn">
  实现和处理 Runway API 回调的完整指南
</Card>

## 视频延长工作流程

通过延长现有视频创建更长的视频序列：

1. **生成初始视频**：使用文本或图像输入创建基础视频
2. **检查完成状态**：等待初始视频成功完成
3. **延长视频**：使用原始任务ID创建延长
4. **链式延长**：重复此过程创建更长的序列

```javascript
// 第一步：生成初始视频
const initialResponse = await generateVideo({
  prompt: "一只猫开始在彩色房间里跳舞",
  duration: 5,
  quality: "720p",
  aspectRatio: "16:9"
});

// 第二步：等待完成并延长
const extendResponse = await extendVideo({
  taskId: initialResponse.data.taskId,
  prompt: "小猫旋转，活力和兴奋不断增加",
  quality: "720p"
});
```

## 最佳实践

<details>
  <summary>视频提示词工程</summary>
  * 专注于动作和移动而不是静态描述
  * 包含时间元素（如"逐渐"、"突然"、"缓慢"）
  * 在相关时描述镜头移动（如"拉近"、"左摇"）
  * 在延长过程中保持主题和风格的一致性
</details>

<details>
  <summary>性能优化</summary>
  * 使用回调而不是频繁轮询
  * 实施适当的错误处理和重试逻辑
  * 考虑视频时长与质量的权衡
  * 缓存结果并实施高效的存储解决方案
</details>

<details>
  <summary>质量和时长选择</summary>
  * 为更长的视频（10秒）或文件大小重要时选择720p
  * 为高质量短视频（仅5秒）使用1080p
  * 考虑目标平台的要求（社交媒体、网页等）
  * 测试不同组合以找到用例的最佳设置
</details>

<details>
  <summary>错误处理</summary>
  * 始终检查响应状态码
  * 为重试实施指数退避
  * 优雅地处理速率限制
  * 监控任务状态并适当处理失败
</details>

## 状态码

#### `200` (成功)
任务创建成功或请求完成

#### `400` (错误请求)
无效的请求参数或格式错误的JSON

#### `401` (未授权)
缺少或无效的API密钥

#### `402` (积分不足)
账户没有足够的积分进行操作

#### `422` (验证错误)
请求参数未通过验证检查

#### `429` (速率限制)
请求过多 - 实施退避策略

#### `500` (服务器错误)
内部服务器错误 - 如果持续存在请联系支持

## 任务状态说明

#### `state: wait` (等待中)
任务已创建，等待处理

#### `state: queueing` (排队中)
任务正在排队等待处理

#### `state: generating` (生成中)
任务正在生成处理中

#### `state: success` (成功)
任务成功完成

#### `state: fail` (失败)
任务生成失败

## 视频存储和过期

:::warning[]
生成的视频在自动删除前存储 **14天**。请在此时间范围内下载并保存您的视频。
:::

* 视频URL在生成后14天内保持可访问
* 响应中的 `expireFlag` 表示视频是否已过期（0 = 活跃，1 = 已过期）
* 规划您的工作流程以在过期前下载或处理视频
* 考虑为生产使用实施自动下载系统

## 支持

:::info[]
需要帮助吗？我们的技术支持团队随时为您提供帮助。

* **邮箱**: [support@kie.ai](mailto:support@kie.ai)
* **文档**: [docs.kie.ai](https://docs.kie.ai)
* **API状态**: 查看我们的状态页面了解实时API健康状况
:::

***

准备开始生成令人惊叹的AI视频了吗？[获取您的API密钥](https://kie.ai/api-key)，立即开始创作！
