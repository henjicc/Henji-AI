import { useState } from 'react'
import { Settings2, Copy, Trash2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiButton, UiChipButton, UiIconButton } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { deleteVideoEditSequence, duplicateVideoEditSequence, setVideoEditProjectView, switchVideoEditSequence, updateVideoEditSequenceSettings, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditSequenceDialog } from './VideoEditSequenceDialog'

export function VideoEditSequenceTabs({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  const [settings, setSettings] = useState<VideoEditSequence | null>(null)
  const menu = useContextMenu()
  const id = instance.document.id
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  return <div className="shrink-0 bg-panel px-2 py-1" aria-label="序列标签">
    <div role="tablist" aria-label="已打开序列" className="flex items-center gap-1 overflow-x-auto">
      {instance.openSequenceIds.map(sequenceId => {
        const sequence = instance.document.sequences.find(item => item.id === sequenceId)
        if (!sequence) return null
        const active = sequence.id === instance.activeSequenceId
        return <div key={sequence.id} className="flex shrink-0 items-center" onContextMenu={event => menu.showMenu(event, [
          { id: 'settings', label: '序列设置', icon: <Settings2 size={16} />, onClick: () => setSettings(sequence) },
          { id: 'duplicate', label: '复制序列', icon: <Copy size={16} />, onClick: () => run(() => switchVideoEditSequence(id, duplicateVideoEditSequence(id, sequence.id))) },
          { id: 'delete', label: '移除空序列', icon: <Trash2 size={16} />, disabled: instance.document.sequences.length <= 1 || !!sequence.clips.length || !!sequence.annotations.length, onClick: () => run(() => deleteVideoEditSequence(id, sequence.id)) },
        ])}>
          <UiChipButton role="tab" aria-selected={active} active={active} selectionRole="navigation" selectionAppearance="subtle" className="!h-8 max-w-48 truncate text-xs" onClick={() => run(() => switchVideoEditSequence(id, sequence.id))}>{sequence.name}</UiChipButton>
          <UiIconButton size="lg" title={`关闭 ${sequence.name} 标签`} aria-label={`关闭 ${sequence.name} 标签`} disabled={instance.openSequenceIds.length <= 1} onClick={() => run(() => setVideoEditProjectView(id, { openSequenceIds: instance.openSequenceIds.filter(item => item !== sequence.id) }))}>×</UiIconButton>
        </div>
      })}
      <UiButton className="shrink-0" onClick={() => setSettings(instance.document.sequences.find(item => item.id === instance.activeSequenceId)!)}>序列设置</UiButton>
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {settings && <VideoEditSequenceDialog title="序列设置" initial={settings} bins={instance.document.bins} onClose={() => setSettings(null)} onSubmit={values => updateVideoEditSequenceSettings(id, settings.id, values)} />}
  </div>
}
