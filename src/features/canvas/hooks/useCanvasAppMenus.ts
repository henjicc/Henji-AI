import { useEffect, useRef } from 'react'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
import { contributeAppMenus, type AppMenuCommand } from '@/core/appMenu/appMenu'
import { useCanvasStore } from '@/stores/canvasStore'

export interface CanvasMenuActions {
  undo: () => void; redo: () => void; copy: () => void; paste: () => Promise<void>
  delete: () => Promise<void>; group: () => void; assetGroup: () => void; selectAll: () => void
}

/** 快捷键与菜单共用同一组动作，剪贴板状态也由快捷键宿主持有。 */
export function useCanvasAppMenus(actions: CanvasMenuActions, selectedCount: number, canPaste: boolean, tidy?: { start: () => Promise<void>; busy: boolean }): void {
  const visible = useAppMenuVisibility()
  const canUndo = useCanvasStore(state => state.history.past.length > 0)
  const canRedo = useCanvasStore(state => state.history.future.length > 0)
  const hasNodes = useCanvasStore(state => state.nodes.length > 0)
  const toolOpen = useCanvasStore(state => Boolean(state.activeToolDialog))
  // 动作随节点数组每帧重建；菜单只在可用状态变化时重新登记，执行时再取最新动作，拖动节点不触发菜单重建。
  const latest = useRef({ actions, tidy })
  latest.current = { actions, tidy }
  const hasTidy = Boolean(tidy), tidyBusy = Boolean(tidy?.busy)
  useEffect(() => {
    if (!visible || toolOpen) return
    const command = (id: keyof CanvasMenuActions, label: string, disabledReason?: string, editRole?: AppMenuCommand['editRole']): AppMenuCommand => ({ kind: 'action', id: `canvas.${id}`, label, disabledReason, editRole, run: () => latest.current.actions[id]() })
    return contributeAppMenus('canvas', [
      { menu: 'edit', order: 100, items: [
        command('undo', '撤销', canUndo ? undefined : '没有可撤销的操作', 'undo'),
        command('redo', '重做', canRedo ? undefined : '没有可重做的操作', 'redo'),
        command('copy', '复制节点', selectedCount ? undefined : '请先选择节点', 'copy'),
        command('paste', '粘贴节点', canPaste ? undefined : '请先复制节点', 'paste'),
        command('delete', '删除节点', selectedCount ? undefined : '请先选择节点'),
        command('selectAll', '全选节点', hasNodes ? undefined : '画布中没有节点', 'selectAll'),
      ] },
      { menu: 'node', label: '节点', order: 100, items: [
        command('group', '分组', selectedCount >= 2 ? undefined : '请至少选择两个节点'),
        command('assetGroup', '创建资产组', selectedCount >= 2 ? undefined : '请至少选择两个节点'),
        ...(hasTidy ? [{ kind: 'action' as const, id: 'canvas.tidy', label: '整理与对齐节点…', disabledReason: tidyBusy ? '正在整理，请稍候' : selectedCount < 2 ? '请至少选择两个节点' : undefined, run: () => latest.current.tidy?.start() }] : []),
      ] },
    ])
  }, [visible, toolOpen, selectedCount, canPaste, canUndo, canRedo, hasNodes, hasTidy, tidyBusy])
}
