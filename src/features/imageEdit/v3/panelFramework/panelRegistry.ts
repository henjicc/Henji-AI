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
  /** 停靠时的最小宽高（重要记录 020）；不写时取右侧面板的默认值 IMAGE_EDITOR_PANEL_MIN_WIDTH_V3 */
  minimumWidth?: number
  minimumHeight?: number
  onVisibilityChange?: (context: ImageEditorPanelContextV3) => void
}

/** 右侧面板的默认最小宽度：图层行（缩略图、名称、显隐与操作按钮）在这个宽度下不裁切。 */
export const IMAGE_EDITOR_PANEL_MIN_WIDTH_V3 = 260
/** 画布的最小宽度。 */
export const IMAGE_EDITOR_PREVIEW_MIN_WIDTH_V3 = 320

/** 停靠布局用的面板定义：画布在前，各面板没写最小宽度时取默认值（布局解析与预设登记共用这一份）。 */
export function imageEditorDockPanelsV3(definitions: readonly ImageEditorPanelDefinitionV3[]): Array<{ id: string; title?: string; minimumWidth?: number; minimumHeight?: number }> {
  return [{ id: 'preview', title: '画布', minimumWidth: IMAGE_EDITOR_PREVIEW_MIN_WIDTH_V3 }, ...definitions.map(definition => ({ id: definition.id, title: definition.title, minimumWidth: definition.minimumWidth ?? IMAGE_EDITOR_PANEL_MIN_WIDTH_V3, minimumHeight: definition.minimumHeight }))]
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
