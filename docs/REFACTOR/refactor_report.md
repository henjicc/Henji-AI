# 参数重构报告

## 概览

- **重命名参数数量**: 25
- **修改文件数量**: 19
- **涉及模型数量**: 18

## 参数重命名详情

### fal-ai-bytedance-seedance-v1

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `falSeedanceV1VideoDuration` |

### fal-ai-bytedance-seedream-v4

| 旧参数名 | 新参数名 |
|---------|----------|
| `numImages` | `falSeedream40NumImages` |

### fal-ai-kling-image-o1

| 旧参数名 | 新参数名 |
|---------|----------|
| `aspectRatio` | `falKlingImageO1AspectRatio` |
| `num_images` | `falKlingImageO1Num_images` |

### fal-ai-kling-video-v2.6-pro

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `falKlingV26ProVideoDuration` |

### fal-ai-ltx-2

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `falLtx2VideoDuration` |

### fal-ai-nano-banana

| 旧参数名 | 新参数名 |
|---------|----------|
| `aspectRatio` | `falNanoBananaAspectRatio` |
| `num_images` | `falNanoBananaNum_images` |

### fal-ai-nano-banana-pro

| 旧参数名 | 新参数名 |
|---------|----------|
| `aspectRatio` | `falNanoBananaProAspectRatio` |
| `num_images` | `falNanoBananaProNum_images` |

### fal-ai-pixverse-v5.5

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `falPixverse55VideoDuration` |

### fal-ai-sora-2

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `falSora2VideoDuration` |

### fal-ai-veo-3.1

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `falVeo31VideoDuration` |

### fal-ai-vidu-q2

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `falViduQ2VideoDuration` |

### fal-ai-wan-25-preview

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `falWan25VideoDuration` |

### fal-ai-z-image-turbo

| 旧参数名 | 新参数名 |
|---------|----------|
| `imageSize` | `falZImageTurboImageSize` |
| `numImages` | `falZImageTurboNumImages` |

### kling-2.5-turbo

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoAspectRatio` | `ppioKling25VideoAspectRatio` |
| `videoDuration` | `ppioKling25VideoDuration` |

### minimax-hailuo-2.3

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `ppioHailuo23VideoDuration` |
| `videoResolution` | `ppioHailuo23VideoResolution` |

### pixverse-v4.5

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoAspectRatio` | `ppioPixverse45VideoAspectRatio` |
| `videoResolution` | `ppioPixverse45VideoResolution` |

### seedance-v1

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `ppioSeedanceV1VideoDuration` |

### wan-2.5-preview

| 旧参数名 | 新参数名 |
|---------|----------|
| `videoDuration` | `ppioWan25VideoDuration` |

## 修改文件列表

- `D:\VibeCode\Henji-AI\src\config\presetStateMapping.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-bytedance-seedance-v1.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-bytedance-seedream-v4.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-kling-image-o1.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-kling-video-v2.6-pro.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-ltx-2.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-nano-banana-pro.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-nano-banana.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-pixverse-v5.5.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-sora-2.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-veo-3.1.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-vidu-q2.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-wan-25-preview.ts`
- `D:\VibeCode\Henji-AI\src\models\fal-ai-z-image-turbo.ts`
- `D:\VibeCode\Henji-AI\src\models\kling-2.5-turbo.ts`
- `D:\VibeCode\Henji-AI\src\models\minimax-hailuo-2.3.ts`
- `D:\VibeCode\Henji-AI\src\models\pixverse-v4.5.ts`
- `D:\VibeCode\Henji-AI\src\models\seedance-v1.ts`
- `D:\VibeCode\Henji-AI\src\models\wan-2.5-preview.ts`

## 下一步操作

1. ✅ 检查生成的迁移脚本：`src/utils/parameterMigration.ts`
2. ✅ 在 `App.tsx` 中导入并调用 `migrateAllData()`
3. ✅ 运行 `npm run dev` 测试应用
4. ✅ 测试以下功能：
   - 切换不同模型
   - 修改参数
   - 保存和加载预设
   - 从历史记录重新编辑
5. ✅ 如果一切正常，提交代码：`git commit -am 'refactor: resolve parameter conflicts'`
