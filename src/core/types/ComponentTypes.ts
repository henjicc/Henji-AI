/**
 * 组件类型定义
 *
 * 定义所有支持的参数组件类型
 */

/**
 * 组件类型
 *
 * 基础组件：
 * - text: 文本输入框
 * - number: 数字输入框
 * - slider: 滑块
 * - dropdown: 下拉选择
 * - switch: 开关
 * - radio: 单选按钮组
 *
 * 复合组件：
 * - panel: 参数面板（用于分组）
 * - image-upload: 图片上传
 * - video-upload: 视频上传
 *
 * 特殊组件：
 * - resolution: 分辨率选择器（自定义组件）
 * - aspect-ratio: 宽高比选择器（自定义组件）
 */
export type ComponentType =
  // 基础组件
  | 'text'
  | 'number'
  | 'slider'
  | 'dropdown'
  | 'switch'
  | 'radio'
  // 复合组件
  | 'panel'
  | 'composite'
  | 'image-upload'
  | 'video-upload'
  // 特殊组件
  | 'resolution'
  | 'aspect-ratio'

/**
 * 值类型
 *
 * 参数的值类型
 */
export type ValueType = 'string' | 'number' | 'boolean' | 'array' | 'object'
