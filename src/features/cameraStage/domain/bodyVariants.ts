import type { StageVec3 } from './sceneTypes'

/**
 * 角色体型变体：同一套骨架/网格上的比例变体（不是独立模型），
 * 通过整体非均匀缩放 + 头部骨骼缩放实现，切换后骨骼结构不变、姿态滑杆继续可用。
 */

export type StageBodyVariantId = 'standard' | 'strong' | 'slim' | 'child'

export interface StageBodyVariant {
  id: StageBodyVariantId
  name: string
  /** 应用在角色模型容器上的整体缩放（非均匀，用于宽窄/高矮） */
  bodyScale: StageVec3
  /** 应用在头部骨骼上的缩放（儿童等变体需要更大的头身比） */
  headScale: number
}

export const BODY_VARIANTS: StageBodyVariant[] = [
  { id: 'standard', name: '标准', bodyScale: { x: 1, y: 1, z: 1 }, headScale: 1 },
  { id: 'strong', name: '健壮', bodyScale: { x: 1.18, y: 1.02, z: 1.18 }, headScale: 1 },
  { id: 'slim', name: '纤细', bodyScale: { x: 0.85, y: 1.02, z: 0.85 }, headScale: 1 },
  { id: 'child', name: '儿童', bodyScale: { x: 0.62, y: 0.62, z: 0.62 }, headScale: 1.4 },
]

export function getBodyVariant(id: StageBodyVariantId): StageBodyVariant {
  return BODY_VARIANTS.find((item) => item.id === id) ?? BODY_VARIANTS[0]
}
