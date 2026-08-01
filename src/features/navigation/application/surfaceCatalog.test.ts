import { describe, expect, it } from 'vitest'

import { decideSurfacePresentation, getApplicationSurface } from './surfaceCatalog'

describe('surface presentation policy', () => {
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
