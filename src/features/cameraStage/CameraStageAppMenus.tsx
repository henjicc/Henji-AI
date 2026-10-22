import { useEffect } from 'react'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
import { useCameraStageStore } from './store/cameraStageStore'
import { useCameraStageHistory } from './store/useCameraStageHistory'

export function CameraStageAppMenus(): null {
  const visible = useAppMenuVisibility()
  const selectedId = useCameraStageStore(state => state.selectedId)
  const { canUndo, canRedo, undo, redo } = useCameraStageHistory()
  useEffect(() => {
    if (!visible) return
    const missing = selectedId ? undefined : '请先选择对象'
    return contributeAppMenus('cameraStage', [
      { menu: 'edit', order: 100, items: [
        { kind: 'command', id: 'cameraStage.undo', editRole: 'undo', label: '撤销', disabledReason: canUndo ? undefined : '没有可撤销的操作', run: undo },
        { kind: 'command', id: 'cameraStage.redo', editRole: 'redo', label: '重做', disabledReason: canRedo ? undefined : '没有可重做的操作', run: redo },
        { kind: 'command', id: 'cameraStage.delete', label: '删除对象', disabledReason: missing, run: () => { if (selectedId) useCameraStageStore.getState().removeObject(selectedId) } },
      ] },
      { menu: 'cameraStage', label: '场景', order: 100, items: [
        { kind: 'command', id: 'cameraStage.duplicate', label: '创建对象副本', disabledReason: missing, run: () => { if (selectedId) useCameraStageStore.getState().duplicateObject(selectedId) } },
        { kind: 'command', id: 'cameraStage.focus', label: '聚焦选中对象', disabledReason: missing, run: () => useCameraStageStore.getState().requestFocusSelected() },
      ] },
    ])
  }, [visible, selectedId, canUndo, canRedo, undo, redo])
  return null
}
