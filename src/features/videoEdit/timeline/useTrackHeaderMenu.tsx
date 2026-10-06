import { useState } from 'react'
import { ListMinus, ListPlus, Minus, PencilLine, Plus, Settings2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { PanelTrigger } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { VIDEO_EDIT_TRACK_HEADER_BUTTON_DEFAULTS, videoEditTrackHeaderButtons, type VideoEditTrackHeaderKind } from '@/core/videoEdit/trackHeaderButtons'
import { VIDEO_EDIT_TRACK_LIMIT, videoEditTracksOfKind } from '@/core/videoEdit/tracks'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VideoEditInstance } from '../application/videoEditService'
import { addVideoEditTracks, deleteVideoEditTracks, updateVideoEditTrack } from '../application/videoEditTimeline'
import { VideoEditButtonBarEditorPanel } from '../panels/VideoEditButtonBarEditor'
import { VideoEditAddTracksDialog, VideoEditDeleteTracksDialog } from './VideoEditTrackDialogs'
import { videoEditTrackHeaderButtonSpecs } from './VideoEditTrackHeader'

type Dialog = { kind: 'add' | 'delete'; trackKind: VideoEditTrackHeaderKind } | { kind: 'buttons'; trackKind: VideoEditTrackHeaderKind; trackId: string; anchor: Element }

/**
 * PR 轨道头右键菜单：重命名、添加单个轨道、删除单个轨道、添加轨道…、删除轨道…、自定义…（按钮编辑器）。
 * 音频子混合、输出通道分配与画外音录制不做。全部轨道增删走正式领域服务，一次操作一步撤销。
 */
export function useTrackHeaderMenu(instance: VideoEditInstance, sequence: VideoEditSequence, onError: (error: unknown) => void) {
  const menu = useContextMenu()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const layouts = useSettingsStore(state => state.videoEditTrackHeaderButtons)
  const projectId = instance.document.id
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  const show = (event: React.MouseEvent<HTMLElement>, trackId: string): void => {
    const track = sequence.tracks.find(value => value.id === trackId)
    if (!track) return
    event.preventDefault(); event.stopPropagation()
    const anchor = event.currentTarget
    const lanes = videoEditTracksOfKind(sequence, track.kind)
    const rank = lanes.findIndex(value => value.id === trackId)
    const full = sequence.tracks.length >= VIDEO_EDIT_TRACK_LIMIT
    menu.showMenu(event, [
      { id: 'rename', label: '重命名', icon: <PencilLine size={16} />, onClick: () => setRenaming(trackId) },
      // 视频轨加在所点轨道之上，音频轨加在之下（同类自然顺序的下一个位置）。
      { id: 'add_one', label: '添加单个轨道', icon: <Plus size={16} />, disabled: full, onClick: () => run(() => addVideoEditTracks(projectId, sequence.id, [{ kind: track.kind, count: 1, slot: rank + 1 }])) },
      { id: 'delete_one', label: '删除单个轨道', icon: <Minus size={16} />, disabled: lanes.length <= 1 || track.locked, divider: true, onClick: () => run(() => deleteVideoEditTracks(projectId, sequence.id, [trackId])) },
      { id: 'add', label: '添加轨道…', icon: <ListPlus size={16} />, disabled: full, onClick: () => setDialog({ kind: 'add', trackKind: track.kind }) },
      { id: 'delete', label: '删除轨道…', icon: <ListMinus size={16} />, divider: true, onClick: () => setDialog({ kind: 'delete', trackKind: track.kind }) },
      { id: 'customize', label: '自定义…', icon: <Settings2 size={16} />, onClick: () => setDialog({ kind: 'buttons', trackKind: track.kind, trackId, anchor }) },
    ])
  }
  const rename = (trackId: string, name: string | null): void => {
    setRenaming(null)
    const track = sequence.tracks.find(value => value.id === trackId)
    if (name && track && name !== track.name) run(() => updateVideoEditTrack(projectId, sequence.id, trackId, { name }))
  }
  const editorTrack = dialog?.kind === 'buttons' ? sequence.tracks.find(value => value.id === dialog.trackId) : undefined
  const elements = <>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {dialog?.kind === 'add' && <VideoEditAddTracksDialog sequence={sequence} kind={dialog.trackKind} onClose={() => setDialog(null)} onSubmit={requests => { addVideoEditTracks(projectId, sequence.id, requests) }} />}
    {dialog?.kind === 'delete' && <VideoEditDeleteTracksDialog sequence={sequence} kind={dialog.trackKind} targetTrackIds={instance.targetTrackIds} onClose={() => setDialog(null)} onSubmit={ids => deleteVideoEditTracks(projectId, sequence.id, ids)} />}
    {/* PR 的“自定义…”：按钮编辑器贴在所点的轨道头旁，视频轨与音频轨各一栏。 */}
    {dialog?.kind === 'buttons' && editorTrack && <PanelTrigger anchor={dialog.anchor} open onOpenChange={open => { if (!open) setDialog(null) }} panelWidth={300} zIndex={Z_LAYERS.dropdown} panelPadding="content"
      renderPanel={() => <VideoEditButtonBarEditorPanel specs={videoEditTrackHeaderButtonSpecs(editorTrack, instance.targetTrackIds.includes(editorTrack.id), () => undefined, () => undefined)} saved={videoEditTrackHeaderButtons(layouts, dialog.trackKind)} defaults={VIDEO_EDIT_TRACK_HEADER_BUTTON_DEFAULTS[dialog.trackKind]}
        onSave={ids => useSettingsStore.getState().setVideoEditTrackHeaderButtons(dialog.trackKind, ids)} onClose={() => setDialog(null)} />} />}
  </>
  return { show, renaming, rename, startRename: setRenaming, elements }
}
