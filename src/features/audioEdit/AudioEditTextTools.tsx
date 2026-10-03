import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, X } from 'lucide-react'
import { UiButton, UiIconButton, UiInput, UiModal, UiTextArea } from '@/components/ui'
import type { AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import type { AudioEditTextSearch } from './useAudioEditTextSearch'

export function AudioEditTitle({ name, disabled, onChange }: { name: string; disabled: boolean; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const cancel = () => setEditing(false)
  const save = () => { if (draft.trim()) onChange(draft.trim()); cancel() }
  return editing ? <UiInput autoFocus aria-label="工程名" className="min-w-0 flex-1" value={draft} maxLength={200} disabled={disabled}
    onChange={(event) => setDraft(event.target.value)} onBlur={save}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save() } else if (event.key === 'Escape') { event.preventDefault(); cancel() } }} />
    : <UiButton className="min-w-0 flex-1 justify-start truncate text-left" disabled={disabled} title="双击修改工程名" onDoubleClick={() => { setDraft(name); setEditing(true) }}>{name}</UiButton>
}

export function AudioEditTextEditor({ block, disabled, onSave, onClose }: { block: AudioEditTranscriptBlock; disabled: boolean; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(block.text)
  return <UiModal isOpen onClose={onClose} title="编辑字幕" size="compact">
    <UiTextArea autoFocus aria-label="字幕文字" rows={3} maxLength={20000} value={text} disabled={disabled || block.locked} onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!disabled && !block.locked) onSave(text) } }} />
    <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-text-muted">{block.locked ? '请先解锁再编辑' : '只校正文字，不改变声音'}</span><UiButton variant="primary" disabled={disabled || block.locked} onClick={() => onSave(text)}>保存</UiButton></div>
  </UiModal>
}

export function AudioEditFindReplace({ search, disabled }: { search: AudioEditTextSearch; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [search.focusVersion])
  return <div role="search" aria-label="查找与替换" className="relative ml-auto w-full max-w-2xl shrink-0 space-y-2 py-2 pl-3 pr-12" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); search.close() }
  }}>
    <UiIconButton size="lg" aria-label="关闭查找替换" title="关闭查找替换 · Esc" className="absolute right-3 top-2" onClick={search.close}><X size={16} /></UiIconButton>
    <div className="flex flex-wrap items-center gap-2">
      <UiIconButton size="lg" title={search.showReplace ? '收起替换' : '展开替换'} aria-expanded={search.showReplace} onClick={search.toggleReplace}>{search.showReplace ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</UiIconButton>
      <UiInput ref={inputRef} autoFocus aria-label="查找文字" aria-invalid={Boolean(search.error)} className="min-w-32 max-w-md flex-1" placeholder={search.regex ? '正则表达式' : '查找文字'} value={search.query} onChange={(event) => search.setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search.navigate(event.shiftKey ? -1 : 1) } }} />
      <UiIconButton size="lg" title="使用正则表达式" on={search.regex} onClick={search.toggleRegex}>.*</UiIconButton>
      <span className="text-sm tabular-nums text-text-muted" aria-live="polite">{search.matches.length ? `${search.currentIndex + 1} / ${search.matches.length} 处` : search.query ? '无匹配' : ''}</span>
      <UiIconButton size="lg" title="上一处 · Shift+Enter" disabled={!search.matches.length} onClick={() => search.navigate(-1)}><ArrowUp size={16} /></UiIconButton>
      <UiIconButton size="lg" title="下一处 · Enter" disabled={!search.matches.length} onClick={() => search.navigate(1)}><ArrowDown size={16} /></UiIconButton>
    </div>
    {search.showReplace && <div className="flex flex-wrap items-center gap-2">
      <UiInput aria-label="替换为" className="min-w-32 max-w-md flex-1" placeholder={search.regex ? '替换为（支持 $1 等捕获组）' : '替换为'} value={search.replacement} onChange={(event) => search.setReplacement(event.target.value)} />
      {!search.preview ? <UiButton disabled={!search.matches.length || disabled} onClick={search.startPreview}>预览替换</UiButton> : <>
        <UiButton disabled={disabled || !search.currentCanChange} onClick={() => search.confirm(false)}>确认当前</UiButton>
        <UiButton variant="secondary" disabled={disabled || !search.changeCount} onClick={() => search.confirm(true)}>确认全部 {search.changeCount} 处</UiButton>
        <UiButton onClick={search.cancelPreview}>取消预览</UiButton>
      </>}
    </div>}
    {search.error && <p role="alert" className="text-xs text-warning">{search.error}</p>}
    {(search.message || search.preview) && <p className="text-xs text-text-muted" aria-live="polite">{search.message || `正在预览，确认后才修改文字；声音不变${search.lockedCount ? `，跳过 ${search.lockedCount} 处锁定文字` : ''}`}</p>}
  </div>
}

export function AudioEditMatchedText({ block, search }: { block: AudioEditTranscriptBlock; search: AudioEditTextSearch }) {
  const fragments = search.fragments.get(block.id)
  if (!fragments) return <>{block.text}</>
  return <>{fragments.map((fragment, index) => fragment.matchIndex === undefined ? <span key={index}>{fragment.text}</span> : <span key={index}
    data-audio-search-current={fragment.matchIndex === search.currentIndex ? 'true' : undefined}
    className={fragment.matchIndex === search.currentIndex ? 'bg-warning/30 text-text-dark ring-1 ring-accent' : 'bg-warning/20 text-text-dark'}>
    {fragment.replacement === undefined ? fragment.text : <><del className="text-text-muted">{fragment.text}</del>{fragment.replacement && <ins className="ml-1 bg-accent/20 font-medium text-accent no-underline">{fragment.replacement}</ins>}</>}
  </span>)}</>
}
