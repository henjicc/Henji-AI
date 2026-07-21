/**
 * 插槽数据类型系统（借鉴 ComfyUI 的类型化连接）
 *
 * - 每个参数 / 节点端口都拥有一个 SocketType，连接时按类型兼容性校验
 * - 既有的媒体类型（image/video/audio/text）是本类型系统的子集
 * - 纯逻辑，不含 UI，可被 core 模型定义与 canvas 渲染层共同引用
 */

import type { ComponentType, ValueType } from './ComponentTypes'
import type { NumberParamDef } from './ParamDef'
import {
  SOCKET_TYPE_COLOR_HEX,
  SOCKET_TYPE_COLOR_FALLBACK_HEX,
} from '@/core/theme/colorTokens'

export type SocketType =
  | 'STRING'
  | 'TEXT'
  | 'NUMBER'
  | 'INT'
  | 'FLOAT'
  | 'BOOLEAN'
  | 'ENUM'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'MODEL'
  | 'OBJECT'
  | '*'

/** 复合类型别名：一个别名展开成多个具体类型，用于兼容性判断 */
const SOCKET_TYPE_ALIASES: Record<string, string[]> = {
  NUMBER: ['INT', 'FLOAT'],
}

function hasFraction(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)
}

function deriveNumberSocketType(input: { step?: number; min?: number; max?: number }): SocketType {
  if (hasFraction(input.step) || hasFraction(input.min) || hasFraction(input.max)) {
    return 'FLOAT'
  }
  return 'INT'
}

/** 组件类型 → 插槽类型的默认推导（无需逐个 .model.ts 声明） */
export function deriveSocketType(input: {
  type: ComponentType
  valueType?: ValueType
  socketType?: SocketType
}): SocketType {
  if (input.socketType) {
    return input.socketType
  }
  switch (input.type) {
    case 'text':
    case 'textarea':
      return 'STRING'
    case 'number':
      return deriveNumberSocketType(input as NumberParamDef)
    case 'switch':
      return 'BOOLEAN'
    case 'dropdown':
    case 'radio':
      return 'ENUM'
    case 'image-upload':
      return 'IMAGE'
    case 'video-upload':
      return 'VIDEO'
    case 'resolution':
    case 'aspect-ratio':
    case 'composite':
    case 'panel':
      return 'OBJECT'
    default:
      return '*'
  }
}

function expandSocketType(token: string): string[] {
  const upper = token.trim().toUpperCase()
  if (!upper) {
    return []
  }
  return SOCKET_TYPE_ALIASES[upper] ?? [upper]
}

/**
 * 连接兼容性判断（source → target）。
 * - `*` 为通配，任意类型互通
 * - 支持逗号多类型（如 "INT,FLOAT"）与别名展开（如 NUMBER = INT,FLOAT）
 */
export function isSocketCompatible(
  source: SocketType | string | undefined | null,
  target: SocketType | string | undefined | null
): boolean {
  if (!source || !target) {
    return false
  }
  const left = String(source).toUpperCase()
  const right = String(target).toUpperCase()
  if (left === '*' || right === '*') {
    return true
  }
  const sources = left.split(',').flatMap(expandSocketType)
  const targets = right.split(',').flatMap(expandSocketType)
  return sources.some((a) =>
    targets.some((b) => a === b || a === '*' || b === '*')
  )
}

/** 插槽类型 → 端口颜色（hex 取自 colorTokens，业务组件不直接写字面量） */
export function getSocketColor(type: SocketType | string | undefined | null): string {
  if (!type) {
    return SOCKET_TYPE_COLOR_FALLBACK_HEX
  }
  return SOCKET_TYPE_COLOR_HEX[String(type).toUpperCase()] ?? SOCKET_TYPE_COLOR_FALLBACK_HEX
}

/**
 * 插槽类型 → 低透明度底色（用于"该行已连线"的背景提示）。
 * 在 getSocketColor 的 6 位 hex 基础上追加 2 位透明度，不引入新的颜色字面量。
 */
export function getSocketTintColor(
  type: SocketType | string | undefined | null,
  alphaHex = '14'
): string {
  return `${getSocketColor(type)}${alphaHex}`
}
