import type { ComponentType } from 'react'

import type { ImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles'
import type { ImageEditorV3Controller } from '../editor/types'

/** 文档操作只来自正式 controller；visible 是视图生命周期，不是作品字段。 */
export interface ImageEditorPanelContextV3 {
  controller: ImageEditorV3Controller
  visible: boolean
}

export interface ImageEditorPanelDefinitionV3 {
  id: string
  titleKey: string
  title: string
  order: number
  component: ComponentType<ImageEditorPanelContextV3>
  defaultPlacement?: 'below' | 'tab'
  onVisibilityChange?: (context: ImageEditorPanelContextV3) => void
}

export class ImageEditorPanelRegistryV3 {
  private readonly definitions = new Map<string, ImageEditorPanelDefinitionV3>()

  constructor(entries: readonly ImageEditorPanelDefinitionV3[]) {
    for (const entry of entries) {
      if (!/^[a-z][a-z0-9-]*$/.test(entry.id) || entry.id === 'preview') {
        throw new Error(`无效的图片面板登记：${entry.id}`)
      }
      if (this.definitions.has(entry.id)) throw new Error(`图片面板重复登记：${entry.id}`)
      if (!entry.title || !entry.titleKey || !Number.isFinite(entry.order)) {
        throw new Error(`图片面板缺少标题或排序：${entry.id}`)
      }
      this.definitions.set(entry.id, Object.freeze({ ...entry }))
    }
  }

  list(profile: Pick<ImageEditorHostProfileV3, 'panels'>): readonly ImageEditorPanelDefinitionV3[] {
    return [...this.definitions.values()]
      .filter(({ id }) => profile.panels.some(panel => panel === id))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  }
}
