import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Undo2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { AlertDialog, UiIconButton } from '@/components/ui'
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
  const [confirmation, setConfirmation] = useState<{ id: string; version: number } | null>(null)
  const canReset = useMemo(() => hasAudioEditModifications(project), [project])
  const cancelPress = () => clearTimeout(timer.current)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { setConfirmation(null); hideMenu(); clearTimeout(timer.current) }, [project.id, hideMenu])
  const showMenu = (event: React.MouseEvent) => menu.showMenu(event, [{
    id: 'reset', label: '撤销所有修改', icon: <RotateCcw size={16} />, disabled: disabled || !canReset,
    onClick: () => {
      menu.hideMenu()
      const instance = getAudioEditProjectInstance(project.id)
      if (instance) setConfirmation({ id: project.id, version: instance.version })
    },
  }])
  const restore = async () => {
    if (!confirmation || restoring.current) return
    restoring.current = true
    setConfirmation(null)
    try { await undoAllAudioEditChanges(confirmation.id, confirmation.version); onRestored() }
    catch (error) { onError(error) }
    finally { restoring.current = false }
  }
  return <>
    <UiIconButton size="lg" disabled={disabled || (!canUndo && !canReset)}
      aria-label="撤销；长按撤销所有修改" title="撤销 · 长按可撤销所有修改" aria-haspopup="menu" aria-expanded={menu.menuVisible}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        cancelPress(); longPressed.current = false
        timer.current = setTimeout(() => { longPressed.current = true; showMenu(event) }, 500)
      }} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
      onClick={() => { if (longPressed.current) { longPressed.current = false; return } if (canUndo) onUndo() }}
      onContextMenu={showMenu}>
      <Undo2 size={16} />
    </UiIconButton>
    <ContextMenu visible={menu.menuVisible} position={menu.menuPosition} items={menu.menuItems} onClose={menu.hideMenu} />
    <AlertDialog isOpen={Boolean(confirmation)} title="撤销所有修改？" type="warning" closeLabel="取消"
      message={`将恢复全部声音和初始字幕，撤销删除、静音、分段、锁定及声音处理设置。项目名、参考稿和显示偏好保留；本次恢复仍可撤销。${project.editBaseline?.kind !== 'original' ? '\n此旧项目未保存最初识别原文，只能恢复至本版本保留的文字，早期改写无法追回。' : ''}`}
      onClose={() => setConfirmation(null)} actions={[{ label: '确认撤销所有修改', variant: 'primary', onClick: () => void restore() }]} />
  </>
}
