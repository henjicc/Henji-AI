import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiError, UiLoading, UiOptionButton, UiOverflowRow, UiTextToken, UI_TEXT_META_CLASS, type UiOverflowRowItem } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { audioEditFillerBlockIds, DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { findTranscriptBlockForPlayback } from '@/core/audioEdit/timeline'
import { videoEditComposition, type VideoEditSequence } from '@/core/videoEdit/document'
import { groupVideoEditTextWords, videoEditTranscriptWords, resolveVideoEditTextRanges, type VideoEditTextSelector, type VideoEditTextWord } from '@/core/videoEdit/textTranscript'
import { editVideoEditText, hasSavedVideoEditText, restoreVideoEditText } from '../application/videoEditTextEditing'
import { findRecoverableSubtitleAudio, readSubtitleJob, runVideoEditSubtitleJob, subscribeSubtitleJobs, subtitleJobsRevision, cancelSubtitleJob } from '../application/videoEditSubtitleJobs'
import { setVideoEditView, subscribeVideoEditView, videoEditViewRevision, switchVideoEditSequence, type VideoEditInstance } from '../application/videoEditService'

export function VideoEditTextPanel({ instance, sequence, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeSubtitleJobs, subtitleJobsRevision)
  const [scope, setScope] = useState<'sequence' | 'selection'>('sequence')
  const [trackId, setTrackId] = useState('')
  const [selection, setSelection] = useState<{ anchor: string; end: string; baseline: VideoEditSequence }>()
  const [pause, setPause] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const drag = useRef(false); const list = useRef<VirtuosoHandle>(null); const pending = useRef<AbortController>()
  const current = useRef({ instance, sequence, onError }); current.current = { instance, sequence, onError }
  const composition = useMemo(() => videoEditComposition(instance.document, sequence.id), [instance.document, sequence.id])
  const all = useMemo(() => videoEditTranscriptWords(composition), [composition])
  const visible = useMemo(() => scope === 'selection' ? all.filter(word => instance.selectedClipIds.includes(word.clipId)) : all, [all, scope, instance.selectedClipIds])
  const groups = useMemo(() => groupVideoEditTextWords(visible, composition.fps), [visible, composition.fps])
  const playbackBlocks = useMemo(() => visible.map(word => ({ ...word, startFrame: word.from, endFrame: word.to })), [visible])
  const activeWord = instance.activeSequenceId === sequence.id ? findTranscriptBlockForPlayback(instance.frame, playbackBlocks, false, composition.fps / 4)?.id : undefined
  const active = groups.findIndex(group => group.some(word => word.id === activeWord))
  useEffect(() => { if (instance.playing && active >= 0 && !drag.current) list.current?.scrollIntoView({ index: active, align: 'center' }) }, [active, instance.playing])
  useEffect(() => { const stop = (): void => { drag.current = false }; window.addEventListener('pointerup', stop); return () => { window.removeEventListener('pointerup', stop); pending.current?.abort() } }, [])
  const report = (reason: unknown): void => { setError(reason instanceof Error ? reason.message : String(reason)); current.current.onError(reason) }
  const ids = selection?.baseline === sequence ? [visible.find(word => word.id === selection.anchor)?.index ?? -1, visible.find(word => word.id === selection.end)?.index ?? -1] : []
  const from = ids.length && ids.every(index => index >= 0) ? Math.min(...ids) : -1; const to = from < 0 ? -1 : Math.max(...ids)
  const wordRanges: Array<{ start: number; end: number }> = []
  for (const word of visible.filter(word => word.index >= from && word.index <= to)) {
    const last = wordRanges.at(-1)
    if (last && last.end + 1 === word.index) last.end = word.index
    else wordRanges.push({ start: word.index, end: word.index })
  }
  const selector: VideoEditTextSelector | undefined = pause ? { kind: 'silence' } : from >= 0 ? { kind: 'words', ranges: wordRanges } : undefined
  const operation = (action: 'delete' | 'extract' | 'insert', selected: VideoEditTextSelector | undefined = selector): void => {
    if (!selected) return
    try {
      setError('')
      const result = editVideoEditText(instance.document.id, sequence.id, selected, action, instance.activeSequenceId === sequence.id ? instance.frame : instance.sequenceViews.get(sequence.id)?.frame ?? 0, undefined, sequence)
      setSelection(undefined); setPause(false)
      if (action === 'extract' && result.changed) switchVideoEditSequence(instance.document.id, result.sequenceId)
      if (!result.changed) setError(selected.kind === 'fillers' ? '没有找到可删除的口头禅。' : '没有找到可删除的静音段，请先检测停顿。')
    } catch (reason) { report(reason) }
  }
  const cleanFillers = (): void => {
    const ids = new Set(audioEditFillerBlockIds(visible, composition.textTranscription?.fillers ?? [...DEFAULT_AUDIO_EDIT_SETTINGS.fillers, '啊', '那个']))
    const ranges = visible.filter(word => ids.has(word.id)).map(word => ({ start: word.index, end: word.index }))
    if (ranges.length) operation('delete', { kind: 'words', ranges })
    else setError('没有找到可删除的口头禅。')
  }
  const prepare = (silence = false, recognize = false): void => {
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller; setBusy(true); setError('')
    const projectId = instance.document.id; const sequenceId = sequence.id
    void (async () => {
      const audioId = recognize ? undefined : sequence.textTranscription?.audioDocumentId ?? readSubtitleJob(instance, sequenceId)?.audioDocumentId ?? await findRecoverableSubtitleAudio(instance, sequenceId, true)
      controller.signal.throwIfAborted()
      if (audioId && await hasSavedVideoEditText(audioId)) await restoreVideoEditText(projectId, sequenceId, audioId, silence, controller.signal)
      else if (silence) throw new Error('请先转录声音，再检测静音。')
      else { controller.signal.throwIfAborted(); await runVideoEditSubtitleJob(instance, sequenceId, scope, trackId || undefined, {}, audioId) }
    })().catch(reason => { if (!controller.signal.aborted) report(reason) }).finally(() => { if (pending.current === controller && !controller.signal.aborted) { setBusy(false); pending.current = undefined } })
  }
  const choose = (word: VideoEditTextWord, extend: boolean): void => {
    setPause(false); setSelection(previous => ({ anchor: extend && previous?.baseline === sequence ? previous.anchor : word.id, end: word.id, baseline: sequence }))
  }
  const job = readSubtitleJob(instance, sequence.id); const recognizing = Boolean(job && ['preparing', 'confirming', 'transcribing'].includes(job.state))
  const disabled = busy || recognizing
  const silences = useMemo(() => resolveVideoEditTextRanges(composition, { kind: 'silence' }), [composition])
  const items: UiOverflowRowItem[] = [
    { id: 'scope', priority: 10, pinned: true, node: <Dropdown ariaLabel="转录稿范围" size="sm" value={scope} onSelect={value => { setScope(value); setSelection(undefined); setPause(false) }} options={[{ value: 'sequence', label: '整个序列' }, { value: 'selection', label: '选中片段' }]} /> },
    { id: 'delete', priority: 10, pinned: true, node: <UiButton size="sm" disabled={disabled || !selector} onClick={() => operation('delete')}>删除</UiButton> },
    { id: 'extract', priority: 2, node: <UiButton size="sm" disabled={disabled || !selector || pause} onClick={() => operation('extract')}>提取到新序列</UiButton> },
    { id: 'insert', priority: 1, node: <UiButton size="sm" disabled={disabled || !selector || pause} onClick={() => operation('insert')}>插入到播放头</UiButton> },
    { id: 'fillers', priority: 0, node: <UiButton size="sm" disabled={disabled || !visible.length} onClick={cleanFillers}>删除口头禅</UiButton> },
    { id: 'silence', priority: 0, node: <UiOptionButton size="sm" active={pause} disabled={disabled || !silences.length || scope !== 'sequence'} onClick={() => { setPause(value => !value); setSelection(undefined) }}>选择全序列静音段</UiOptionButton> },
    { id: 'transcribe', priority: 3, node: <UiButton size="sm" disabled={disabled} onClick={() => prepare()}>{sequence.textTranscription ? '恢复识别稿' : '转录 / 读取已有稿'}</UiButton> },
    { id: 'sound', priority: 0, node: <Dropdown ariaLabel="文本识别声音" size="sm" value={trackId} onSelect={setTrackId} disabled={disabled} options={[{ value: '', label: '可听混音' }, ...sequence.tracks.map(track => ({ value: track.id, label: track.name }))]} /> },
    { id: 'detect', priority: 0, node: <UiButton size="sm" disabled={disabled || !sequence.textTranscription} onClick={() => prepare(true)}>检测静音</UiButton> },
    ...(sequence.textTranscription ? [{ id: 'recognize', priority: 0, node: <UiButton size="sm" disabled={disabled} onClick={() => prepare(false, true)}>重新转录</UiButton> }] : []),
  ]
  return <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" aria-label="基于文本的剪辑" onKeyDown={event => {
    if (['Delete', 'Backspace'].includes(event.key) && selector && !disabled) { event.preventDefault(); event.stopPropagation(); operation('delete') }
    if (event.key === 'Escape') { setSelection(undefined); setPause(false) }
  }}>
    <UiOverflowRow className="shrink-0 gap-1" items={items} renderOverflow={hidden => <PanelTrigger panelWidth={220} zIndex={Z_LAYERS.dropdown} closeOnPanelClick renderPanel={() => <div className="flex flex-col items-start gap-1">{hidden.map(id => <div key={id}>{items.find(item => item.id === id)?.node}</div>)}</div>}>{({ togglePanel, open }) => <UiButton size="sm" aria-label="更多文本剪辑操作" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}>更多</UiButton>}</PanelTrigger>} />
    {error && <UiError message={error} size="xs" />}
    {disabled && <div className="flex items-center gap-1"><UiLoading size="sm" message={recognizing ? '正在转录' : '正在整理'} /><UiButton size="sm" onClick={() => { pending.current?.abort(); pending.current = undefined; setBusy(false); cancelSubtitleJob(instance, sequence.id) }}>取消</UiButton></div>}
    {visible.some(word => word.granularity === 'segment') && <p className={UI_TEXT_META_CLASS}>此稿只有句级时间；逐字删除需要支持词级时间戳的识别模型。</p>}
    {pause && <p className={UI_TEXT_META_CLASS}>已选择 {silences.length} 处检测到的静音，删除会保留自然短停顿。</p>}
    {groups.length ? <Virtuoso ref={list} className="min-h-0 flex-1" data={groups} computeItemKey={(_index, group) => group[0].id} itemContent={(_index, group) => <p className="pb-3 text-sm leading-relaxed">
      {group.map(word => <UiTextToken key={word.id} current={word.id === activeWord} aria-current={word.id === activeWord ? 'true' : undefined} selected={word.index >= from && word.index <= to} flagged={word.locked} aria-label={`跳转到：${word.text}`} disabled={disabled} onPointerDown={event => { if (event.button === 0) { drag.current = true; choose(word, event.shiftKey) } }} onPointerEnter={() => { if (drag.current) setSelection(previous => previous?.baseline === sequence ? { ...previous, end: word.id } : previous) }} onClick={event => {
        if (event.detail === 0) choose(word, event.shiftKey)
        if (instance.activeSequenceId !== sequence.id) switchVideoEditSequence(instance.document.id, sequence.id)
        setVideoEditView(instance.document.id, { frame: word.from, playing: false })
      }}>{word.text}{/[A-Za-z0-9]$/.test(word.text) ? ' ' : ''}</UiTextToken>)}
    </p>} /> : <UiEmpty title="还没有转录稿" description="读取已保存的识别结果，或转录当前序列。拖选词语或按住 Shift 选择范围后可剪辑。" size="sm" />}
  </div>
}
