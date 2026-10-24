import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MoreHorizontal, Pencil } from 'lucide-react'
import { PanelTrigger, UiEmpty, UiFieldLayoutContext, UiIconButton, UiInput, UiOptionButton, UiPropertyMenuContext } from '@/components/ui'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { UI_TEXT_NUMERIC_CLASS } from '@/components/ui/styleTokens'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { videoEditClipSpeedReadout } from '@/core/videoEdit/clipSpeedDisplay'
import { updateVideoEditClipProperties } from '../application/videoEditClipProperties'
import { getActiveVideoEditSequence, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { CodeParameterPanel } from './CodeParameterPanel'
import { VideoEditGraphicPanel } from './VideoEditGraphicPanel'
import { VideoEditEffectChainPanel } from './VideoEditEffectChainPanel'
import { VideoEditTransitionPanel } from './VideoEditTransitionPanel'
import { selectedVideoEditTransitionId } from '../application/videoEditTransitions'
import { VideoEditClipPropertySections } from './VideoEditClipPropertySections'
import { useVideoEditClipPropertyGesture } from './useVideoEditClipPropertyGesture'
import { VideoEditTextStylePanel } from './VideoEditTextStylePanel'
import { VideoEditBasicSoundPanel } from './VideoEditBasicSoundPanel'
import { VideoEditCodeElementsPanel } from './VideoEditCodeElementsPanel'
import { VideoEditRecordingPanel } from './VideoEditRecordingPanel'
import { VideoEditTimeRemapPanel } from './VideoEditTimeRemapPanel'

/**
 * 片段名一行（重要记录 019）：确认是哪个片段；变过速时跟一个速度读数。改名在“更多”菜单里（或双击名称），回车或失焦提交一次。
 */
function ClipNameHeader({ clip, speed, onRename }: { clip: VideoEditClip; speed: string; onRename: (name: string) => void }): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  if (draft !== null) return <div className="flex h-band-title shrink-0 items-center px-3"><UiInput aria-label="片段名称" size="sm" autoFocus value={draft} onChange={event => setDraft(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur() } }}
    onBlur={() => { const next = draft.trim(); setDraft(null); if (cancelled.current) { cancelled.current = false; return } if (next && next !== clip.name) onRename(next) }} /></div>
  return <div className="flex h-band-title shrink-0 items-center gap-1 pl-3 pr-2">
    <span className="min-w-0 flex-1 truncate text-13 font-semibold text-text1" title={clip.name} data-video-edit-effects-clip-name onDoubleClick={() => setDraft(clip.name)}>{clip.name}</span>
    {speed && <span className={`shrink-0 text-xs text-text3 ${UI_TEXT_NUMERIC_CLASS}`} data-video-edit-effects-clip-speed>{speed}</span>}
    <PanelTrigger panelSize="menu" zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" alignment="bottomRight" renderPanel={() => <div className="flex flex-col gap-1" role="menu" aria-label="片段操作">
      <UiOptionButton role="menuitem" variant="menu" size="sm" className="gap-2" onClick={() => setDraft(clip.name)}><Pencil size={UI_ICON_SIZE.sm} />重命名片段</UiOptionButton>
    </div>}>
      {({ open, togglePanel }) => <UiIconButton size="xs" aria-label="更多片段操作" tooltip="更多片段操作" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><MoreHorizontal /></UiIconButton>}
    </PanelTrigger>
  </div>
}

/**
 * 效果控件（重要记录 019，对齐 AE / PR）：片段名一行 → 片段固有效果（运动 / 不透明度 / 音频，每节 fx 开关、可折叠）→
 * 代码参数或图形 → 附加效果（直接一节一节列出，没有“附加效果”这个大标题）→ 过渡。每行四列：箭头 / 秒表 / 名称 / 右对齐的数值，
 * 重置在名称的右键菜单。添加、复制效果在右下角底栏。批注在批注面板里看，这里不重复。
 */
function VideoEditEffectsPanelContent({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const errorHandler = useRef(onError); errorHandler.current = onError
  const reportError = useCallback((reason: unknown): void => errorHandler.current(reason), [])
  const menu = useContextMenu()
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const sequence = getActiveVideoEditSequence(instance)
  const selection = instance.selection
  const selected = useMemo(() => sequence.clips.find(clip => clip.id === selection), [sequence, selection])
  const projectId = instance.document.id
  const gesture = useVideoEditClipPropertyGesture(projectId, sequence.id, selected?.id ?? '', reportError)
  const run = (operation: () => unknown): void => { try { operation() } catch (error) { onError(error) } }
  return <UiFieldLayoutContext.Provider value="property"><UiPropertyMenuContext.Provider value={menu.showMenu}>
    <div className="flex h-full min-h-0 flex-col" aria-label="效果控件" data-video-edit-panel="effects" tabIndex={-1} onMouseDown={event => { if (!(event.target as HTMLElement).closest('button,input,textarea,select,[contenteditable]')) event.currentTarget.focus() }}>
      <div className="min-h-0 flex-1 overflow-auto pb-3">
        {selected ? <>
          <ClipNameHeader key={`name:${selected.id}`} clip={selected} speed={videoEditClipSpeedReadout(selected)} onRename={name => run(() => updateVideoEditClipProperties(projectId, sequence.id, selected.id, { name }))} />
          <VideoEditClipPropertySections clip={selected} frame={{ ...sequence, playhead: instance.frame }} gesture={gesture} />
          {visible && selected.kind === 'text' && <VideoEditTextStylePanel key={`text-style:${selected.id}`} projectId={projectId} sequenceId={sequence.id} clip={selected} height={sequence.height} onError={reportError} />}
        </> : selectedVideoEditTransitionId(instance) ? null : <UiEmpty size="sm" title="选择片段以编辑" />}
        {visible && <VideoEditBasicSoundPanel instance={instance} onError={reportError} />}
        {visible && selected?.kind === 'code' && selected.code && <CodeParameterPanel key={JSON.stringify(['source-code', projectId, sequence.id, selected.id])} projectId={projectId} sequenceId={sequence.id} clipId={selected.id} onError={onError} />}
        {visible && selected?.kind === 'code' && selected.code && <VideoEditCodeElementsPanel instance={instance} clipId={selected.id} onError={reportError} />}
        {visible && selected?.kind === 'graphic' && selected.graphic && <VideoEditGraphicPanel key={JSON.stringify(['graphic', projectId, sequence.id, selected.id])} projectId={projectId} sequenceId={sequence.id} clipId={selected.id} onError={onError} />}
        {visible && selected && <VideoEditRecordingPanel key={JSON.stringify(['recording', projectId, sequence.id, selected.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
        {visible && selected && <VideoEditTimeRemapPanel key={JSON.stringify(['time-remap', projectId, sequence.id, selected.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
        {visible && selected && <VideoEditEffectChainPanel key={JSON.stringify(['effects', projectId, sequence.id, selected.id])} instance={instance} sequence={sequence} clip={selected} footer={footer} onError={reportError} />}
        {visible && <VideoEditTransitionPanel key={JSON.stringify(['transition', projectId, sequence.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
      </div>
      <div ref={setFooter} className="shrink-0" data-video-edit-effects-footer />
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} onClose={menu.hideMenu} visible={menu.menuVisible} />
  </UiPropertyMenuContext.Provider></UiFieldLayoutContext.Provider>
}

export function VideoEditEffectsPanel(props: Parameters<typeof VideoEditEffectsPanelContent>[0]): React.ReactElement {
  return props.instance.activeSequenceId ? <VideoEditEffectsPanelContent {...props} /> : <UiEmpty className="h-full" title="没有序列" />
}
