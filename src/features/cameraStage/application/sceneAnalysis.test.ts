import { describe, expect, it } from 'vitest'

import { createCameraObject, createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import {
  calculateStageObjectBounds,
  matchReusableSceneObject,
  resolveScenePlacement,
  stageBoundsOverlap,
} from './sceneAnalysis'

const placement = {
  mode: 'auto' as const,
  spacing: 0.25,
  allowOverlap: false,
}

describe('三维对象复用与空间布置', () => {
  it('优先复用活动摄像机，避免重复创建默认摄像机', () => {
    const camera = createCameraObject('主摄像机', pickDefaultColor(0))

    const decision = matchReusableSceneObject([camera], {
      objectType: 'camera',
      role: 'camera',
      reusePolicy: 'prefer_existing',
    }, camera.id)

    expect(decision.object?.id).toBe(camera.id)
    expect(decision.reason).toContain('活动摄像机')
  })

  it('按名称和类型复用已有对象', () => {
    const subject = createPrimitiveObject('sphere', ' 产品主体 ', pickDefaultColor(0))

    const decision = matchReusableSceneObject([subject], {
      objectType: 'primitive',
      primitiveKind: 'sphere',
      name: '产品主体',
      reusePolicy: 'prefer_existing',
    }, null)

    expect(decision.object?.id).toBe(subject.id)
  })

  it('自动布置为新对象选择无边界盒重叠的位置', () => {
    const existing = createPrimitiveObject('box', '已有对象', pickDefaultColor(0))
    const incoming = createPrimitiveObject('box', '新对象', pickDefaultColor(1))

    const decision = resolveScenePlacement(incoming, [existing], placement)
    const placedBounds = calculateStageObjectBounds(incoming, {
      ...incoming.transform,
      position: decision.position,
    })

    expect(decision.conflicts).toEqual([])
    expect(stageBoundsOverlap(placedBounds, calculateStageObjectBounds(existing))).toBe(false)
  })

  it('用户明确坐标时保留坐标并报告重叠证据', () => {
    const existing = createPrimitiveObject('box', '已有对象', pickDefaultColor(0))
    const incoming = createPrimitiveObject('box', '新对象', pickDefaultColor(1))

    const decision = resolveScenePlacement(incoming, [existing], {
      ...placement,
      position: { ...existing.transform.position },
    })

    expect(decision.explicit).toBe(true)
    expect(decision.conflicts).toEqual([existing.id])
  })
})
