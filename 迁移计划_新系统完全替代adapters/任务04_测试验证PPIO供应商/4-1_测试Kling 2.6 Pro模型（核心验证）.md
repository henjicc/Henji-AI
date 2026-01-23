# 4-1 测试Kling 2.6 Pro模型（核心验证）

## 目标
全面测试 Kling 2.6 Pro 模型，验证新系统架构的正确性。这是整个迁移的关键验证点。

## 测试环境准备

### 1. API 密钥配置
```typescript
// 在浏览器控制台或设置页面
const service = GenerationService.getInstance()
service.setApiKey('ppio', 'your-ppio-api-key')
service.setApiKey('fal', 'your-fal-api-key')  // 用于视频上传
```

### 2. 测试素材准备
- 测试图片：至少 2 张（用于图生视频、动作控制）
- 测试视频：1 个视频文件（用于动作控制）
- 测试提示词：准备几个描述性的 prompt

## 测试场景

### 场景1：纯文本生成视频

#### 测试用例 1.1
```typescript
// 参数设置
prompt: "A beautiful sunset over the ocean"
ppioKling26Mode: "text-image-to-video"
ppioKling26VideoDuration: 5
ppioKling26AspectRatio: "16:9"
ppioKling26CfgScale: 0.5
ppioKling26Sound: false

// 预期结果
✅ 调用端点：/async/kling-v2.6-pro-t2v
✅ 请求体包含所有参数
✅ 任务轮询成功
✅ 返回视频 URL
✅ 视频保存到本地
```

#### 验证点
- [ ] 控制台打印 🚀 API Request
- [ ] 请求体包含：prompt, duration, aspect_ratio, cfg_scale, sound
- [ ] 轮询日志正常
- [ ] 返回结果包含 url 和 filePath
- [ ] 本地文件可访问

#### 测试用例 1.2：不同参数组合
```typescript
// 10秒时长
ppioKling26VideoDuration: 10
// 预期：请求体 duration: 10

// 9:16 竖屏
ppioKling26AspectRatio: "9:16"
// 预期：请求体 aspect_ratio: "9:16"

// 生成音频
ppioKling26Sound: true
// 预期：请求体 sound: true
```

### 场景2：图片生成视频

#### 测试用例 2.1：单张图片
```typescript
// 参数设置
prompt: "Make it move"
ppioKling26Mode: "text-image-to-video"
ppioKling26VideoDuration: 5
uploadedImages: ['asset://path/to/image.jpg']

// 预期结果
✅ 调用端点：/async/kling-v2.6-pro-i2v
✅ 图片转为 base64
✅ 图片路径保存到本地
✅ 请求体包含 image 参数（base64）
```

#### 验证点
- [ ] PPIOProvider 日志显示"开始转换图片为 base64"
- [ ] 请求体包含 image 字段（base64 格式）
- [ ] uploadedFilePaths 数组有值
- [ ] 端点正确（i2v）

#### 测试用例 2.2：本地文件路径
测试不同的图片来源：
- [ ] asset:// 协议
- [ ] http://localhost 路径
- [ ] 绝对文件路径
- [ ] 已经是 base64 的图片

### 场景3：动作控制模式

#### 测试用例 3.1：基本动作控制
```typescript
// 参数设置
prompt: "Dance gracefully"
ppioKling26Mode: "motion-control"
uploadedImages: ['asset://path/to/person.jpg']  // 1张图片
video: new File([...], 'dance.mp4')              // 1个视频
ppioKling26CharacterOrientation: "video"
ppioKling26KeepOriginalSound: true

// 预期结果
✅ 调用端点：/async/kling-v2.6-pro-motion-control
✅ 图片转为 base64
✅ 视频上传到 Fal CDN
✅ 请求体包含：image, video, character_orientation, keep_original_sound
```

#### 验证点
- [ ] PPIOProvider 日志显示"开始上传视频到 Fal CDN"
- [ ] 请求体 video 是 Fal CDN URL
- [ ] 请求体 image 是 base64
- [ ] 请求体包含 character_orientation 和 keep_original_sound
- [ ] uploadedVideoFilePaths 数组有值

#### 测试用例 3.2：参数变化
```typescript
// 人物朝向与图片一致
ppioKling26CharacterOrientation: "image"
// 预期：请求体 character_orientation: "image"

// 不保留原始音频
ppioKling26KeepOriginalSound: false
// 预期：请求体 keep_original_sound: false
```

### 场景4：参数映射验证

#### 测试用例 4.1：所有 apiField 映射
验证每个参数的映射：

