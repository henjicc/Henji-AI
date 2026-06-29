# Veo3.1 API 快速开始

> 5分钟内开始使用 Veo3.1 API

欢迎使用 Veo3.1 API！本指南将帮助您快速开始使用我们的高质量 AI 视频生成服务。

## 概述

Veo3.1 API 是一个强大的 AI 视频生成平台，支持：

<CardGroup cols={2}>
  <Card title="文本转视频" icon="lucide-text" href="/cn/veo3-api/generate-veo-3-video">
    通过描述性文本提示生成高质量视频
  </Card>

  <Card title="图片转视频" icon="lucide-image" href="/cn/veo3-api/generate-veo-3-video">
    让静态图片生动起来，创建引人入胜的视频
  </Card>

  <Card title="高清支持" icon="lucide-video" href="/cn/veo3-api/get-veo-3-1080-p-video">
    支持生成 1080P 高清视频（16:9 宽高比）
  </Card>

  <Card title="实时回调" icon="lucide-bell" href="/cn/veo3-api/generate-veo-3-video-callbacks">
    任务完成时自动推送结果到您的服务器
  </Card>
</CardGroup>

## 第一步：获取 API Key

1. 访问 [API Key 管理页面](https://kie.ai/api-key)
2. 注册或登录您的账户
3. 生成新的 API Key
4. 安全保存您的 API Key

::: warning[注意：]
请妥善保管您的 API Key，不要在公开代码库中暴露。如果怀疑泄露，请立即重置。
:::

## 第二步：基本认证

所有 API 请求都需要在请求头中包含您的 API Key：

```http  theme={null}
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

**API 基础地址**: `https://api.kie.ai`

## 第三步：您的第一个视频生成

### 文本转视频示例
<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    async function generateVideo() {
      try {
        const response = await fetch('https://api.kie.ai/api/v1/veo/generate', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer YOUR_API_KEY',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            prompt: "一只可爱的小猫在花园里玩耍，阳光明媚，高清画质",
            model: "veo3",
            aspectRatio: "16:9",
            callBackUrl: "https://your-website.com/callback" // 可选
          })
        });
        
        const data = await response.json();
        
        if (response.ok && data.code === 200) {
          console.log('任务已提交:', data);
          const taskId = data.data.taskId;
          console.log('任务 ID:', taskId);
          return taskId;
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
    import json

    def generate_video():
        url = "https://api.kie.ai/api/v1/veo/generate"
        headers = {
            "Authorization": "Bearer YOUR_API_KEY",
            "Content-Type": "application/json"
        }
        
        payload = {
            "prompt": "一只可爱的小猫在花园里玩耍，阳光明媚，高清画质",
            "model": "veo3",
            "aspectRatio": "16:9",
            "callBackUrl": "https://your-website.com/callback"  # 可选
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers)
            result = response.json()
            
            if response.ok and result.get('code') == 200:
                print(f"任务已提交: {result}")
                task_id = result['data']['taskId']
                print(f"任务 ID: {task_id}")
                return task_id
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
    curl -X POST "https://api.kie.ai/api/v1/veo/generate" \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "prompt": "一只可爱的小猫在花园里玩耍，阳光明媚，高清画质",
        "model": "veo3",
        "aspectRatio": "16:9",
        "callBackUrl": "https://your-website.com/callback"
      }'
    ```
  </TabItem>
</Tabs>

### 图片转视频示例
<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    async function generateVideoFromImage() {
      try {
        const response = await fetch('https://api.kie.ai/api/v1/veo/generate', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer YOUR_API_KEY',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            prompt: "让这张图片中的人物挥手微笑，背景轻微摇摆",
            imageUrls: ["https://your-domain.com/image.jpg"],
            model: "veo3",
            aspectRatio: "16:9"
          })
        });
        
        const data = await response.json();
        
        if (response.ok && data.code === 200) {
          console.log('任务已提交:', data);
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
    ```
  </TabItem>
  <TabItem value="python" label="Python">
    ```python
    def generate_video_from_image():
        url = "https://api.kie.ai/api/v1/veo/generate"
        headers = {
            "Authorization": "Bearer YOUR_API_KEY",
            "Content-Type": "application/json"
        }
        
        payload = {
            "prompt": "让这张图片中的人物挥手微笑，背景轻微摇摆",
            "imageUrls": ["https://your-domain.com/image.jpg"],
            "model": "veo3",
            "aspectRatio": "16:9"
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers)
            result = response.json()
            
            if response.ok and result.get('code') == 200:
                print(f"任务已提交: {result}")
                return result['data']['taskId']
            else:
                print(f"请求失败: {result.get('msg', '未知错误')}")
                return None
        except requests.exceptions.RequestException as e:
            print(f"错误: {e}")
            return None
    ```
  </TabItem>
  <TabItem value="curl" label="cURL">
    ```bash
    curl -X POST "https://api.kie.ai/api/v1/veo/generate" \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "prompt": "让这张图片中的人物挥手微笑，背景轻微摇摆",
        "imageUrls": ["https://your-domain.com/image.jpg"],
        "model": "veo3",
        "aspectRatio": "16:9"
      }'
    ```
  </TabItem>
