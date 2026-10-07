import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { UiEmpty, UiGroup, UiIconButton, UiInput } from '@/components/ui'
import { UI_TEXT_NUMERIC_CLASS, UI_TEXT_SECONDARY_CLASS } from '@/components/ui/styleTokens'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { videoEditClipSpeedReadout } from '@/core/videoEdit/clipSpeedDisplay'
import { updateVideoEditClipProperties } from '../application/videoEditClipProperties'
import { editVideoSequence, getActiveVideoEditSequence, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { CodeParameterPanel } from './CodeParameterPanel'
import { VideoEditGraphicPanel } from './VideoEditGraphicPanel'
import { VideoEditEffectChainPanel } from './VideoEditEffectChainPanel'
import { VideoEditTransitionPanel } from './VideoEditTransitionPanel'
import { selectedVideoEditTransitionId } from '../application/videoEditTransitions'
import { VideoEditClipPropertySections } from './VideoEditClipPropertySections'
import { useVideoEditClipPropertyGesture } from './useVideoEditClipPropertyGesture'
import { VideoEditTextStylePanel } from './VideoEditTextStylePanel'
import { VideoEditBasicSoundPanel } from './VideoEditBasicSoundPanel'

/** 片段名称一行（PR 效果控件顶部的“主要 * 片段名”）：确认是哪个片段，铅笔改名，回车或失焦提交一次。 */
function ClipNameHeader({ clip, onRename }: { clip: VideoEditClip; onRename: (name: string) => void }): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  if (draft !== null) return <UiInput aria-label="片段名称" size="sm" autoFocus value={draft} onChange={event => setDraft(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur() } }}
    onBlur={() => { const next = draft.trim(); setDraft(null); if (cancelled.current) { cancelled.current = false; return } if (next && next !== clip.name) onRename(next) }} />
  return <div className="flex min-h-7 items-center gap-1">
    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text1" title={clip.name} data-video-edit-effects-clip-name>{clip.name}</span>
    <UiIconButton size="xs" aria-label="重命名片段" title="重命名片段" onClick={() => setDraft(clip.name)}><Pencil size={12} /></UiIconButton>
  </div>
}

/**
 * 效果控件（对齐 PR）：片段名 → 片段固有效果（运动 / 不透明度 / 颜色 / 音频，可折叠、逐项重置）→ 代码参数或图形 →
 * 附加效果链 → 过渡 → 标注。时间与轨道读数属于时间线，不在这里重复。
 */
function VideoEditEffectsPanelContent({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const errorHandler = useRef(onError); errorHandler.current = onError
  const reportError = useCallback((reason: unknown): void => errorHandler.current(reason), [])
  const sequence = getActiveVideoEditSequence(instance)
  const selection = instance.selection
  const selected = useMemo(() => sequence.clips.find(clip => clip.id === selection), [sequence, selection])
  const speedReadout = selected ? videoEditClipSpeedReadout(selected) : ''
  const projectId = instance.document.id
  const gesture = useVideoEditClipPropertyGesture(projectId, sequence.id, selected?.id ?? '', reportError)
  const run = (operation: () => unknown): void => { try { operation() } catch (error) { onError(error) } }
  return <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto px-3 py-2.5" aria-label="效果控件" data-video-edit-panel="effects" tabIndex={-1} onMouseDown={event => { if (!(event.target as HTMLElement).closest('button,input,textarea,select,[contenteditable]')) event.currentTarget.focus() }}>
    {selected ? <div className="flex flex-col">
      <ClipNameHeader key={`name:${selected.id}`} clip={selected} onRename={name => run(() => updateVideoEditClipProperties(projectId, sequence.id, selected.id, { name }))} />
      {speedReadout && <div className={`pb-2 ${UI_TEXT_SECONDARY_CLASS} ${UI_TEXT_NUMERIC_CLASS}`} data-video-edit-effects-clip-speed>{speedReadout}</div>}
      <VideoEditClipPropertySections clip={selected} frame={{ ...sequence, playhead: instance.frame }} gesture={gesture} />
      {visible && selected.kind === 'text' && <VideoEditTextStylePanel key={`text-style:${selected.id}`} projectId={projectId} sequenceId={sequence.id} clip={selected} height={sequence.height} onError={reportError} />}
    </div> : selectedVideoEditTransitionId(instance) ? null : <UiEmpty size="sm" title="选择片段以编辑" />}
    {visible && <VideoEditBasicSoundPanel instance={instance} onError={reportError} />}
    {visible && selected?.kind === 'code' && selected.code && <CodeParameterPanel key={JSON.stringify(['source-code', projectId, sequence.id, selected.id])} projectId={projectId} sequenceId={sequence.id} clipId={selected.id} onError={onError} />}
    {visible && selected?.kind === 'graphic' && selected.graphic && <VideoEditGraphicPanel key={JSON.stringify(['graphic', projectId, sequence.id, selected.id])} projectId={projectId} sequenceId={sequence.id} clipId={selected.id} onError={onError} />}
    {visible && selected && <VideoEditEffectChainPanel key={JSON.stringify(['effects', projectId, sequence.id, selected.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
    {visible && <VideoEditTransitionPanel key={JSON.stringify(['transition', projectId, sequence.id])} instance={instance} sequence={sequence} clip={selected} onError={reportError} />}
    {sequence.annotations.length > 0 && <UiGroup title="标注" titleTone="compact" divided>
      {sequence.annotations.map(mark => <div key={mark.id} className="flex items-center gap-1 py-0.5"><UiInput aria-label="编辑标注文字" size="sm" className="min-w-0 flex-1" value={mark.text} onChange={event => run(() => editVideoSequence(projectId, sequence.id, draft => ({ ...draft, annotations: draft.annotations.map(item => item.id === mark.id ? { ...item, text: event.target.value } : item) })))} />
        <UiIconButton tone="danger" aria-label="删除标注" title="删除标注" onClick={() => run(() => editVideoSequence(projectId, sequence.id, draft => ({ ...draft, annotations: draft.annotations.filter(item => item.id !== mark.id) })))}><Trash2 size={14} /></UiIconButton></div>)}
    </UiGroup>}
  </div>
}

export function VideoEditEffectsPanel(props: Parameters<typeof VideoEditEffectsPanelContent>[0]): React.ReactElement {
  return props.instance.activeSequenceId ? <VideoEditEffectsPanelContent {...props} /> : <UiEmpty className="h-full" title="没有序列" />
}