| UI 参数 | API 参数 | 验证 |
|---------|----------|------|
| ppioKling26Mode | mode | [ ] |
| ppioKling26VideoDuration | duration | [ ] |
| ppioKling26AspectRatio | aspect_ratio | [ ] |
| ppioKling26CfgScale | cfg_scale | [ ] |
| ppioKling26Sound | sound | [ ] |
| ppioKling26CharacterOrientation | character_orientation | [ ] |
| ppioKling26KeepOriginalSound | keep_original_sound | [ ] |

#### 测试用例 4.2：参数默认值
不设置某些参数，验证默认值：

```typescript
// 只设置必需参数
prompt: "Test"
ppioKling26Mode: "text-image-to-video"

// 预期使用默认值
duration: 5
aspect_ratio: "16:9"
cfg_scale: 0.5
sound: false
```

### 场景5：文件处理测试

#### 测试用例 5.1：图片格式
测试不同格式的图片：
- [ ] JPG 图片
- [ ] PNG 图片
- [ ] WebP 图片
- [ ] Base64 图片（已转换）

#### 测试用例 5.2：文件路径
测试不同路径格式：
- [ ] Windows 路径（D:\path\to\file.jpg）
- [ ] macOS 路径（/Users/path/to/file.jpg）
- [ ] Tauri asset:// 路径
- [ ] localhost URL

### 场景6：轮询测试

#### 测试用例 6.1：正常完成
- [ ] 任务在预期时间内完成
- [ ] 轮询日志显示进度
- [ ] 最终返回 completed 状态
- [ ] 返回结果包含视频 URL

#### 测试用例 6.2：错误处理
手动模拟错误（如果可能）：
- [ ] 任务失败（status: failed）
- [ ] 网络错误
- [ ] 超时（修改 maxAttempts 为小值测试）

### 场景7：端点选择测试

#### 测试用例 7.1：端点自动选择
验证 endpoints.selector 逻辑：

```typescript
// 文本生成 → t2v
mode: "text-image-to-video", images: []
// 预期端点：/async/kling-v2.6-pro-t2v

// 图片生成 → i2v
mode: "text-image-to-video", images: ['...']
// 预期端点：/async/kling-v2.6-pro-i2v

// 动作控制 → motion-control
mode: "motion-control"
// 预期端点：/async/kling-v2.6-pro-motion-control
```

## 测试记录表

创建文件：`任务04_测试验证PPIO供应商/Kling-2.6-Pro测试记录.md`

格式：
```markdown
## 场景1：纯文本生成视频
### 测试用例 1.1
- 时间：2024-XX-XX HH:MM
- 状态：✅ 通过 / ❌ 失败
- API请求：
  ```json
  {
    "prompt": "...",
    "duration": 5,
    ...
  }
  ```
- 结果：成功生成视频，用时 XX 秒
- 问题：无

### 测试用例 1.2
...
```

## 对比测试

### 与旧系统对比
使用相同参数在旧系统测试，对比：

1. **API 请求体**
   - 新系统：查看 🚀 API Request 日志
   - 旧系统：查看 🚀 PPIO API Request 日志
   - 对比：应该完全一致

2. **生成结果**
   - 使用相同 prompt 和参数
   - 对比生成的视频质量
   - 对比生成时长

3. **性能对比**
   - 记录生成用时
   - 记录轮询次数
   - 对比是否有性能退化

## 验证标准
- [ ] 所有测试场景通过
- [ ] API 请求体与旧系统一致
- [ ] 所有参数正确映射
- [ ] 文件处理正确
- [ ] 轮询机制正常
- [ ] 错误处理友好
- [ ] 性能无明显退化

## 预计工时
3-4小时

## 注意事项

1. **真实 API 调用**
   - 使用真实的 API Key
   - 会消耗配额
   - 保留测试生成的视频用于对比

2. **日志查看**
   - 打开浏览器控制台
   - 查看所有 🚀 开头的日志
   - 查看 PPIOProvider 的详细日志

3. **问题记录**
   - 详细记录每个问题
   - 包含重现步骤
   - 包含错误日志
   - 包含期望结果和实际结果

4. **关键验证点**
   - 端点选择是否正确
   - 参数映射是否完整
   - 图片转 base64 是否成功
   - 视频上传是否成功
   - 轮询是否正常

## 完成标志
Kling 2.6 Pro 所有功能测试通过，证明：
1. ✅ Provider 架构正确
2. ✅ GenerationService 路由正确
3. ✅ RequestBuilder 构建正确
4. ✅ 参数映射完整
5. ✅ 文件处理正确
6. ✅ 轮询机制正常

如果 Kling 2.6 Pro 通过，其他 PPIO 模型的成功概率很高！
