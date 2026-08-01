import { describe, expect, it } from 'vitest'

import { APPLICATION_SURFACE_IDS } from '@/core/assistant/applicationSurfaces'
import { decideSurfacePresentation, getApplicationSurface, listApplicationSurfaces } from './surfaceCatalog'

describe('surface presentation policy', () => {
  it('全部注册 Surface 都声明通用观察能力和领域提供者', () => {
    const surfaces = listApplicationSurfaces()
    expect(surfaces.map((surface) => surface.id).sort()).toEqual([...APPLICATION_SURFACE_IDS].sort())
    expect(surfaces.every((surface) => surface.observationCapabilityId === 'observe_application_surface')).toBe(true)
    expect(surfaces.every((surface) => surface.observationProviderId.length > 0)).toBe(true)
    expect(surfaces.every((surface) => surface.observationPolicy.maxEdge === 1_600)).toBe(true)
    expect(surfaces.every((surface) => surface.observationPolicy.invalidWhen.length > 0)).toBe(true)
    expect(getApplicationSurface('settings.api_keys')?.observationPolicy).toMatchObject({
      dataClass: 'C2', maskPolicyId: 'surface.mask_sensitive_fields',
    })
    expect(getApplicationSurface('tool.camera_stage')?.observationProviderId).toBe('camera_stage.viewport_observer')
    expect(getApplicationSurface('workspace.generation')?.observationProviderId).toBe('generation.result_observer')
  })

  it('立即展示普通工作区和设置 Surface', () => {
    expect(decideSurfacePresentation({
      surfaceId: 'workspace.generation', hasStableTarget: false, alreadyActive: false, userTookOver: false,
    })).toBe('show_now')
    expect(decideSurfacePresentation({
      surfaceId: 'settings.interface', hasStableTarget: false, alreadyActive: false, userTookOver: false,
    })).toBe('show_now')
  })

  it('画布和编辑器先解析稳定目标再展示', () => {
    expect(getApplicationSurface('workspace.canvas')?.openPolicy).toBe('after_target_resolved')
    expect(decideSurfacePresentation({
      surfaceId: 'workspace.canvas', hasStableTarget: false, alreadyActive: false, userTookOver: false,
    })).toBe('resolve_target_first')
    expect(decideSurfacePresentation({
      surfaceId: 'workspace.canvas', hasStableTarget: true, alreadyActive: false, userTookOver: false,
    })).toBe('show_now')
  })

  it('后台优先、已打开和用户接管时不切换界面', () => {
    expect(decideSurfacePresentation({
      surfaceId: 'overlay.assets', hasStableTarget: true, alreadyActive: false, userTookOver: false,
    })).toBe('no_switch')
    expect(decideSurfacePresentation({
      surfaceId: 'workspace.generation', hasStableTarget: true, alreadyActive: true, userTookOver: false,
    })).toBe('no_switch')
    expect(decideSurfacePresentation({
      surfaceId: 'tool.image_edit', hasStableTarget: true, alreadyActive: false, userTookOver: true,
    })).toBe('preserve_user_takeover')
  })

  it('未知或不可用 Surface 返回明确结果', () => {
    expect(decideSurfacePresentation({
      surfaceId: 'workspace.missing', hasStableTarget: false, alreadyActive: false, userTookOver: false,
    })).toBe('unavailable')
    expect(decideSurfacePresentation({
      surfaceId: 'workspace.generation', hasStableTarget: false, alreadyActive: false, userTookOver: false,
      available: false,
    })).toBe('unavailable')
  })
})
