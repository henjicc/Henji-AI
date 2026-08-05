// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    getResourceBundle: () => null,
  },
}))

import modelManifest from '../../../resources/model-manifest.json'
import {
  applicationControlCoverageManifestSchema,
  applicationPublicControlCoverageSchema,
} from '../application-control'
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry'
import { listAnimatablePropertyPaths } from '@/features/cameraStage/domain/animatableProps'
import { getImageEditorTools } from '@/features/imageEdit/tools/registry'
import { listApplicationSettingIds } from '@/features/assistant/applicationCapabilities/settingsRegistry'
import { listApplicationSurfaces } from '@/features/assistant/applicationCapabilities/surfaceRegistry'
import { BUILTIN_APPLICATION_CAPABILITIES } from './builtinApplicationCapabilityRegistry'
import { createApplicationControlCoverageManifest } from './applicationControlCoverage'

function createManifest() {
  return createApplicationControlCoverageManifest({
    settings: listApplicationSettingIds(),
    surfaces: listApplicationSurfaces().map((surface) => surface.id),
    models: modelManifest.models.map((model) => model.modelId),
    imageEditTools: getImageEditorTools().map((tool) => tool.id),
    cameraStageProperties: listAnimatablePropertyPaths(),
    canvasNodes: Object.keys(canvasNodeDefinitions),
  })
}

describe('application control coverage', () => {
  it('每项现有能力都有唯一迁移结论、目标和验证来源', () => {
    const manifest = createManifest()
    const actualIds = BUILTIN_APPLICATION_CAPABILITIES.map((capability) => capability.id).sort()
    const migrationIds = manifest.capabilityMigrations.map((item) => item.capabilityId).sort()
    expect(migrationIds).toEqual(actualIds)
    expect(new Set(migrationIds).size).toBe(migrationIds.length)
    expect(manifest.capabilityMigrations.every((item) => item.targetIds.length > 0)).toBe(true)
    expect(manifest.capabilityMigrations.every((item) => item.verification.length > 0)).toBe(true)
    expect(BUILTIN_APPLICATION_CAPABILITIES.every((capability) => (
      capability.control.impacts.length > 0
      && capability.control.impacts.every((impact) => (
        capability.readOnly ? impact.effect === 'observe' : impact.effect !== 'observe'
      ))
    ))).toBe(true)
  })

  it('设置、Surface、模型、图片编辑、三维和画布公开控制项全部归类', () => {
    const manifest = createManifest()
    const expectedKinds = [
      'setting', 'surface', 'model', 'image_edit_tool', 'camera_stage_property', 'canvas_node',
    ] as const
    for (const kind of expectedKinds) {
      const items = manifest.publicControls.filter((item) => item.kind === kind)
      expect(items.length, `${kind} 缺少覆盖项`).toBeGreaterThan(0)
      expect(items.every((item) => applicationPublicControlCoverageSchema.safeParse(item).success)).toBe(true)
    }
    const identities = manifest.publicControls.map((item) => `${item.kind}:${item.id}`)
    expect(new Set(identities).size).toBe(identities.length)
  })

  it('每个注册 Surface 都有受限观察提供者、遮罩和验证方式', () => {
    const manifest = createManifest()
    const registered = listApplicationSurfaces().map((surface) => surface.id).sort()
    const observed = manifest.surfaceObservations.map((item) => item.surfaceId).sort()
    expect(observed).toEqual(registered)
    expect(new Set(observed).size).toBe(observed.length)
    expect(manifest.surfaceObservations.every((item) => item.captureScope.includes(item.surfaceId))).toBe(true)
    expect(manifest.surfaceObservations.every((item) => item.maskPolicyId.length > 0)).toBe(true)
    expect(manifest.surfaceObservations.every((item) => item.implementationStatus === 'available')).toBe(true)
  })

  it('清单整体通过严格 schema 且数量从真实注册表计算', () => {
    const manifest = createManifest()
    expect(applicationControlCoverageManifestSchema.safeParse(manifest).success).toBe(true)
    expect(manifest.capabilityMigrations).toHaveLength(BUILTIN_APPLICATION_CAPABILITIES.length)
    expect(manifest.capabilityMigrations.every((item) => item.disposition === 'retain')).toBe(true)
    expect(manifest.capabilityMigrations.every((item) => item.targetIds.length === 1 && item.targetIds[0] === item.capabilityId)).toBe(true)
    expect(new Set(manifest.domains.map((item) => item.domain)).size).toBe(manifest.domains.length)
    expect(manifest.domains.every((item) => (
      item.entityTypes.length > 0
      && item.propertySources.length > 0
      && item.operationSource.length > 0
      && item.observationSource.length > 0
      && item.verificationSource.length > 0
    ))).toBe(true)
    expect(manifest.publicControls.filter((item) => item.kind === 'setting'))
      .toHaveLength(listApplicationSettingIds().length)
    expect(manifest.publicControls.filter((item) => item.kind === 'model'))
      .toHaveLength(modelManifest.models.length)
    const summary = {
      capabilities: manifest.capabilityMigrations.length,
      settings: listApplicationSettingIds().length,
      surfaces: manifest.surfaceObservations.length,
      models: modelManifest.models.length,
      imageEditTools: getImageEditorTools().length,
      cameraStageProperties: listAnimatablePropertyPaths().length,
      canvasNodes: Object.keys(canvasNodeDefinitions).length,
    }
    expect(Object.values(summary).every((count) => count > 0)).toBe(true)
  })
})