</Tabs>

## 第四步：查询任务状态

视频生成通常需要几分钟时间。您可以通过轮询或回调获取结果。

### 轮询方式
<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    async function checkStatus(taskId) {
      try {
        const response = await fetch(`https://api.kie.ai/api/v1/veo/record-info?taskId=${taskId}`, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer YOUR_API_KEY'
          }
        });
        
        const data = await response.json();
        
        if (response.ok && data.code === 200) {
          const taskData = data.data;
          
          switch(taskData.successFlag) {
            case 0:
              console.log('生成中...');
              return null;
            case 1:
              console.log('生成成功!');
              console.log('视频URLs:', taskData.response.resultUrls);
              return taskData;
            case 2:
            case 3:
              console.log('生成失败:', taskData.errorMessage || data.msg);
              return false;
          }
        } else {
          console.error('查询失败:', data.msg || '未知错误');
        }
        
        return null;
      } catch (error) {
        console.error('查询状态失败:', error.message);
        return null;
      }
    }

    // 使用示例
    async function waitForCompletion(taskId) {
      let result = null;
      while (result === null) {
        result = await checkStatus(taskId);
        if (result === null) {
          await new Promise(resolve => setTimeout(resolve, 30000)); // 等待30秒
        }
      }
      return result;
    }
    ```
  </TabItem>
  <TabItem value="python" label="Python">
    ```python
    import time

    def check_status(task_id):
        url = f"https://api.kie.ai/api/v1/veo/record-info?taskId={task_id}"
        headers = {"Authorization": "Bearer YOUR_API_KEY"}
        
        try:
            response = requests.get(url, headers=headers)
            result = response.json()
            
            if response.ok and result.get('code') == 200:
                task_data = result['data']
                status = task_data['successFlag']
                
                if status == 0:
                    print("生成中...")
                    return None
                elif status == 1:
                    print("生成成功!")
                    video_urls = task_data['response']['resultUrls']
                    print(f"视频URLs: {video_urls}")
                    return task_data
                else:
                    print(f"生成失败: {task_data.get('errorMessage', result.get('msg'))}")
                    return False
            else:
                print(f"查询失败: {result.get('msg', '未知错误')}")
                return None
                
        except requests.exceptions.RequestException as e:
            print(f"查询状态失败: {e}")
            return None

    def wait_for_completion(task_id):
        while True:
            result = check_status(task_id)
            if result is not None:
                return result
            time.sleep(30)  # 等待30秒
    ```
  </TabItem>
  <TabItem value="curl" label="cURL">
    ```bash
    curl -X GET "https://api.kie.ai/api/v1/veo/record-info?taskId=YOUR_TASK_ID" \
      -H "Authorization: Bearer YOUR_API_KEY"
    ```
  </TabItem>
</Tabs>

### 状态说明

| successFlag | 说明                 |
| ----------- | ------------------ |
| 0           | 生成中 - 任务正在处理       |
| 1           | 成功 - 任务已成功完成       |
| 2           | 失败 - 任务生成失败        |
| 3           | 生成失败 - 任务创建成功但生成失败 |

## 第五步：获取高清视频（可选）

如果您使用 16:9 宽高比生成视频，可以获取 1080P 高清版本：
<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    async function get1080pVideo(taskId) {
      try {
        const response = await fetch(`https://api.kie.ai/api/v1/veo/get-1080p-video?taskId=${taskId}`, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer YOUR_API_KEY'
          }
        });
        
        const data = await response.json();
        
        if (response.ok && data.code === 200) {
          console.log('1080P 视频:', data);
          return data;
        } else {
          console.error('获取1080P视频失败:', data.msg || '未知错误');
          return null;
        }
      } catch (error) {
        console.error('获取1080P视频失败:', error.message);
        return null;
      }
    }
    ```
  </TabItem>
  <TabItem value="python" label="Python">
    ```python
    def get_1080p_video(task_id):
        url = f"https://api.kie.ai/api/v1/veo/get-1080p-video?taskId={task_id}"
        headers = {"Authorization": "Bearer YOUR_API_KEY"}
        
        try:
            response = requests.get(url, headers=headers)
            result = response.json()
            
            if response.ok and result.get('code') == 200:
                print(f"1080P 视频: {result}")
                return result
            else:
                print(f"获取1080P视频失败: {result.get('msg', '未知错误')}")
                return None
        except requests.exceptions.RequestException as e:
            print(f"获取1080P视频失败: {e}")
            return None
    ```
  </TabItem>
  <TabItem value="curl" label="cURL">
    ```bash
    curl -X GET "https://api.kie.ai/api/v1/veo/get-1080p-video?taskId=YOUR_TASK_ID" \
      -H "Authorization: Bearer YOUR_API_KEY"
    ```
  </TabItem>
</Tabs>

:::info[]
**注意**: 1080P 视频需要额外处理时间，建议在原视频生成完成后等待几分钟再调用此接口。
:::

## 回调处理（推荐）

相比轮询，回调机制更高效。设置 `callBackUrl` 参数，任务完成时系统会自动推送结果：
<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const express = require('express');
    const app = express();

    app.use(express.json());

    app.post('/veo3-1-callback', (req, res) => {
      const { code, msg, data } = req.body;
      
      console.log('收到回调:', {
        taskId: data.taskId,
        status: code,
        message: msg
      });
      
      if (code === 200) {
        // 视频生成成功
        const videoUrls = data.info.resultUrls;
        console.log('视频生成成功:', videoUrls);
        
        // 处理生成的视频...
        downloadAndProcessVideos(videoUrls);
      } else {
        console.log('视频生成失败:', msg);
      }
      
      // 返回200确认收到回调
      res.status(200).json({ status: 'received' });
    });

    app.listen(3000, () => {
      console.log('回调服务器运行在端口 3000');
    });
    ```
  </TabItem>
  <TabItem value="python" label="Python">
    ```python
    from flask import Flask, request, jsonify
    import json

    app = Flask(__name__)

    @app.route('/veo3-1-callback', methods=['POST'])
    def handle_callback():
        data = request.json
        
        code = data.get('code')
        msg = data.get('msg')
        task_data = data.get('data', {})
        
        print(f"收到回调: {task_data.get('taskId')}, 状态: {code}")
        
        if code == 200:
            # 视频生成成功
            video_urls = task_data['info']['resultUrls']
            print(f"视频生成成功: {video_urls}")
            
            # 处理生成的视频...
            download_and_process_videos(video_urls)
        else:
            print(f"视频生成失败: {msg}")
        
        return jsonify({'status': 'received'}), 200

    if __name__ == '__main__':
        app.run(host='0.0.0.0', port=3000)
    ```
  </TabItem>
