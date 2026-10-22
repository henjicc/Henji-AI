import { collectImageEditLayerIdsV3 } from '@/core/imageEdit/v3/layerTypes'
import { useEffect } from 'react'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
import { contributeAppMenus, type AppMenuCommand } from '@/core/appMenu/appMenu'
import { useImageEditorSessionStoreV3 } from '../store'
import { getEffectiveSelectedIds, flattenImageEditLayerTreeV3, canDeleteImageEditLayersV3, canGroupImageEditLayersV3, canUngroupImageEditLayerV3, findImageEditLayerLocationV3, isImageEditLayerLocationEditableV3 } from './layerTreeV3'
import type { ImageEditorV3Controller } from './types'

const empty: readonly string[] = []

/** 图片编辑菜单沿用控制器、剪贴板执行器及图层面板的可编辑性检查。 */
export function ImageEditorAppMenusV3({ controller, clipboard, busy, disabled }: {
  controller: ImageEditorV3Controller
  clipboard: (action: 'copy' | 'merged' | 'paste') => Promise<void>
  busy: boolean
  disabled?: boolean
}): null {
  const visible = useAppMenuVisibility()
  const selected = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]?.selectedLayerIds ?? empty)
  useEffect(() => {
    if (!visible) return
    const layers = controller.document.layers
    const rows = flattenImageEditLayerTreeV3(layers, new Set(collectImageEditLayerIdsV3(layers)))
    const ids = getEffectiveSelectedIds(new Map(rows.map(row => [row.layer.id, row])), selected)
    const primary = ids.length === 1 ? findImageEditLayerLocationV3(layers, ids[0]) : null
    const blocked = disabled ? '正在保存，请稍候' : undefined
    const command = (id: string, label: string, run: AppMenuCommand['run'], reason?: string, editRole?: AppMenuCommand['editRole']): AppMenuCommand => ({
      kind: 'action', id: `imageEdit.${id}`, label, run, disabledReason: blocked ?? reason, editRole,
    })
    const select = (layerIds: string[]): void => useImageEditorSessionStoreV3.getState().setSelectedLayerIds(controller.sessionId, layerIds)
    return contributeAppMenus('imageEdit', [
      { menu: 'edit', order: 100, items: [
        command('undo', '撤销', controller.undo, controller.canUndo ? undefined : '没有可撤销的操作', 'undo'),
        command('redo', '重做', controller.redo, controller.canRedo ? undefined : '没有可重做的操作', 'redo'),
        command('copy', '复制图层或选区', () => clipboard('copy'), busy ? '正在处理剪贴板' : undefined, 'copy'),
        command('paste', '粘贴图片', () => clipboard('paste'), busy ? '正在处理剪贴板' : undefined, 'paste'),
        command('delete', '删除图层', () => ids.forEach(id => controller.deleteLayer(id)), canDeleteImageEditLayersV3(layers, ids) ? undefined : '请选择可编辑的图层'),
      ] },
      { menu: 'layer', label: '图层', order: 100, items: [
        command('copyMerged', '复制合成结果', () => clipboard('merged'), busy ? '正在处理剪贴板' : undefined),
        command('duplicate', '创建图层副本', () => {
          if (!primary) return
          const id = controller.duplicateLayer(primary.layer.id, primary.parentId, primary.index + 1)
          if (id) select([id])
        }, primary && isImageEditLayerLocationEditableV3(primary) ? undefined : '请选择一个可编辑的图层'),
        ...(controller.profile.layerKinds.includes('group') ? [
          command('group', '编组图层', () => { select([controller.groupLayers(ids, '图层组')]) }, canGroupImageEditLayersV3(layers, ids) ? undefined : '请选择同级相邻且未锁定的图层'),
          command('ungroup', '取消编组', () => {
            if (primary?.layer.type !== 'group') return
            const children = primary.layer.children.map(layer => layer.id)
            controller.ungroupLayer(primary.layer.id); select(children)
          }, canUngroupImageEditLayerV3(primary) ? undefined : '请选择未锁定的图层组'),
        ] : []),
      ] },
    ])
  }, [visible, controller, selected, clipboard, busy, disabled])
  return null
}
