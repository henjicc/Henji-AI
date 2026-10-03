import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Dropdown, UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiLoading, UiTextAreaField } from '@/components/ui'
import { commitVideoEditCodeCandidate, disposeVideoEditCodeCandidate, prepareVideoEditCodeCandidate, type VideoEditCodeApplyScope, type VideoEditCodeCandidate } from '../application/videoEditCodeCandidates'
import type { VideoEditCodeEditorState } from '../application/videoEditCodeParameters'
import { requireVideoEditInstance } from '../application/videoEditService'
import { videoEditParameterTargetIdentity } from './useCodeParameterGesture'

function CandidatePreview({ candidate, onError }: { candidate: VideoEditCodeCandidate; onError: (reason: unknown) => void }): React.ReactElement {
  const host = useRef<HTMLCanvasElement>(null)
  const errorHandler = useRef(onError); errorHandler.current = onError
  useLayoutEffect(() => {
    const canvas = host.current
    if (!canvas) return
    try {
      const context = canvas.getContext('2d')
      if (!context) throw new Error('候选画面无法显示，请重新检查源码。')
      canvas.width = candidate.bitmap.width; canvas.height = candidate.bitmap.height
      context.drawImage(candidate.bitmap, 0, 0)
    } catch (error) { errorHandler.current(error) }
    return () => { canvas.width = 0; canvas.height = 0 }
  }, [candidate])
  return <canvas ref={host} aria-label="源码候选预览" data-video-edit-code-candidate-preview className="h-auto w-full bg-media object-contain" />
}

function SourceDraft({ editor }: { editor: VideoEditCodeEditorState }): React.ReactElement {
  const owner = requireVideoEditInstance(editor.target.projectId)
  const document = owner.document
  const mounted = useRef(true)
  const pending = useRef<{ controller: AbortController; baseline: typeof document }>()
  const proof = useRef<VideoEditCodeCandidate>()
  const [draft, setDraft] = useState(editor.source)
  const [scope, setScope] = useState<VideoEditCodeApplyScope>('single')
  const [candidate, setCandidate] = useState<VideoEditCodeCandidate>()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const release = useCallback((): void => {
    const job = pending.current; pending.current = undefined
    job?.controller.abort()
    if (proof.current) disposeVideoEditCodeCandidate(proof.current)
    proof.current = undefined
  }, [])
  const invalidate = useCallback((): void => { release(); if (mounted.current) { setCandidate(undefined); setConfirmed(false); setBusy(false) } }, [release])
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; release() }
  }, [release])
  useLayoutEffect(() => {
    if (pending.current && pending.current.baseline !== document) {
      invalidate(); setError('工程内容已改变，请重新检查源码。')
    }
  }, [document, invalidate])
  const changeDraft = (value: string): void => { invalidate(); setDraft(value); setError(null) }
  const check = async (): Promise<void> => {
    invalidate(); setError(null); setBusy(true)
    const job = { controller: new AbortController(), baseline: document }; pending.current = job
    try {
      const result = await prepareVideoEditCodeCandidate(editor.target, draft, scope, job.controller.signal)
      if (!mounted.current || pending.current !== job || job.controller.signal.aborted) { disposeVideoEditCodeCandidate(result); return }
      proof.current = result; setCandidate(result)
    } catch (reason) {
      if (mounted.current && pending.current === job && !job.controller.signal.aborted) setError(reason instanceof Error ? reason.message : '源码检查失败，请修改后重试。')
    } finally { if (mounted.current && pending.current === job) setBusy(false) }
  }
  const commit = (): void => {
    const current = proof.current
    if (!current || (current.impacts.length > 0 && !confirmed)) return
    // The candidate's own publication must not be mistaken for an external invalidation.
    const job = pending.current; pending.current = undefined; proof.current = undefined
    setCandidate(undefined); setConfirmed(false); setError(null)
    try { commitVideoEditCodeCandidate(current, confirmed) } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '源码未能应用，请重新检查。')
    } finally { disposeVideoEditCodeCandidate(current); job?.controller.abort() }
  }
  return <UiGroup gap="row" data-video-edit-code-source-editor={editor.target.clipId}>
    <UiFormRow density="compact" label="源码"><UiTextAreaField aria-label="代码素材源码" className="font-mono" rows={12} value={draft} spellCheck={false} onChange={event => changeDraft(event.target.value)} textHistory={{ onValueChange: changeDraft }} /></UiFormRow>
    <UiFormRow density="compact" label="应用范围"><Dropdown<VideoEditCodeApplyScope> ariaLabel="源码应用范围" value={scope} options={[{ value: 'single', label: '此片段' }, { value: 'matching', label: '相同原版本的所有片段' }]} onSelect={value => { if (value !== scope) { invalidate(); setScope(value); setError(null) } }} /></UiFormRow>
    <div className="flex flex-wrap items-center gap-2">
      <UiButton variant="secondary" disabled={busy} onClick={() => { void check() }}>检查并预览</UiButton>
      <UiButton disabled={draft === editor.source} onClick={() => changeDraft(editor.source)}>恢复当前源码</UiButton>
      {busy && <UiButton onClick={invalidate}>取消检查</UiButton>}
    </div>
    {busy && <UiLoading size="xs" message="正在检查源码并生成预览" />}
    {error && <UiError size="xs" message={error} />}
    {candidate && <UiGroup title="候选画面" gap="row">
      <CandidatePreview candidate={candidate} onError={reason => { invalidate(); setError(reason instanceof Error ? reason.message : '候选画面无法显示。') }} />
      <span className="text-xs text-text3">将应用到 {candidate.clipCount} 个片段</span>
      {candidate.impacts.length > 0 && <UiGroup title="参数与关键帧变化" gap="row">
        {candidate.impacts.map((impact, index) => <div key={index} className="text-xs" data-video-edit-code-migration-impact>
          <div className="text-text1">{impact.sequenceName} · {impact.clipName} · {impact.title}</div>
          <div className="text-text3">{impact.reason}{impact.resetValue ? impact.reason === '参数已删除' ? '；移除原值' : '；恢复默认值' : ''}{impact.removeCurve ? '；移除已有关键帧' : ''}</div>
        </div>)}
        <UiFormRow density="compact" label="确认以上参数与关键帧变化" inline><UiCheckbox aria-label="确认参数与关键帧迁移" checked={confirmed} onCheckedChange={setConfirmed} /></UiFormRow>
      </UiGroup>}
    </UiGroup>}
    <UiButton variant="primary" disabled={!candidate || busy || (candidate.impacts.length > 0 && !confirmed)} onClick={commit}>应用已检查源码</UiButton>
  </UiGroup>
}

export function CodeSourceEditor({ editor }: { editor: VideoEditCodeEditorState }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  return <UiGroup divided titleTone="compact" title={<UiButton size="sm" className="-ml-2" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起源码编辑' : '查看与编辑源码'}</UiButton>}>
    {expanded && <SourceDraft key={videoEditParameterTargetIdentity(editor.target)} editor={editor} />}
  </UiGroup>
}
