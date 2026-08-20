/**
 * 画布插槽类型 - canvas 层入口。
 *
 * 类型与兼容/颜色逻辑统一定义在 core（`@/core/types/SocketType`），
 * 本文件仅做 canvas 友好的再导出，并提供每参数端口的 handle id 约定。
 */

import type { CanvasNodeType } from './canvasNodes'
import { getCanvasNodeDefinition } from './nodeRegistry'
export { mediaSourcePortId, parseMediaSourcePortId } from './nodePorts'

export type { SocketType } from '@/core/types/SocketType'
export {
  deriveSocketType,
  isSocketCompatible,
  getSocketColor,
  getSocketTintColor,
} from '@/core/types/SocketType'

/** 每参数输入端口的 handle id 前缀（与整节点媒体端口 source/target 区分） */
const PARAM_PORT_PREFIX = 'param:'

/** 生成参数端口 handle id，如 paramPortId('duration') => 'param:duration' */
export function paramPortId(paramId: string): string {
  return `${PARAM_PORT_PREFIX}${paramId}`
}

/** 判断 handle id 是否为参数端口 */
export function isParamPortId(handleId: string | null | undefined): boolean {
  return typeof handleId === 'string' && handleId.startsWith(PARAM_PORT_PREFIX)
}

/** 从参数端口 handle id 解析出 paramId，非参数端口返回 null */
export function parseParamPortId(handleId: string | null | undefined): string | null {
  if (!isParamPortId(handleId)) {
    return null
  }
  return (handleId as string).slice(PARAM_PORT_PREFIX.length)
}

/** 可作为节点行的媒体类型（text 不走上传行，由 prompt 端口承载） */
export type RowMediaKind = 'image' | 'video' | 'audio'

/** 保留参数 id：提示词 / 媒体 / 模型端口，与真实模型 schema 参数 id 空间隔离 */
export const PROMPT_PARAM_ID = '__prompt'
export const MODEL_PARAM_ID = '__model'
export const MEDIA_PARAM_ID: Record<RowMediaKind, string> = {
  image: '__image',
  video: '__video',
  audio: '__audio',
}

export function promptPortId(): string {
  return paramPortId(PROMPT_PARAM_ID)
}

export function modelPortId(): string {
  return paramPortId(MODEL_PARAM_ID)
}

export function mediaPortId(kind: RowMediaKind): string {
  return paramPortId(MEDIA_PARAM_ID[kind])
}

/** 从参数端口 paramId 反查媒体类型，非媒体保留 id 返回 null */
export function mediaParamIdToKind(paramId: string): RowMediaKind | null {
  const entry = (Object.entries(MEDIA_PARAM_ID) as Array<[RowMediaKind, string]>)
    .find(([, reservedId]) => reservedId === paramId)
  return entry ? entry[0] : null
}

/**
 * 解析「媒体连接」应落在目标节点的哪个 handle 上：
 * - 目标节点为逐行模式（targetHandleMode==='rows'）→ 对应媒体类型的专属端口
 * - 否则（旧节点形态）→ 沿用单一 'target' handle
 *
 * 仅负责"地址解析"，不做媒体类型是否被接受的校验（由调用方按 ports.target.accepts 决定）。
 */
export function resolveMediaTargetHandle(
  targetType: CanvasNodeType,
  mediaKind: RowMediaKind
): string {
  const definition = getCanvasNodeDefinition(targetType)
  if (definition?.connectivity.targetHandleMode === 'rows') {
    return mediaPortId(mediaKind)
  }
  return 'target'
}
