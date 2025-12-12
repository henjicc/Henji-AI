# Veo3.1 API 快速开始

欢迎使用 Veo3.1 API！本指南将帮助您快速开始使用我们的高质量 AI 视频生成服务。

## 概述

Veo3.1 API 是一个强大的 AI 视频生成平台，支持：

*   **文本转视频**: 通过描述性文本提示生成高质量视频
*   **图片转视频**: 让静态图片生动起来，创建引人入胜的视频
*   **高清支持**: 支持生成 1080P 高清视频（16:9 宽高比）
*   **实时回调**: 任务完成时自动推送结果到您的服务器

## 第一步：获取 API Key

1.  访问 [API Key 管理页面](https://kie.ai/api-key)
2.  注册或登录您的账户
3.  生成新的 API Key
4.  安全保存您的 API Key

请妥善保管您的 API Key，不要在公开代码库中暴露。如果怀疑泄露，请立即重置。

## 第二步：基本认证

所有 API 请求都需要在请求头中包含您的 API Key：

**API 基础地址**: `https://api.kie.ai`

```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

## 第三步：您的第一个视频生成

### 文本转视频示例

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

### 图片转视频示例

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

## 第四步：查询任务状态

视频生成通常需要几分钟时间。您可以通过轮询或回调获取结果。

### 轮询方式

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

### 状态说明

| successFlag | 说明 |
| :--- | :--- |
| 0 | 生成中 - 任务正在处理 |
| 1 | 成功 - 任务已成功完成 |
| 2 | 失败 - 任务生成失败 |
| 3 | 生成失败 - 任务创建成功但生成失败 |

## 第五步：获取高清视频（可选）

如果您使用 16:9 宽高比生成视频，可以获取 1080P 高清版本：

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

**注意**: 1080P 视频需要额外处理时间，建议在原视频生成完成后等待几分钟再调用此接口。

## 回调处理（推荐）

相比轮询，回调机制更高效。设置 `callBackUrl` 参数，任务完成时系统会自动推送结果：

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

## 完整示例：从生成到下载

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
      await this.downloadVideo(videoUrls[0], filename);
      
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

## 最佳实践

### 优化提示词
*   使用详细且具体的描述
*   包含动作、场景、风格信息
*   避免模糊或矛盾的描述

### 合理选择模型
*   `veo3`: 标准模型，质量更高（Veo3.1）
*   `veo3_fast`: 快速模型，生成更快（Veo3.1）

### 处理异常
*   实现重试机制
*   处理网络错误和API错误
*   记录错误日志便于调试

### 资源管理
*   及时下载和保存视频
*   合理控制并发请求数量
*   监控API使用额度

## 常见问题

**生成需要多长时间？**
通常需要 2-5 分钟，具体时间取决于视频复杂度和服务器负载。使用 `veo3_fast` 模型可以获得更快的生成速度。

**支持哪些图片格式？**
支持常见的图片格式，包括 JPG、PNG、WebP 等。确保图片 URL 可以被 API 服务器访问。

**如何获得更好的视频质量？**
*   使用详细且具体的提示词
*   选择 `veo3` 标准模型而非快速模型
*   对于 16:9 视频，可获取 1080P 高清版本

**视频 URL 有有效期吗？**
生成的视频 URL 有一定的有效期，建议及时下载并保存到您的存储系统中。

**如何处理生成失败？**
*   检查提示词是否违反内容政策
*   确认图片 URL 可正常访问
*   查看具体的错误消息
*   必要时联系技术支持

**如何生成超过 8 秒的Veo 3.1视频？**
直接在Veo 3.1中制作的片段限制为8秒。任何更长的视频都是在导出后通过外部编辑生成的。

## 下一步

*   **API 参考**: 查看完整的 API 参数和响应格式
*   **回调处理**: 学习如何处理任务完成回调
*   **获取详情**: 了解如何查询任务状态和结果

---

如果您在使用过程中遇到任何问题，请联系我们的技术支持：support@kie.ai