import type { DockviewApi } from 'dockview-react'
import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'

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

export function buildDefaultLayout(api: DockviewApi): void {
  api.clear()
  api.addPanel({ id: 'viewport', component: 'viewport', title: CAMERA_STAGE_PANEL_TITLES.viewport, renderer: 'always' })
  api.addPanel({
    id: 'objects',
    component: 'objects',
    title: CAMERA_STAGE_PANEL_TITLES.objects,
    position: { referencePanel: 'viewport', direction: 'right' },
    initialWidth: 280,
  })
  api.addPanel({
    id: 'properties',
    component: 'properties',
    title: CAMERA_STAGE_PANEL_TITLES.properties,
    position: { referencePanel: 'objects', direction: 'below' },
  })
  api.addPanel({
    id: 'timeline',
    component: 'timeline',
    title: CAMERA_STAGE_PANEL_TITLES.timeline,
    position: { referencePanel: 'viewport', direction: 'below' },
    initialHeight: 220,
  })
}

function syncPanelTitles(api: DockviewApi): void {
  for (const id of ['viewport', 'objects', 'timeline'] as const) {
    const panel = api.getPanel(id)
    if (panel && panel.title !== CAMERA_STAGE_PANEL_TITLES[id]) panel.api.setTitle(CAMERA_STAGE_PANEL_TITLES[id])
  }
}

export function restoreLayout(api: DockviewApi): void {
  const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
  if (saved) {
    try {
      api.fromJSON(JSON.parse(saved))
      syncPanelTitles(api)
      return
    } catch {
      localStorage.removeItem(LAYOUT_STORAGE_KEY)
    }
  }
  buildDefaultLayout(api)
}

/** 清除记忆布局并重建默认布局 */
export function resetLayout(api: DockviewApi): void {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
  buildDefaultLayout(api)
}

/** 重置整个工作区：面板布局 + 四窗格视口来源（命令带与面板菜单共用同一个动作）。 */
export function resetCameraStageWorkspace(api: DockviewApi): void {
  resetLayout(api)
  useCameraStageViewportStore.getState().resetViewports()
}
