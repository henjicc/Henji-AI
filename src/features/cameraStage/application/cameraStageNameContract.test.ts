import { describe, expect, it } from 'vitest'

import {
  CAMERA_STAGE_NAME_MAX_LENGTH,
  cameraStageObjectUpdateSchema,
} from '@/core/assistant/capabilities/cameraStageCapabilitySchemas'

import { createPrimitiveObject, pickDefaultColor } from '../domain/sceneDefaults'
import { resolveUniqueCameraStageObjectName } from './cameraStageApplicationService'

// 双路径清单 DP-07：能力 schema 与领域唯一名称生成必须共用同一上限。

describe('三维名称约束唯一来源', () => {
  it('能力 schema 与领域唯一名称生成共同遵守同一上限', () => {
    const fullName = '名'.repeat(CAMERA_STAGE_NAME_MAX_LENGTH)
    expect(cameraStageObjectUpdateSchema.safeParse({ name: fullName }).success).toBe(true)
    expect(cameraStageObjectUpdateSchema.safeParse({ name: `${fullName}超` }).success).toBe(false)

    const existing = createPrimitiveObject('box', fullName, pickDefaultColor(0))
    const unique = resolveUniqueCameraStageObjectName([existing], fullName)
    expect(unique).not.toBe(fullName)
    expect(unique.length).toBeLessThanOrEqual(CAMERA_STAGE_NAME_MAX_LENGTH)
  })
})
