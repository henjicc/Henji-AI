import { Orientation, type DockviewApi, type SerializedDockview } from 'dockview-react'
import { registerWorkspaceLayout } from '@/services/workspaceLayouts/workspaceLayoutService'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.cameraStage.layout')

/** dockview 布局存储键与默认布局构建（供容器与面板头汉堡菜单共用） */

export const LAYOUT_STORAGE_KEY = 'henji.cameraStage.dockLayout.v2'

/**
 * 面板标题。标题会随布局一起记进 localStorage，旧布局里存的是旧标题（如“资源管理器”），
 * 所以恢复布局后按这张表回写一次，界面术语只在这里维护。
 * `properties` 的标签随内容变化（选中对象时“属性”，未选中时“场景设置”），由 DockTab 按内容显示，不写回布局。
 */
export const CAMERA_STAGE_PANEL_TITLES = {
  viewport: '视口',
  objects: '场景对象',
  properties: '属性',
  timeline: '状态关键帧',
} as const

export function defaultCameraStageLayout(focus = false): SerializedDockview {
  return {
    grid: { width: 1440, height: 860, orientation: Orientation.HORIZONTAL, root: { type: 'branch', data: [
      { type: 'branch', size: focus ? 1200 : 1160, data: [
        { type: 'leaf', size: focus ? 740 : 640, data: { id: 'viewport-group', views: ['viewport'], activeView: 'viewport' } },
        { type: 'leaf', size: focus ? 120 : 220, data: { id: 'timeline-group', views: ['timeline'], activeView: 'timeline' } },
      ] },
      { type: 'branch', size: focus ? 240 : 280, data: focus
        ? [{ type: 'leaf', data: { id: 'inspector-group', views: ['objects', 'properties'], activeView: 'objects' } }]
        : [{ type: 'leaf', size: 400, data: { id: 'objects-group', views: ['objects'], activeView: 'objects' } }, { type: 'leaf', size: 460, data: { id: 'properties-group', views: ['properties'], activeView: 'properties' } }],
      },
    ] } },
    panels: Object.fromEntries(Object.entries(CAMERA_STAGE_PANEL_TITLES).map(([id, title]) => [id, { id, contentComponent: id, title, renderer: 'always' as const }])), activeGroup: 'viewport-group',
  }
}
export const cameraStageLayoutPresets = registerWorkspaceLayout({
  workspaceId: 'camera_stage', panels: Object.entries(CAMERA_STAGE_PANEL_TITLES).map(([id, title]) => ({ id, title })),
  builtinPresets: [{ id: 'default', name: '默认', layout: defaultCameraStageLayout() }, { id: 'viewport', name: '专注视口', layout: defaultCameraStageLayout(true) }],
  readLegacy: () => { const raw = localStorage.getItem(LAYOUT_STORAGE_KEY); return raw ? JSON.parse(raw) as SerializedDockview : undefined },
})
export function resetLayout(_api: DockviewApi): void {
  void cameraStageLayoutPresets.resetActive().catch(error => logger.warn('三维布局重置失败', { error }))
}
/** 布局入口只重置当前预设，不修改场景或视口来源。 */
export function resetCameraStageWorkspace(api: DockviewApi): void { resetLayout(api) }
