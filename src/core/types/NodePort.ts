/**
 * NodePort - 节点端口类型定义
 *
 * 定义节点的输入和输出端口类型
 */

import type { I18nText } from './I18nText'

/**
 * 端口数据类型
 */
export type PortDataType =
  | 'string'      // 文本（如 prompt）
  | 'number'      // 数字
  | 'boolean'     // 布尔值
  | 'image'       // 图片（URL 或 base64）
  | 'video'       // 视频（URL）
  | 'audio'       // 音频（URL）
  | 'array'       // 数组
  | 'object'      // 对象
  | 'any'         // 任意类型

/**
 * 输入端口接口
 */
export interface InputPort {
  /** 端口 ID（对应参数 ID） */
  id: string

  /** 显示名称 */
  name: I18nText

  /** 数据类型 */
  type: PortDataType

  /** 是否必需 */
  required: boolean

  /** 默认值 */
  default?: any

  /** 描述 */
  description?: I18nText
}

/**
 * 输出端口接口
 */
export interface OutputPort {
  /** 端口 ID */
  id: string

  /** 显示名称 */
  name: I18nText

  /** 输出类型 */
  type: PortDataType

  /** 描述 */
  description?: I18nText
}
