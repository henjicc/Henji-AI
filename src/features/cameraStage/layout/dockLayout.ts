import type { DockviewApi } from 'dockview-react'

/** dockview 布局存储键与默认布局构建（供容器与面板头汉堡菜单共用） */

export const LAYOUT_STORAGE_KEY = 'henji.cameraStage.dockLayout.v2'

export function buildDefaultLayout(api: DockviewApi): void {
  api.clear()
  api.addPanel({ id: 'viewport', component: 'viewport', title: '视口', renderer: 'always' })
  api.addPanel({
    id: 'objects',
    component: 'objects',
    title: '资源管理器',
    position: { referencePanel: 'viewport', direction: 'right' },
    initialWidth: 280,
  })
  api.addPanel({
    id: 'properties',
    component: 'properties',
    title: '属性',
    position: { referencePanel: 'objects', direction: 'below' },
  })
  api.addPanel({
    id: 'timeline',
    component: 'timeline',
    title: '时间轴',
    position: { referencePanel: 'viewport', direction: 'below' },
    initialHeight: 220,
  })
}

export function restoreLayout(api: DockviewApi): void {
  const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
  if (saved) {
    try {
      api.fromJSON(JSON.parse(saved))
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
