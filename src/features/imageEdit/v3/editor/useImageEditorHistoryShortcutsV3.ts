import { useEffect, type RefObject } from 'react'
import type { ImageEditorV3Controller } from './types'

/** 快捷键属于获得焦点的编辑器；输入框保留浏览器的文字撤销。 */
export function useImageEditorHistoryShortcutsV3(
  rootRef: RefObject<HTMLDivElement>,
  controller: ImageEditorV3Controller,
): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.altKey
        || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const root = rootRef.current
      const target = event.target instanceof Element ? event.target : null
      if (!root || !target) return
      // 弹窗首次打开时焦点落在外壳，尚未点击编辑器也不应穿透到画布。
      const dialog = root.closest('[role="dialog"]')
      if (!root.contains(target) && target !== dialog) return
      if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (root.closest('[inert]')) return
      const redo = key === 'y' || event.shiftKey
      if (redo ? controller.canRedo : controller.canUndo) {
        if (redo) controller.redo()
        else controller.undo()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [controller, rootRef])
}
