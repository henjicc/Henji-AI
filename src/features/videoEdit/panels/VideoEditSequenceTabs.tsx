import { UI_ICON_SIZE } from '@/core/theme/icons'
import { VideoEditReframeDialog } from './VideoEditReframeDialog'
import { useState } from 'react'
import { Settings2, Crop, Copy, Trash2, X } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiChipButton, UiIconButton } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { deleteVideoEditSequence, duplicateVideoEditSequence, setVideoEditProjectView, switchVideoEditSequence, updateVideoEditSequenceSettings, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditSequenceDialog } from './VideoEditSequenceDialog'

/**
 * 已打开的序列标签。`dock`：放在时间线面板的标签上（面板名即序列名，PR 的做法），只有名称和悬停出现的关闭；
 * `toolbar`：只剩“序列设置”按钮，放在时间线左上角的开关格里。两处共用右键菜单与对话框。
 */
export function VideoEditSequenceTabs({ instance, onError, placement = 'toolbar' }: { instance: VideoEditInstance; onError: (error: unknown) => void; placement?: 'dock' | 'toolbar' }): React.ReactElement {
  const [settings, setSettings] = useState<VideoEditSequence | null>(null)
  const [reframe, setReframe] = useState<string | null>(null)
  const menu = useContextMenu()
  const id = instance.document.id
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  const dialogs = <>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {reframe && <VideoEditReframeDialog target={{ projectId: id, sequenceId: reframe }} onClose={() => setReframe(null)} />}
    {settings && <VideoEditSequenceDialog title="序列设置" mode="edit" initial={settings} bins={instance.document.bins} onClose={() => setSettings(null)} onSubmit={values => updateVideoEditSequenceSettings(id, settings.id, values)} />}
  </>
  if (placement === 'toolbar') return <>
    <UiIconButton disabled={!instance.activeSequenceId} size="xs" aria-label="序列设置" tooltip="序列设置" onClick={() => setSettings(instance.document.sequences.find(item => item.id === instance.activeSequenceId)!)}><Settings2  /></UiIconButton>
    {dialogs}
  </>
  // 面板标签里：标签本身的选中线已表示“这是当前面板”，序列之间只用文字明暗区分当前序列；关闭按钮悬停出现。
  return <div className="flex min-w-0 items-center gap-0.5" aria-label="序列标签">
    <div role="tablist" aria-label="已打开序列" className="flex min-w-0 items-center gap-0.5">
      {instance.openSequenceIds.map(sequenceId => {
        const sequence = instance.document.sequences.find(item => item.id === sequenceId)
        if (!sequence) return null
        const active = sequence.id === instance.activeSequenceId
        const contextMenu = (event: React.MouseEvent): void => menu.showMenu(event, [
          { id: 'settings', label: '序列设置', icon: <Settings2 size={UI_ICON_SIZE.md} />, onClick: () => setSettings(sequence) },
          { id: 'auto_reframe', label: '自动重构序列…', icon: <Crop size={UI_ICON_SIZE.md} />, onClick: () => setReframe(sequence.id) },
          { id: 'duplicate', label: '复制序列', icon: <Copy size={UI_ICON_SIZE.md} />, onClick: () => run(() => switchVideoEditSequence(id, duplicateVideoEditSequence(id, sequence.id))) },
          { id: 'delete', label: '移除空序列', icon: <Trash2 size={UI_ICON_SIZE.md} />, disabled: !!sequence.clips.length || !!sequence.annotations.length, onClick: () => run(() => deleteVideoEditSequence(id, sequence.id)) },
        ])
        // 只开了一条序列时就是面板名，不画成可切换的标签。
        if (instance.openSequenceIds.length === 1) return <span key={sequence.id} role="tab" aria-selected="true" className="max-w-56 truncate" onContextMenu={contextMenu}>{sequence.name}</span>
        return <div key={sequence.id} className="group/sequence-tab flex min-w-0 items-center" onContextMenu={contextMenu}>
          <UiChipButton role="tab" aria-selected={active} active={active} selectionRole="navigation" selectionAppearance="subtle" size="sm" className="max-w-48 truncate" onClick={() => run(() => switchVideoEditSequence(id, sequence.id))}>{sequence.name}</UiChipButton>
          {instance.openSequenceIds.length > 1 && <UiIconButton size="2xs" className="opacity-0 transition-opacity duration-120 focus-visible:opacity-100 group-hover/sequence-tab:opacity-100" tooltip={`关闭 ${sequence.name} 标签`} aria-label={`关闭 ${sequence.name} 标签`} onClick={() => run(() => setVideoEditProjectView(id, { openSequenceIds: instance.openSequenceIds.filter(item => item !== sequence.id) }))}><X  /></UiIconButton>}
        </div>
      })}
    </div>
    {dialogs}
  </div>
}
