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

  it('创建能力保持后台原子性，打开能力声明可验证 Surface', () => {
    const createCamera = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('create_camera_stage_project')
    expect(createCamera?.requiredScopes).not.toContain('navigation')
    expect(createCamera?.producesRefs).not.toContain('application.surface')
    expect(createCamera?.description).toContain('不切换当前界面')

    for (const id of ['open_camera_stage_project', 'open_canvas_project', 'focus_canvas_node']) {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)
      expect(definition?.requiredScopes).toContain('navigation')
      expect(definition?.producesRefs).toContain('application.surface')
      expect(definition?.successEvidence.join(' ')).toMatch(/tool\.camera_stage|workspace\.canvas/)
    }
  })

  it('所有声明产生应用 Surface 的能力都绑定导航作用域和界面成功证据', () => {
    const surfaceCapabilities = BUILTIN_APPLICATION_CAPABILITY_REGISTRY
      .list()
      .filter((definition) => definition.producesRefs.includes('application.surface'))

    for (const definition of surfaceCapabilities) {
      expect(definition.requiredScopes, definition.id).toContain('navigation')
      expect(definition.successEvidence.join(' '), definition.id).toMatch(
        /Surface|页面|工作区|编辑器|定位/
      )
    }
  })
})
