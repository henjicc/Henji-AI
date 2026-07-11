import { useEffect } from 'react'
import type { StageGizmoMode } from '../domain/sceneTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  resolvePathShotId,
  useCameraStageToolStore,
  type StageEditorTool,
} from '../store/cameraStageToolStore'

/**
 * 编辑器作用域快捷键：W/E/R 切 gizmo 模式、F 聚焦选中对象、Delete/Backspace 删除选中、
 * Ctrl/Cmd+D 复制选中、Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做。
 * 输入框/可编辑区域内不拦截，交给原生行为。
 */

interface UseCameraStageShortcutsParams {
  selectedId: string | null
  setGizmoMode: (mode: StageGizmoMode) => void
  removeObject: (id: string) => void
  duplicateObject: (id: string) => void
  requestFocusSelected: () => void
  undo: () => void
  redo: () => void
}

const GIZMO_KEY_MODE: Record<string, { gizmo: StageGizmoMode; tool: StageEditorTool }> = {
  w: { gizmo: 'translate', tool: 'translate' },
  e: { gizmo: 'rotate', tool: 'rotate' },
  r: { gizmo: 'scale', tool: 'scale' },
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  const tag = element?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || !!element?.isContentEditable
}

export function useCameraStageShortcuts(params: UseCameraStageShortcutsParams): void {
  const {
    selectedId,
    setGizmoMode,
    removeObject,
    duplicateObject,
    requestFocusSelected,
    undo,
    redo,
  } = params

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()

      if (event.ctrlKey || event.metaKey) {
        if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
        } else if (key === 'y') {
          event.preventDefault()
          redo()
        } else if (key === 'd') {
          if (!selectedId) return
          event.preventDefault()
          duplicateObject(selectedId)
        }
        return
      }

      if (key in GIZMO_KEY_MODE) {
        const mode = GIZMO_KEY_MODE[key]
        setGizmoMode(mode.gizmo)
        useCameraStageToolStore.getState().setTool(mode.tool)
      } else if (key === 'v') {
        useCameraStageToolStore.getState().setTool('select')
      } else if (key === 'g') {
        const state = useCameraStageStore.getState()
        if (!selectedId || state.editorMode !== 'simple' || state.viewMode !== 'director') return
        const shotId = resolvePathShotId(state.shots, state.playback.currentTime, state.selectedShotId)
        if (shotId) {
          useCameraStageToolStore.getState().selectPath({ shotId, objectId: selectedId })
        }
      } else if (key === 'f') {
        if (!selectedId) return
        requestFocusSelected()
      } else if (key === 'delete' || key === 'backspace') {
        if (!selectedId) return
        removeObject(selectedId)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedId, setGizmoMode, removeObject, duplicateObject, requestFocusSelected, undo, redo])
}
