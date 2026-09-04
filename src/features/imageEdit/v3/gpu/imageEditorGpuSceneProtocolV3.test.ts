import { describe, expect, it } from 'vitest'

import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  imageEditorGpuSceneTileKeyV3,
} from './imageEditorGpuSceneProtocolV3'

describe('imageEditorGpuSceneProtocolV3', () => {
  it('资源身份包含resource、mip、tile和内容版本', () => {
    const resourceRef = `sha256:${'a'.repeat(64)}` as const
    expect(imageEditorGpuSceneTileKeyV3({
      resourceRef,
      mip: 2,
      tileX: 3,
      tileY: 4,
      contentVersion: 'revision-9',
    })).toBe(`rgba8unorm:${resourceRef}:2:3:4:revision-9`)
    expect(IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3).toBe(256 * 1024 * 1024)
  })
})
