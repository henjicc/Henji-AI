// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/assistant/builtinApplicationCapabilityRegistry'
import { ASSET_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/assetApplicationCapabilities'
import { CAMERA_STAGE_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/cameraStageApplicationCapabilities'
import { CANVAS_BATCH_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import { CANVAS_MUTATION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import { CANVAS_PROJECT_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/canvasProjectApplicationCapabilities'
import { GENERATION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/generationApplicationCapabilities'
import { TOOLBOX_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/toolboxApplicationCapabilities'

import { listRendererApplicationCapabilityIds } from './registry'

describe('application capability handler coverage', () => {
  it('每项内建前端能力都有唯一处理器', () => {
    const definitionIds = BUILTIN_APPLICATION_CAPABILITY_REGISTRY
      .list()
      .filter((definition) => definition.side === 'frontend')
      .map((definition) => definition.id)
      .sort()
    const handlerIds = listRendererApplicationCapabilityIds().sort()

    expect(handlerIds).toEqual(definitionIds)
    expect(new Set(handlerIds).size).toBe(handlerIds.length)
  })

  it('旧前端工具已经全部成为原生能力定义', () => {
    const migrated = [
      ...GENERATION_APPLICATION_CAPABILITIES,
      ...ASSET_APPLICATION_CAPABILITIES,
      ...CANVAS_PROJECT_APPLICATION_CAPABILITIES,
      ...CANVAS_MUTATION_APPLICATION_CAPABILITIES,
      ...CANVAS_BATCH_APPLICATION_CAPABILITIES,
      ...CAMERA_STAGE_APPLICATION_CAPABILITIES,
      ...TOOLBOX_APPLICATION_CAPABILITIES,
    ]
    expect(migrated).toHaveLength(59)
    for (const definition of migrated) {
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(definition.id)).toBe(definition)
      expect(definition.permission).not.toBe('')
      expect(definition.successEvidence.length).toBeGreaterThan(0)
      expect(definition.failureRecovery.length).toBeGreaterThan(0)
    }
  })
})