</Tabs>

## 完整示例：从生成到下载
<Tabs>
  <TabItem value="nodejs" label="Node.js">
    ```javascript
    const fs = require('fs');
    const https = require('https');

    class Veo31Client {
      constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.kie.ai';
        this.headers = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        };
      }

      // 生成视频
      async generateVideo(prompt, options = {}) {
        const payload = {
          prompt,
          model: options.model || 'veo3',
          aspectRatio: options.aspectRatio || '16:9',
          ...options
        };

        try {
          const response = await fetch(`${this.baseUrl}/api/v1/veo/generate`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(payload)
          });
          
          const data = await response.json();
          
          if (response.ok && data.code === 200) {
            return data.data.taskId;
          } else {
            throw new Error(`生成视频失败: ${data.msg || '未知错误'}`);
          }
        } catch (error) {
          throw new Error(`生成视频失败: ${error.message}`);
        }
      }

      // 查询状态
      async getStatus(taskId) {
        try {
          const response = await fetch(`${this.baseUrl}/api/v1/veo/record-info?taskId=${taskId}`, {
            method: 'GET',
            headers: { 'Authorization': this.headers.Authorization }
          });
          
          const data = await response.json();
          
          if (response.ok && data.code === 200) {
            return data.data;
          } else {
            throw new Error(`查询状态失败: ${data.msg || '未知错误'}`);
          }
        } catch (error) {
          throw new Error(`查询状态失败: ${error.message}`);
        }
      }

      // 等待完成
      async waitForCompletion(taskId, maxWaitTime = 600000) { // 默认最多等待10分钟
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
          const status = await this.getStatus(taskId);
          
          console.log(`任务 ${taskId} 状态: ${status.successFlag}`);
          
          if (status.successFlag === 1) {
            return status.response.resultUrls;
          } else if (status.successFlag === 2 || status.successFlag === 3) {
            throw new Error('视频生成失败');
          }
          
          await new Promise(resolve => setTimeout(resolve, 30000)); // 等待30秒
        }
        
        throw new Error('任务超时');
      }

      // 下载视频
      async downloadVideo(url, filename) {
        return new Promise((resolve, reject) => {
          const file = fs.createWriteStream(filename);
          
          https.get(url, (response) => {
            if (response.statusCode === 200) {
              response.pipe(file);
              file.on('finish', () => {
                file.close();
                console.log(`视频已下载: ${filename}`);
                resolve(filename);
              });
            } else {
              reject(new Error(`下载失败: HTTP ${response.statusCode}`));
            }
          }).on('error', reject);
        });
      }

      // 完整流程
      async generateAndDownload(prompt, filename = 'video.mp4', options = {}) {
        try {
          console.log('开始生成视频...');
          const taskId = await this.generateVideo(prompt, options);
          console.log(`任务已提交: ${taskId}`);
          
          console.log('等待生成完成...');
          const videoUrls = await this.waitForCompletion(taskId);
          console.log('视频生成完成!');
          
          console.log('开始下载视频...');
          await this.downloadVideo(videoUrls[, filename);
          
          return { taskId, videoUrls, filename };
        } catch (error) {
          console.error('错误:', error.message);
          throw error;
        }
      }
    }

    // 使用示例
    async function main() {
      const client = new Veo31Client('YOUR_API_KEY');
      
      try {
        const result = await client.generateAndDownload(
          '一只可爱的小猫在花园里玩耍，阳光明媚，高清画质',
          'cute_cat.mp4',
          { aspectRatio: '16:9' }
        );
        
        console.log('完成!', result);
      } catch (error) {
        console.error('生成失败:', error.message);
      }
    }

    main();
    ```
  </TabItem>
