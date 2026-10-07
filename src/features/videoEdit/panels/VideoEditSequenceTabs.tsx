import { VideoEditReframeDialog } from './VideoEditReframeDialog'
import { useState } from 'react'
import { Settings2, Crop, Copy, Trash2, X } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiChipButton, UiIconButton } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { deleteVideoEditSequence, duplicateVideoEditSequence, setVideoEditProjectView, switchVideoEditSequence, updateVideoEditSequenceSettings, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditSequenceDialog } from './VideoEditSequenceDialog'

export function VideoEditSequenceTabs({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  const [settings, setSettings] = useState<VideoEditSequence | null>(null)
  const [reframe, setReframe] = useState<string | null>(null)
  const menu = useContextMenu()
  const id = instance.document.id
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  // 时间线工具栏的左端（界面重设计 3.5）：不再单独占一行；当前序列为中性选中底，关闭按钮只在悬停时出现。
  // 不随工具栏收缩：窄面板下工具栏横向滚动（overflow-x-auto），标签保持完整宽度，不被挤成只剩省略号（5.8 shortTextTruncated）
  return <div className="flex shrink-0 items-center gap-0.5" aria-label="序列标签">
    <div role="tablist" aria-label="已打开序列" className="flex items-center gap-0.5">
      {instance.openSequenceIds.map(sequenceId => {
        const sequence = instance.document.sequences.find(item => item.id === sequenceId)
        if (!sequence) return null
        const active = sequence.id === instance.activeSequenceId
        return <div key={sequence.id} className="group/sequence-tab flex min-w-0 items-center" onContextMenu={event => menu.showMenu(event, [
          { id: 'settings', label: '序列设置', icon: <Settings2 size={16} />, onClick: () => setSettings(sequence) },
          { id: 'auto_reframe', label: '自动重构序列…', icon: <Crop size={16} />, onClick: () => setReframe(sequence.id) },
          { id: 'duplicate', label: '复制序列', icon: <Copy size={16} />, onClick: () => run(() => switchVideoEditSequence(id, duplicateVideoEditSequence(id, sequence.id))) },
          { id: 'delete', label: '移除空序列', icon: <Trash2 size={16} />, disabled: !!sequence.clips.length || !!sequence.annotations.length, onClick: () => run(() => deleteVideoEditSequence(id, sequence.id)) },
        ])}>
          <UiChipButton role="tab" aria-selected={active} active={active} selectionRole="navigation" size="sm" className="max-w-40 shrink-0 truncate" onClick={() => run(() => switchVideoEditSequence(id, sequence.id))}>{sequence.name}</UiChipButton>
          {instance.openSequenceIds.length > 1 && <UiIconButton size="xs" className="opacity-0 transition-opacity duration-120 focus-visible:opacity-100 group-hover/sequence-tab:opacity-100" title={`关闭 ${sequence.name} 标签`} aria-label={`关闭 ${sequence.name} 标签`} onClick={() => run(() => setVideoEditProjectView(id, { openSequenceIds: instance.openSequenceIds.filter(item => item !== sequence.id) }))}><X size={12} /></UiIconButton>}
        </div>
      })}
    </div>
    <UiIconButton disabled={!instance.activeSequenceId} size="sm" aria-label="序列设置" title="序列设置" onClick={() => setSettings(instance.document.sequences.find(item => item.id === instance.activeSequenceId)!)}><Settings2 size={14} /></UiIconButton>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {reframe && <VideoEditReframeDialog target={{ projectId: id, sequenceId: reframe }} onClose={() => setReframe(null)} />}
    {settings && <VideoEditSequenceDialog title="序列设置" saveDefaults={false} initial={settings} bins={instance.document.bins} onClose={() => setSettings(null)} onSubmit={values => updateVideoEditSequenceSettings(id, settings.id, values)} />}
  </div>
}
