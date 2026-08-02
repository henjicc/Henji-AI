import { describe, expect, it } from 'vitest'

import {
  APPLICATION_SURFACE_IDS,
  resolveSurfaceObservationProfile,
} from '@/core/assistant/applicationSurfaces'
import { SETTINGS_SECTION_IDS } from '@/core/types/settingsNavigation'
import {
  decideSurfacePresentation,
  getApplicationSurface,
  listApplicationSurfaces,
  resolveSettingsSurfaceId,
} from './surfaceCatalog'

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

  it('观察提供者、敏感度和模态与共享观察画像完全一致', () => {
    for (const surface of listApplicationSurfaces()) {
      const profile = resolveSurfaceObservationProfile(surface.id)
      expect(surface.observationProviderId, surface.id).toBe(profile.providerId)
      expect(surface.observationPolicy.strategy, surface.id).toBe(profile.strategy)
      expect(surface.observationPolicy.dataClass, surface.id).toBe(profile.dataClass)
      expect(surface.observationPolicy.maskPolicyId, surface.id).toBe(profile.maskPolicyId)
      expect([...surface.observationPolicy.supportedModalities], surface.id).toEqual([...profile.modalities])
    }
    // 素材与生成结果都直接返回稳定媒体原件，三种模态必须一致开放。
    for (const id of ['workspace.generation', 'workspace.assets', 'overlay.assets'] as const) {
      expect([...(getApplicationSurface(id)?.observationPolicy.supportedModalities ?? [])])
        .toEqual(['image', 'video', 'audio'])
    }
  })

  it('每个设置分区都能解析出专属 Surface，且大类不会串到无关分区', () => {
    const resolved = SETTINGS_SECTION_IDS.map((sectionId) => {
      const tab = sectionId.startsWith('general-')
        ? 'general' as const
        : sectionId.startsWith('api-') ? 'api' as const
          : sectionId.startsWith('interface-') ? 'interface' as const : 'models' as const
      return { sectionId, surfaceId: resolveSettingsSurfaceId(tab, sectionId) }
    })
    for (const item of resolved) {
      expect(item.surfaceId, item.sectionId).not.toBeNull()
      expect(getApplicationSurface(item.surfaceId ?? '')?.settingsTarget?.sectionId, item.sectionId)
        .toBe(item.sectionId)
    }
    expect(new Set(resolved.map((item) => item.surfaceId)).size).toBe(resolved.length)
    expect(resolveSettingsSurfaceId('general')).toBe('settings.general')
    expect(resolveSettingsSurfaceId('interface')).toBe('settings.interface')
    // api/models 没有大类级 Surface，未知分区不得退回不相关的 settings.general。
    expect(resolveSettingsSurfaceId('api')).toBe('settings.api_keys')
    expect(resolveSettingsSurfaceId('models')).toBe('settings.models')
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
