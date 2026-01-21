/**
 * 模型标签系统
 *
 * 用于替代硬编码的模型判断逻辑，通过标签描述模型特性
 *
 * @example
 * // 旧方式（硬编码）
 * if (selectedModel === 'nano-banana' || selectedModel === 'fal-ai-nano-banana') { ... }
 *
 * // 新方式（标签）
 * if (hasTag(selectedModel, 'supports-image-editing')) { ... }
 */

/**
 * 模型标签定义
 *
 * 标签命名规范：
 * - 使用 kebab-case 格式
 * - 描述模型的能力或特性，而非具体实现
 * - 保持标签粒度适中，避免过于细化
 */
export type ModelTag =
  // ========== 基础能力标签 ==========
  | 'text-to-image'              // 文生图
  | 'text-to-video'              // 文生视频
  | 'text-to-audio'              // 文生音频
  | 'image-to-image'             // 图生图（图片编辑）
  | 'image-to-video'             // 图生视频
  | 'video-to-video'             // 视频编辑

  // ========== 高级功能标签 ==========
  | 'supports-image-editing'     // 支持图片编辑（上传图片进行编辑）
  | 'supports-multi-image'       // 支持多图上传
  | 'supports-start-end-frame'   // 支持首尾帧模式
  | 'supports-reference-mode'    // 支持参考模式
  | 'supports-motion-control'    // 支持动作控制
  | 'supports-video-extension'   // 支持视频延长
  | 'supports-video-editing'     // 支持视频编辑
  | 'supports-audio-generation'  // 支持音频生成
  | 'supports-prompt-expansion'  // 支持提示词扩展
  | 'supports-negative-prompt'   // 支持负面提示词
  | 'supports-batch-generation'  // 支持批量生成

  // ========== UI 相关标签 ==========
  | 'no-resolution-panel'        // 不显示分辨率面板（使用自定义分辨率组件）
  | 'no-duration-slider'         // 不支持时长调整
  | 'no-image-upload'            // 不支持图片上传（纯文生模型）
  | 'requires-image'             // 必须上传图片（纯图生模型）
  | 'requires-video'             // 必须上传视频
  | 'english-prompt-only'        // 仅支持英文提示词
  | 'large-input-area'           // 使用大输入区域
  | 'hide-upload-when-has-image' // 上传图片后隐藏上传按钮

  // ========== 上传限制标签 ==========
  | 'max-images-1'               // 最多1张图片
  | 'max-images-2'               // 最多2张图片（首尾帧）
  | 'max-images-3'               // 最多3张图片
  | 'max-images-6'               // 最多6张图片
  | 'max-images-10'              // 最多10张图片
  | 'max-images-14'              // 最多14张图片
  | 'max-images-unlimited'       // 无限制

  // ========== 分辨率相关标签 ==========
  | 'custom-resolution'          // 自定义分辨率（魔搭模型）
  | 'fixed-aspect-ratio'         // 固定宽高比
  | 'supports-4k'                // 支持4K分辨率

  // ========== 性能相关标签 ==========
  | 'fast-mode'                  // 支持快速模式
  | 'turbo-mode'                 // 超快速模式
  | 'custom-polling'             // 自定义轮询间隔

  // ========== 特殊逻辑标签 ==========
  | 'special-upload-logic'       // 特殊上传逻辑（需要特殊处理）
  | 'mixed-upload-mode'          // 混合上传模式（图片+视频）
  | 'video-duration-check'       // 需要视频时长检查
  | 'sequential-generation'      // 顺序生成（组图）
  | 'multi-mode-switch'          // 多模式切换（根据mode参数改变行为）

  // ========== Provider 相关标签 ==========
  | 'provider-ppio'              // 派欧云提供商
  | 'provider-fal'               // Fal 提供商
  | 'provider-kie'               // KIE 提供商
  | 'provider-modelscope'        // 魔搭提供商

/**
 * 模型标签配置
 */
export interface ModelTagConfig {
  /**
   * 模型ID
   */
  modelId: string

  /**
   * 模型标签列表
   */
  tags: ModelTag[]
}

/**
 * 标签分类
 */
export const TAG_CATEGORIES = {
  CAPABILITY: '基础能力',
  ADVANCED: '高级功能',
  UI: 'UI相关',
  UPLOAD: '上传限制',
  RESOLUTION: '分辨率',
  PERFORMANCE: '性能',
  SPECIAL: '特殊逻辑',
  PROVIDER: 'Provider'
} as const

/**
 * 标签描述
 */
export const TAG_DESCRIPTIONS: Record<ModelTag, string> = {
  // 基础能力
  'text-to-image': '支持文本生成图片',
  'text-to-video': '支持文本生成视频',
  'text-to-audio': '支持文本生成音频',
  'image-to-image': '支持图片生成图片（图片编辑）',
  'image-to-video': '支持图片生成视频',
  'video-to-video': '支持视频编辑',

  // 高级功能
  'supports-image-editing': '支持图片编辑功能',
  'supports-multi-image': '支持上传多张图片',
  'supports-start-end-frame': '支持首尾帧模式',
  'supports-reference-mode': '支持参考模式',
  'supports-motion-control': '支持动作控制',
  'supports-video-extension': '支持视频延长',
  'supports-video-editing': '支持视频编辑',
  'supports-audio-generation': '支持音频生成',
  'supports-prompt-expansion': '支持提示词扩展',
  'supports-negative-prompt': '支持负面提示词',
  'supports-batch-generation': '支持批量生成',

  // UI 相关
  'no-resolution-panel': '不显示分辨率面板',
  'no-duration-slider': '不支持时长调整',
  'no-image-upload': '不支持图片上传',
  'requires-image': '必须上传图片',
  'requires-video': '必须上传视频',
  'english-prompt-only': '仅支持英文提示词',
  'large-input-area': '使用大输入区域',
  'hide-upload-when-has-image': '上传图片后隐藏上传按钮',

  // 上传限制
  'max-images-1': '最多1张图片',
  'max-images-2': '最多2张图片',
  'max-images-3': '最多3张图片',
  'max-images-6': '最多6张图片',
  'max-images-10': '最多10张图片',
  'max-images-14': '最多14张图片',
  'max-images-unlimited': '无限制图片数量',

  // 分辨率相关
  'custom-resolution': '使用自定义分辨率组件',
  'fixed-aspect-ratio': '固定宽高比',
  'supports-4k': '支持4K分辨率',

  // 性能相关
  'fast-mode': '支持快速模式',
  'turbo-mode': '超快速模式',
  'custom-polling': '自定义轮询间隔',

  // 特殊逻辑
  'special-upload-logic': '特殊上传逻辑',
  'mixed-upload-mode': '混合上传模式（图片+视频）',
  'video-duration-check': '需要视频时长检查',
  'sequential-generation': '顺序生成',
  'multi-mode-switch': '多模式切换',

  // Provider
  'provider-ppio': '派欧云提供商',
  'provider-fal': 'Fal 提供商',
  'provider-kie': 'KIE 提供商',
  'provider-modelscope': '魔搭提供商'
}
