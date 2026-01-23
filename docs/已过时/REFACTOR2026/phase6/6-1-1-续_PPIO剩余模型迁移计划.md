# Phase 6-1-1 续：PPIO 剩余模型迁移计划

> 创建日期：2026-01-22
> 状态：进行中

## 迁移状态概览

### 已完成（5个）
- ✅ seedream-4.5 (图片)
- ✅ kling-2.6-pro (视频)
- ✅ kling-o1 (视频)
- ✅ wan-2.6 (视频)
- ✅ seedance-1.5-pro (视频)

### 待迁移（8个）

#### 视频模型（7个）
1. ⏳ kling-2.5-turbo - 可灵 2.5 Turbo
2. ⏳ minimax-hailuo-2.3 - Minimax 海螺 2.3
3. ⏳ minimax-hailuo-02 - Minimax 海螺 02
4. ⏳ vidu-q1 - Vidu Q1
5. ⏳ pixverse-v4.5 - Pixverse V4.5
6. ⏳ wan-2.5-preview - Wan 2.5 Preview
7. ⏳ seedance-v1 - Seedance V1

#### 音频模型（1个）
8. ⏳ minimax-speech-2.6 - Minimax 语音 2.6

## 迁移顺序（按复杂度）

### 第一批：简单模型（3个）
1. **kling-2.5-turbo** - 简单的文/图生视频
2. **seedance-v1** - 旧版 Seedance
3. **wan-2.5-preview** - 旧版 Wan

### 第二批：中等复杂度（3个）
4. **pixverse-v4.5** - Pixverse 视频生成
5. **vidu-q1** - Vidu 视频生成
6. **minimax-hailuo-2.3** - Minimax 海螺 2.3

### 第三批：复杂模型（2个）
7. **minimax-hailuo-02** - Minimax 海螺 02
8. **minimax-speech-2.6** - 音频生成（新类型）

## 迁移原则

1. 保持与旧路由文件的业务逻辑一致
2. 使用 defineModel 辅助函数
3. 正确定义参数的 order 字段
4. 实现完整的 endpoints、request、pricing 配置
5. 每完成一个模型，更新 PPIO 模型注册中心
