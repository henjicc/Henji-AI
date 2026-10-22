import { useEffect } from 'react'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'

/**
 * 音频编辑声明到标题栏菜单的命令：编辑（撤销、重做、查找替换）与“音频”（选区操作、导出）。
 * 全部调用界面上同一份操作；只在音频编辑显示时存在。
 */
export function AudioEditAppMenus({ onExport, onUndoAll }: { onExport: () => void; onUndoAll?: () => void }): null {
  const workspace = useAudioEditWorkspace()
  const { history, waveSelection, disabled, editSelection, textSearch } = workspace
  const busy = disabled ? '正在处理，请稍候' : undefined
  const noSelection = waveSelection ? undefined : '先在波形上拖出一段选区'
  useEffect(() => contributeAppMenus('audioEdit', [
    { menu: 'file', order: 10, items: [{ kind: 'command', id: 'audioEdit.export', label: '导出音频…', ...(busy ? { disabledReason: busy } : {}), run: onExport }] },
    { menu: 'edit', order: 0, items: [
      { kind: 'command', id: 'audioEdit.undo', label: '撤销', shortcut: 'Ctrl+Z', ...(!history.past.length ? { disabledReason: '没有可撤销的操作' } : busy ? { disabledReason: busy } : {}), run: history.undo },
      { kind: 'command', id: 'audioEdit.redo', label: '重做', shortcut: 'Ctrl+Shift+Z', ...(!history.future.length ? { disabledReason: '没有可重做的操作' } : busy ? { disabledReason: busy } : {}), run: history.redo },
      ...(onUndoAll ? [{ kind: 'command' as const, id: 'audioEdit.undoAll', label: '全部撤销…', ...(!history.past.length ? { disabledReason: '没有可撤销的操作' } : {}), run: onUndoAll }] : []),
    ] },
    { menu: 'edit', order: 10, items: [
      { kind: 'command', id: 'audioEdit.find', label: '查找', shortcut: 'Ctrl+F', run: () => textSearch.open() },
      { kind: 'command', id: 'audioEdit.replace', label: '替换', shortcut: 'Ctrl+H', run: () => textSearch.open(true) },
    ] },
    { menu: 'audio', label: '音频', order: 100, items: [
      { kind: 'command', id: 'audioEdit.selection.delete', label: '删除选区', shortcut: 'Delete', danger: true, ...(noSelection || busy ? { disabledReason: noSelection ?? busy } : {}), run: () => editSelection('delete') },
      { kind: 'command', id: 'audioEdit.selection.mute', label: '静音选区', shortcut: 'M', ...(noSelection || busy ? { disabledReason: noSelection ?? busy } : {}), run: () => editSelection('mute') },
      { kind: 'command', id: 'audioEdit.selection.restore', label: '恢复选区', ...(noSelection || busy ? { disabledReason: noSelection ?? busy } : {}), run: () => editSelection('restore') },
    ] },
  ]), [history, waveSelection, busy, noSelection, editSelection, textSearch, onExport, onUndoAll])
  return null
}
