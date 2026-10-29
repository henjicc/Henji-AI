import { UI_ICON_SIZE } from '@/core/theme/icons'
import { useEffect, useMemo, useRef } from 'react'
import { RotateCcw, Undo2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiIconButton } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import { hasAudioEditModifications } from '@/core/audioEdit/baseline'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { getAudioEditProjectInstance } from './application/audioEditProjectInstances'
import { undoAllAudioEditChanges } from './application/audioEditApplicationService'

export function AudioEditUndoButton({ project, canUndo, disabled, onUndo, onRestored, onError }: {
  project: AudioEditProjectDocument; canUndo: boolean; disabled: boolean
  onUndo: () => void; onRestored: () => void; onError: (error: unknown) => void
}) {
  const menu = useContextMenu()
  const hideMenu = menu.hideMenu
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const longPressed = useRef(false)
  const restoring = useRef(false)
  const canReset = useMemo(() => hasAudioEditModifications(project), [project])
  const cancelPress = () => clearTimeout(timer.current)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { hideMenu(); clearTimeout(timer.current) }, [project.id, hideMenu])
  const showMenu = (event: React.MouseEvent) => menu.showMenu(event, [{
    id: 'reset', label: '撤销所有修改', icon: <RotateCcw size={UI_ICON_SIZE.md} />, disabled: disabled || !canReset,
    onClick: () => {
      menu.hideMenu()
      const instance = getAudioEditProjectInstance(project.id)
      if (instance) void restore(instance.version)
    },
  }])
  const restore = async (version: number) => {
    if (restoring.current) return
    restoring.current = true
    try { await undoAllAudioEditChanges(project.id, version); onRestored() }
    catch (error) { onError(error) }
    finally { restoring.current = false }
  }
  return <>
    <UiIconButton size="md" disabled={disabled || (!canUndo && !canReset)}
      aria-label="撤销；长按撤销所有修改" tooltip="撤销 · 长按可撤销所有修改" aria-haspopup="menu" aria-expanded={menu.menuVisible}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        cancelPress(); longPressed.current = false
        timer.current = setTimeout(() => { longPressed.current = true; showMenu(event) }, 500)
      }} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
      onClick={() => { if (longPressed.current) { longPressed.current = false; return } if (canUndo) onUndo() }}
      onContextMenu={showMenu}>
      <Undo2  />
    </UiIconButton>
    <ContextMenu visible={menu.menuVisible} position={menu.menuPosition} items={menu.menuItems} onClose={menu.hideMenu} />
  </>
}