</Tabs>

## 最佳实践

<CardGroup cols={2}>
  <Card title="优化提示词" icon="lucide-lightbulb">
    * 使用详细且具体的描述
    * 包含动作、场景、风格信息
    * 避免模糊或矛盾的描述
  </Card>

  <Card title="合理选择模型" icon="lucide-cog">
    * `veo3`: 标准模型，质量更高（Veo3.1）
    * `veo3_fast`: 快速模型，生成更快（Veo3.1）
  </Card>

  <Card title="处理异常" icon="lucide-shield">
    * 实现重试机制
    * 处理网络错误和API错误
    * 记录错误日志便于调试
  </Card>

  <Card title="资源管理" icon="lucide-clock">
    * 及时下载和保存视频
    * 合理控制并发请求数量
    * 监控API使用额度
  </Card>
</CardGroup>

## 常见问题

<AccordionGroup>
  <Accordion title="生成需要多长时间？">
    通常需要 2-5 分钟，具体时间取决于视频复杂度和服务器负载。使用 `veo3_fast` 模型可以获得更快的生成速度。
  </Accordion>

  <Accordion title="支持哪些图片格式？">
    支持常见的图片格式，包括 JPG、PNG、WebP 等。确保图片 URL 可以被 API 服务器访问。
  </Accordion>

  <Accordion title="如何获得更好的视频质量？">
    * 使用详细且具体的提示词
    * 选择 `veo3` 标准模型而非快速模型
    * 对于 16:9 视频，可获取 1080P 高清版本
  </Accordion>

  <Accordion title="视频 URL 有有效期吗？">
    生成的视频 URL 有一定的有效期，建议及时下载并保存到您的存储系统中。
  </Accordion>

  <Accordion title="如何处理生成失败？">
    * 检查提示词是否违反内容政策
    * 确认图片 URL 可正常访问
    * 查看具体的错误消息
    * 必要时联系技术支持
  </Accordion>

  <Accordion title="如何生成超过 8 秒的Veo 3.1视频？">
    直接在Veo 3.1中制作的片段限制为8秒。任何更长的视频都是在导出后通过外部编辑生成的。
  </Accordion>
</AccordionGroup>

## 下一步

<CardGroup cols={3}>
  <Card title="API 参考" icon="lucide-book" href="/cn/veo3-api/generate-veo-3-video">
    查看完整的 API 参数和响应格式
  </Card>

  <Card title="回调处理" icon="lucide-webhook" href="/cn/veo3-api/generate-veo-3-video-callbacks">
    学习如何处理任务完成回调
  </Card>

  <Card title="获取详情" icon="lucide-video" href="/cn/veo3-api/get-veo-3-video-details">
    了解如何查询任务状态和结果
  </Card>
</CardGroup>

***

如果您在使用过程中遇到任何问题，请联系我们的技术支持：[support@kie.ai](mailto:support@kie.ai)

