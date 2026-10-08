import { renameCodeMaterialFile } from '@/core/videoEdit/codeMaterial/fileEdits'
import { Virtuoso } from 'react-virtuoso'
import { codeFilePathSchema, codeMaterialFilesKey, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { CodeMaterialError, type CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { codeElementAtSource } from '@/core/videoEdit/codeElementSelection'
import { selectedVideoEditCodeElement, selectVideoEditCodeElement, videoEditCodeElementFrames } from '../application/videoEditCodeElements'
import { Dropdown, UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiLoading, UiTextAreaField, UiInput, UiOptionButton } from '@/components/ui'
import { commitVideoEditCodeCandidate, disposeVideoEditCodeCandidate, prepareVideoEditCodeCandidate, type VideoEditCodeApplyScope, type VideoEditCodeCandidate } from '../application/videoEditCodeCandidates'
import type { VideoEditCodeEditorState } from '../application/videoEditCodeParameters'
import { requireVideoEditInstance, subscribeVideoEditView, videoEditViewRevision } from '../application/videoEditService'
import { videoEditParameterTargetIdentity } from './useCodeParameterGesture'
import { registerVideoEditCodeSourceOpener } from '../application/videoEditCodeElementEditing'

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
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const owner = requireVideoEditInstance(editor.target.projectId)
  const sourceInput = useRef<HTMLTextAreaElement>(null)
  const document = owner.document
  const mounted = useRef(true)
  const pending = useRef<{ controller: AbortController; baseline: typeof document }>()
  const proof = useRef<VideoEditCodeCandidate>()
  const [draft, setDraft] = useState<CodeMaterialFiles>(editor.files)
  const [activeFile, setActiveFile] = useState(editor.files.entry)
  const [fileAction, setFileAction] = useState<'create' | 'rename'>()
  const [fileName, setFileName] = useState('')
  const [errorSpan, setErrorSpan] = useState<CodeSourceSpan>()
  const unchanged = codeMaterialFilesKey(draft) === codeMaterialFilesKey(editor.files)
  const [scope, setScope] = useState<VideoEditCodeApplyScope>('single')
  const [candidate, setCandidate] = useState<VideoEditCodeCandidate>()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = !editor.target.effectId && unchanged ? selectedVideoEditCodeElement(owner) : undefined
  const span = selected?.entry.clip.id === editor.target.clipId ? selected.element.sourceSpan : undefined
  useLayoutEffect(() => { if (span) setActiveFile(span.file) }, [span, selected?.element.elementId])
  useLayoutEffect(() => {
    const input = sourceInput.current
    const location = errorSpan ?? span
    if (!input || !location) return
    if (activeFile !== location.file) return
    if (input.ownerDocument.activeElement !== input || errorSpan) {
      const lines = input.value.split('\n')
      const start = errorSpan ? lines.slice(0, location.startLine - 1).reduce((offset, line) => offset + line.length + 1, 0) + location.startColumn - 1 : location.start
      input.setSelectionRange(start, errorSpan ? start + Math.max(1, location.endColumn - location.startColumn) : location.end)
    }
    const lineHeight = Number.parseFloat(input.ownerDocument.defaultView!.getComputedStyle(input).lineHeight) || 20
    input.scrollTop = Math.max(0, (location.startLine - 2) * lineHeight)
  }, [span, errorSpan, activeFile, selected?.element.elementId])
  const locateCursor = (): void => {
    if (editor.target.effectId || !unchanged || !sourceInput.current) return
    const entry = videoEditCodeElementFrames(owner).get(editor.target.clipId)
    const element = entry && codeElementAtSource(entry.index, sourceInput.current.selectionStart, activeFile)
    selectVideoEditCodeElement(owner, editor.target.clipId, element?.elementId ?? null)
  }
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
      invalidate(); setError('剪辑内容已改变，请重新检查源码。')
    }
  }, [document, invalidate])
  const changeFiles = (value: CodeMaterialFiles): void => { invalidate(); setDraft(value); setError(null); setErrorSpan(undefined) }
  const changeDraft = (value: string): void => changeFiles({ ...draft, files: { ...draft.files, [activeFile]: value } })
  const submitFile = (): void => {
    const result = codeFilePathSchema.safeParse(fileName)
    if (!result.success) { setError(result.error.issues[0].message); return }
    const path = result.data
    if (Object.prototype.hasOwnProperty.call(draft.files, path)) { setError('此文件已存在，请使用其他名称。'); return }
    try { changeFiles(fileAction === 'rename' ? renameCodeMaterialFile(draft, activeFile, path) : { ...draft, files: { ...draft.files, [path]: '' } }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '文件重命名失败。'); return }
    setActiveFile(path); setFileAction(undefined); setFileName('')
  }
  const check = async (): Promise<void> => {
    invalidate(); setError(null); setErrorSpan(undefined); setBusy(true)
    const job = { controller: new AbortController(), baseline: document }; pending.current = job
    try {
      const result = await prepareVideoEditCodeCandidate(editor.target, draft, scope, job.controller.signal)
      if (!mounted.current || pending.current !== job || job.controller.signal.aborted) { disposeVideoEditCodeCandidate(result); return }
      proof.current = result; setCandidate(result)
    } catch (reason) {
      if (mounted.current && pending.current === job && !job.controller.signal.aborted) { setError(reason instanceof Error ? reason.message : '源码检查失败，请修改后重试。'); if (reason instanceof CodeMaterialError && reason.sourceSpan && draft.files[reason.sourceSpan.file] !== undefined) { setErrorSpan(reason.sourceSpan); setActiveFile(reason.sourceSpan.file) } }
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
    {span && span.file === activeFile && <div aria-label="选中元素源码" className="max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-xs"><mark className="bg-accent/15 text-text1">{draft.files[activeFile].slice(span.start, span.end)}</mark></div>}
    <div role="listbox" aria-label="源码文件" className="max-h-40 overflow-auto">
      {Object.keys(draft.files).length > 50 ? <div className="h-40"><Virtuoso data={Object.keys(draft.files).sort()} itemContent={(_index, path) => <UiOptionButton variant="menu" role="option" active={path === activeFile} aria-selected={path === activeFile} className="w-full" onClick={() => { setActiveFile(path); setErrorSpan(undefined) }}>{path}{path === draft.entry ? ' · 入口' : ''}</UiOptionButton>} /></div> : Object.keys(draft.files).sort().map(path => <UiOptionButton key={path} variant="menu" role="option" active={path === activeFile} aria-selected={path === activeFile} className="w-full" onClick={() => { setActiveFile(path); setErrorSpan(undefined) }}>{path}{path === draft.entry ? ' · 入口' : ''}</UiOptionButton>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <UiButton onClick={() => { setFileAction('create'); setFileName('') }}>新建文件</UiButton>
      <UiButton onClick={() => { setFileAction('rename'); setFileName(activeFile) }}>重命名</UiButton>
      <UiButton variant="danger" disabled={activeFile === draft.entry} onClick={() => { const files = { ...draft.files }; delete files[activeFile]; changeFiles({ ...draft, files }); setActiveFile(draft.entry) }}>删除文件</UiButton>
    </div>
    {fileAction && <UiFormRow density="compact" label={fileAction === 'create' ? '新文件路径' : '新路径'}><div className="flex items-center gap-2"><UiInput aria-label="源码文件路径" value={fileName} onChange={event => setFileName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitFile(); if (event.key === 'Escape') setFileAction(undefined) }} /><UiButton onClick={submitFile}>确定</UiButton><UiButton onClick={() => setFileAction(undefined)}>取消</UiButton></div></UiFormRow>}
    <UiFormRow density="compact" label="源码"><UiTextAreaField ref={sourceInput} aria-label="代码素材源码" className="font-mono" rows={12} wrap="off" value={draft.files[activeFile] ?? ''} spellCheck={false} onClick={locateCursor} onKeyUp={locateCursor} onChange={event => changeDraft(event.target.value)} textHistory={{ onValueChange: changeDraft }} /></UiFormRow>
    <UiFormRow density="compact" label="应用范围"><Dropdown<VideoEditCodeApplyScope> ariaLabel="源码应用范围" value={scope} options={[{ value: 'single', label: '此片段' }, { value: 'matching', label: '相同原版本的所有片段' }]} onSelect={value => { if (value !== scope) { invalidate(); setScope(value); setError(null) } }} /></UiFormRow>
    <div className="flex flex-wrap items-center gap-2">
      <UiButton variant="secondary" disabled={busy} onClick={() => { void check() }}>检查并预览</UiButton>
      <UiButton disabled={unchanged} onClick={() => { changeFiles(editor.files); setActiveFile(editor.files.entry) }}>恢复当前源码</UiButton>
      {busy && <UiButton onClick={invalidate}>取消检查</UiButton>}
    </div>
    {busy && <UiLoading size="xs" message="正在检查源码并生成预览" />}
    {error && <UiError size="xs" align="start" title={error} message="" />}
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
    <UiButton variant="primary" disabled={!candidate || busy || (candidate.impacts.length > 0 && !confirmed)} onClick={commit}>保存为新版本</UiButton>
  </UiGroup>
}

export function CodeSourceEditor({ editor }: { editor: VideoEditCodeEditorState }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => registerVideoEditCodeSourceOpener(editor.target, () => setExpanded(true)), [editor.target])
  return <UiGroup divided titleTone="compact" title={<UiButton size="sm" className="-ml-2" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起源码编辑' : '查看与编辑源码'}</UiButton>}>
    {expanded && <SourceDraft key={videoEditParameterTargetIdentity(editor.target)} editor={editor} />}
  </UiGroup>
}
