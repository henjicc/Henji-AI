import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Dropdown, UiButton, UiChipButton, UiEmpty, UiError, UiGroup, UiInput, UiOptionButton, UiTextAreaField } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditCaption, VideoEditMarker } from '@/core/videoEdit/timedContent'
import { createVideoEditCaption, createVideoEditMarker, exportVideoEditSubtitles, importVideoEditCaptionFile, removeVideoEditTimedContent, updateVideoEditTimedContent } from '../application/videoEditTimedContent'
import { listVideoEditInstances, requireVideoEditInstance, setVideoEditView, subscribeVideoEditDomain, switchVideoEditSequence, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'

interface PanelProps { instance: VideoEditInstance; sequenceId?: string; visible?: boolean; onError: (reason: unknown) => void }
type Kind = 'caption' | 'marker'
type Entry = { kind: 'caption'; value: VideoEditCaption } | { kind: 'marker'; value: VideoEditMarker }
interface Draft { kind: Kind | 'import'; id?: string; baseline?: string; text: string; start: number; duration: number; clipId: string }
const atFrame = (entry: Entry): number => entry.kind === 'caption' ? entry.value.start : entry.value.frame
const entryText = (entry: Entry): string => entry.kind === 'caption' ? entry.value.text : entry.value.name

/** The existing dropdown owns the popup; only the business choices are virtualized. */
function ContentAnchor({ clips, value, disabled, onChange }: { clips: VideoEditClip[]; value: string; disabled: boolean; onChange: (clipId: string) => void }): React.ReactElement {
  const [search, setSearch] = useState('')
  const choices = useMemo(() => clips.filter(clip => clip.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [clips, search])
  const selected = clips.find(clip => clip.id === value)
  return <Dropdown key={value} ariaLabel="内容锚定" display={value ? selected?.name ?? '所属片段已移除' : '序列时钟'} disabled={disabled} renderPanel={() => <div className="flex h-64 min-w-48 flex-col gap-2 p-2">
    <UiInput aria-label="搜索锚定片段" placeholder="搜索片段" value={search} onChange={event => setSearch(event.target.value)} />
    <UiOptionButton variant="menu" active={!value} className="w-full" onClick={() => onChange('')}>序列时钟</UiOptionButton>
    <Virtuoso className="min-h-0 flex-1" data={choices} fixedItemHeight={38} computeItemKey={(_index, clip) => clip.id} itemContent={(_index, clip) => <UiOptionButton variant="menu" active={value === clip.id} size="sm" className="w-full min-w-0 !py-2" aria-label={`锚定片段：${clip.name}`} onClick={() => onChange(clip.id)}><span className="truncate">{clip.name}</span></UiOptionButton>} />
  </div>} />
}

function ContentWorkspace({ instance, sequence, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; onError: (reason: unknown) => void }): React.ReactElement {
  const projectId = instance.document.id
  const [kind, setKind] = useState<Kind>('caption')
  const [keyword, setKeyword] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController>()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(new Error('字幕面板已切换或关闭。')) } }, [])
  const clips = useMemo(() => new Map(sequence.clips.map(clip => [clip.id, clip])), [sequence.clips])
  const entries = useMemo<Entry[]>(() => {
    const values: Entry[] = kind === 'caption' ? (sequence.captions ?? []).map(value => ({ kind: 'caption', value })) : (sequence.markers ?? []).map(value => ({ kind: 'marker', value }))
    const search = keyword.toLocaleLowerCase()
    return values.filter(entry => `${entryText(entry)} ${clips.get(entry.value.clipId ?? '')?.name ?? ''}`.toLocaleLowerCase().includes(search)).sort((left, right) => atFrame(left) - atFrame(right) || left.value.id.localeCompare(right.value.id))
  }, [sequence.captions, sequence.markers, kind, keyword, clips])
  const maxFrame = Math.floor(sequence.frameRate.numerator / sequence.frameRate.denominator * 1800)
  const currentSequence = (): VideoEditSequence => {
    if (!mounted.current || requireVideoEditInstance(projectId) !== instance) throw new Error('原工程已关闭，请重新选择字幕或标记。')
    const current = instance.document.sequences.find(value => value.id === sequence.id)
    if (!current) throw new Error('原序列已移除，请重新选择。')
    return current
  }
  const report = (reason: unknown): void => { if (mounted.current) { setError(reason instanceof Error ? reason.message : String(reason)); onError(reason) } }
  const run = (operation: () => void): void => { try { setError(''); currentSequence(); operation() } catch (reason) { report(reason) } }
  const cancel = (): void => { pending.current?.abort(new Error('已取消字幕操作。')); pending.current = undefined; setBusy(false); setDraft(null); setError('') }
  const freshDraft = (mode: Kind | 'import'): Draft => {
    const clip = mode === 'import' ? undefined : clips.get(instance.selection ?? '')
    const start = mode === 'import' ? 0 : Math.max(clip?.start ?? 0, Math.min((clip ? clip.start + clip.duration : maxFrame) - 1, instance.frame))
    return { kind: mode, text: '', start, duration: Math.max(1, Math.min(Math.round(sequence.frameRate.numerator / sequence.frameRate.denominator * 2), (clip ? clip.start + clip.duration : maxFrame) - start)), clipId: clip?.id ?? '' }
  }
  const openEntry = (entry: Entry): void => { setError(''); setSelectedId(entry.value.id); setDraft({ kind: entry.kind, id: entry.value.id, baseline: JSON.stringify(entry.value), text: entryText(entry), start: atFrame(entry), duration: entry.kind === 'caption' ? entry.value.duration : 1, clipId: entry.value.clipId ?? '' }) }
  const locate = (entry: Entry): void => run(() => {
    const current = currentSequence(); const values = entry.kind === 'caption' ? current.captions : current.markers
    const value = values?.find(value => value.id === entry.value.id)
    if (!value) throw new Error('此字幕或标记已移除，请重新选择。')
    if (instance.activeSequenceId !== current.id) switchVideoEditSequence(projectId, current.id)
    setVideoEditView(projectId, { frame: 'start' in value ? value.start : value.frame, playing: false })
  })
  const changeAnchor = (clipId: string): void => setDraft(previous => {
    if (!previous) return previous
    const clip = clips.get(clipId)
    if (previous.kind === 'import') return { ...previous, clipId }
    const start = Math.max(clip?.start ?? 0, Math.min((clip ? clip.start + clip.duration : maxFrame) - 1, previous.start))
    return { ...previous, clipId, start, duration: Math.max(1, Math.min(previous.duration, (clip ? clip.start + clip.duration : maxFrame) - start)) }
  })
  const saveDraft = (): void => run(() => {
    if (!draft || draft.kind === 'import') return
    const current = currentSequence()
    if (draft.id) {
      const value = (draft.kind === 'caption' ? current.captions : current.markers)?.find(value => value.id === draft.id)
      if (!value || JSON.stringify(value) !== draft.baseline) throw new Error('此字幕或标记已有新修改，请重新选择后编辑。')
    }
    const anchor = draft.clipId ? { clipId: draft.clipId } : { clipId: undefined }
    let id = draft.id
    if (draft.kind === 'caption') {
      const values = { ...anchor, start: draft.start, duration: draft.duration, text: draft.text }
      if (id) updateVideoEditTimedContent(projectId, sequence.id, 'caption', id, values)
      else id = createVideoEditCaption(projectId, sequence.id, values)
    } else {
      const values = { ...anchor, frame: draft.start, name: draft.text }
      if (id) updateVideoEditTimedContent(projectId, sequence.id, 'marker', id, values)
      else id = createVideoEditMarker(projectId, sequence.id, values)
    }
    setSelectedId(id ?? ''); setDraft(null)
  })
  const removeDraft = (): void => run(() => { if (draft?.id && draft.kind !== 'import') { removeVideoEditTimedContent(projectId, sequence.id, draft.kind, [draft.id]); setDraft(null); setSelectedId('') } })
  const asyncFile = (operation: (signal: AbortSignal) => Promise<unknown>): void => {
    try { currentSequence() } catch (reason) { report(reason); return }
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller; setBusy(true); setError('')
    void operation(controller.signal).then(() => { if (mounted.current && !controller.signal.aborted) setDraft(null) }, reason => { if (!controller.signal.aborted) report(reason) }).finally(() => { if (mounted.current && pending.current === controller) { pending.current = undefined; setBusy(false) } })
  }
  const selected = entries.find(entry => entry.value.id === selectedId)
  const count = kind === 'caption' ? sequence.captions?.length ?? 0 : sequence.markers?.length ?? 0
  return <div className="flex h-full min-h-0 flex-col overflow-hidden" aria-label="字幕与标记" data-video-edit-timed-content-sequence={sequence.id} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel() } }}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-2 py-2">
      <UiChipButton selectionRole="navigation" active={kind === 'caption'} disabled={busy} onClick={() => { setKind('caption'); setDraft(null); setSelectedId(''); setError('') }}>字幕</UiChipButton>
      <UiChipButton selectionRole="navigation" active={kind === 'marker'} disabled={busy} onClick={() => { setKind('marker'); setDraft(null); setSelectedId(''); setError('') }}>标记</UiChipButton>
      <UiButton disabled={busy || count >= 500} onClick={() => { setDraft(freshDraft(kind)); setError('') }}>{kind === 'caption' ? '新增字幕' : '新增标记'}</UiButton>
      {kind === 'caption' && <>
        <UiButton disabled={busy || count >= 500} onClick={() => { setDraft(freshDraft('import')); setError('') }}>导入字幕</UiButton>
        <Dropdown ariaLabel="导出字幕格式" display="导出字幕" disabled={busy || !sequence.captions?.length} appearance="text" options={[{ label: '导出 SRT', value: 'srt' }, { label: '导出 WebVTT', value: 'vtt' }]} onSelect={format => asyncFile(signal => exportVideoEditSubtitles(projectId, format as 'srt' | 'vtt', sequence.id, signal))} />
      </>}
      <UiInput aria-label="搜索字幕或标记" placeholder="搜索文字或片段" className="min-w-24 flex-1" value={keyword} onChange={event => setKeyword(event.target.value)} />
    </div>
    <div className="min-h-0 flex-1 px-2" aria-label={kind === 'caption' ? '字幕列表' : '标记列表'}>
      {entries.length ? <Virtuoso className="h-full" data={entries} fixedItemHeight={56} increaseViewportBy={96} computeItemKey={(_index, entry) => entry.value.id} itemContent={(_index, entry) => <UiOptionButton variant="menu" active={selectedId === entry.value.id} disabled={busy} className="w-full min-w-0 flex-col !items-start !px-2 !py-2" aria-label={`${entry.kind === 'caption' ? '字幕' : '标记'}：${entryText(entry)}`} data-video-edit-timed-entry={entry.value.id} data-entry-kind={entry.kind}
        onClick={() => openEntry(entry)} onDoubleClick={() => locate(entry)}>
        <span className="block w-full truncate text-sm" data-observation-sensitive>{entryText(entry)}</span>
        <span className={`${UI_TEXT_META_CLASS} block w-full truncate`}>第 {atFrame(entry)} 帧{entry.kind === 'caption' ? ` · ${entry.value.duration} 帧` : ''} · {clips.get(entry.value.clipId ?? '')?.name ?? '序列时钟'}</span>
      </UiOptionButton>} /> : <UiEmpty title={keyword ? '没有匹配内容' : kind === 'caption' ? '尚无字幕' : '尚无时间标记'} description={keyword ? undefined : kind === 'caption' ? '新增文字，或导入 SRT / WebVTT 字幕。' : '在需要定位的时刻新增标记。'} size="sm" />}
    </div>
    {error && <UiError message={error} size="sm" />}
    {draft && <UiGroup divided className="max-h-[65%] shrink-0 overflow-auto px-2 pb-2" title={draft.kind === 'import' ? '导入字幕' : `${draft.id ? '编辑' : '新增'}${draft.kind === 'caption' ? '字幕' : '标记'}`}>
      <div className="flex flex-col gap-2">
        <ContentAnchor clips={sequence.clips} value={draft.clipId} disabled={busy} onChange={changeAnchor} />
        {draft.kind === 'import' ? <>
          <NumberInput label="节目偏移（帧）" ariaLabel="节目偏移（帧）" value={draft.start} step={1} precision={0} min={-maxFrame} max={maxFrame - 1} widthClassName="w-full" disabled={busy} commitOnChange onChange={start => setDraft({ ...draft, start: Math.round(start) })} />
          <p className={UI_TEXT_META_CLASS}>字幕时间按节目时钟加上偏移；锚定片段时，字幕须落在该片段范围内。</p>
        </> : <>
          <label className={UI_TEXT_LABEL_CLASS}>{draft.kind === 'caption' ? '字幕文字' : '标记名称'}<UiTextAreaField aria-label={draft.kind === 'caption' ? '字幕文字' : '标记名称'} value={draft.text} rows={draft.kind === 'caption' ? 3 : 1} maxLength={draft.kind === 'caption' ? 2000 : 200} disabled={busy} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label={draft.kind === 'caption' ? '开始帧' : '标记帧'} ariaLabel={draft.kind === 'caption' ? '开始帧' : '标记帧'} value={draft.start} min={0} max={maxFrame - 1} step={1} precision={0} widthClassName="w-full" disabled={busy} commitOnChange onChange={start => setDraft({ ...draft, start: Math.round(start) })} />
            {draft.kind === 'caption' && <NumberInput label="时长（帧）" ariaLabel="时长（帧）" value={draft.duration} min={1} max={maxFrame} step={1} precision={0} widthClassName="w-full" disabled={busy} commitOnChange onChange={duration => setDraft({ ...draft, duration: Math.round(duration) })} />}
          </div>
        </>}
        <div className="flex flex-wrap items-center gap-2">
          <UiButton variant="primary" disabled={busy || draft.kind !== 'import' && !draft.text.trim()} onClick={() => draft.kind === 'import' ? asyncFile(signal => importVideoEditCaptionFile(projectId, sequence.id, { offset: draft.start, ...(draft.clipId ? { clipId: draft.clipId } : {}) }, signal)) : saveDraft()}>{draft.kind === 'import' ? busy ? '正在导入…' : '选择字幕文件' : draft.id ? '保存修改' : '添加'}</UiButton>
          {selected && draft.id && <UiButton disabled={busy} onClick={() => locate(selected)}>定位</UiButton>}
          {draft.id && <UiButton disabled={busy} onClick={removeDraft}>删除</UiButton>}
          <UiButton onClick={cancel}>取消</UiButton>
        </div>
      </div>
    </UiGroup>}
    {busy && !draft && <UiButton className="mx-2 mb-2" onClick={cancel}>取消文件操作</UiButton>}
  </div>
}

function Panel({ instance, sequenceId, visible = true, onError }: PanelProps): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const ownerKey = useMemo(() => `${instance.document.id}:${crypto.randomUUID()}`, [instance])
  if (!visible || !listVideoEditInstances().includes(instance)) return null
  const sequence = instance.document.sequences.find(value => value.id === (sequenceId ?? instance.activeSequenceId))
  return sequence ? <ContentWorkspace key={`${ownerKey}:${sequence.id}`} instance={instance} sequence={sequence} onError={onError} /> : <UiEmpty title="原序列已移除" />
}

// Program frame observations mutate the instance but do not rebuild this list.
export const VideoEditTimedContentPanel = memo(Panel)
