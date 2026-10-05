import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FolderSearch, PencilLine, Regex, X } from 'lucide-react'
import { PanelTrigger, UiButton, UiIconButton, UiInput, UiModal, UiOptionButton, UiTextArea } from '@/components/ui'
import type { AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import type { AudioEditTextSearch } from './useAudioEditTextSearch'

/**
 * 命令带左端的文件上下文（设计稿 ToolAudioEdit：口播名 ▾）：单击打开文件菜单
 * （重命名、重新定位原素材），双击直接重命名。名称就是文件名；删除在口播列表的右键菜单里（移到回收站）。
 */
export function AudioEditFileMenu({ name, disabled, onRename, onRelink }: {
  name: string
  disabled: boolean
  onRename: (value: string) => void
  onRelink: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const startRename = () => { setDraft(name); setEditing(true) }
  const cancel = () => setEditing(false)
  const save = () => { if (draft.trim() && draft.trim() !== name) onRename(draft.trim()); cancel() }
  if (editing) {
    return <UiInput autoFocus size="sm" aria-label="口播名" className="w-56 min-w-0" value={draft} maxLength={200} disabled={disabled}
      onChange={(event) => setDraft(event.target.value)} onBlur={save}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save() } else if (event.key === 'Escape') { event.preventDefault(); cancel() } }} />
  }
  return (
    <PanelTrigger
      className="min-w-0 max-w-64"
      disabled={disabled}
      panelWidth={200}
      panelPadding="menu"
      closeOnPanelClick
      renderPanel={() => (
        <div role="menu" aria-label="口播" className="flex flex-col gap-0.5">
          <UiOptionButton role="menuitem" variant="menu" size="md" className="w-full gap-2" onClick={startRename}>
            <PencilLine size={14} />重命名
          </UiOptionButton>
          <UiOptionButton role="menuitem" variant="menu" size="md" className="w-full gap-2" onClick={onRelink}>
            <FolderSearch size={14} />重新定位原素材
          </UiOptionButton>
        </div>
      )}
    >
      {({ open, togglePanel }) => (
        <UiButton size="sm" className="min-w-0 max-w-full gap-1" disabled={disabled} aria-haspopup="menu" aria-expanded={open}
          title="口播菜单 · 双击重命名" onClick={togglePanel} onDoubleClick={startRename}>
          <span className="truncate">{name}</span>
          <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-text3" />
        </UiButton>
      )}
    </PanelTrigger>
  )
}

export function AudioEditTextEditor({ block, disabled, onSave, onClose }: { block: AudioEditTranscriptBlock; disabled: boolean; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(block.text)
  return <UiModal isOpen onClose={onClose} title="编辑字幕" size="compact">
    <UiTextArea autoFocus aria-label="字幕文字" rows={3} maxLength={20000} value={text} disabled={disabled || block.locked} onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!disabled && !block.locked) onSave(text) } }} />
    <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-text3">{block.locked ? '请先解锁再编辑' : '只校正文字，不改变声音'}</span><UiButton variant="primary" disabled={disabled || block.locked} onClick={() => onSave(text)}>保存</UiButton></div>
  </UiModal>
}

/** 查找替换：作为命令带的从属带出现（与命令带共用底色与下边框），不再单独占一条带。 */
export function AudioEditFindReplace({ search, disabled }: { search: AudioEditTextSearch; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [search.focusVersion])
  return <div role="search" aria-label="查找与替换" className="flex w-full min-w-0 flex-col gap-1.5" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); search.close() }
  }}>
    <div className="flex flex-wrap items-center gap-1.5">
      <UiIconButton title={search.showReplace ? '收起替换' : '展开替换'} aria-expanded={search.showReplace} onClick={search.toggleReplace}>{search.showReplace ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</UiIconButton>
      <UiInput ref={inputRef} autoFocus size="sm" aria-label="查找文字" aria-invalid={Boolean(search.error)} className="min-w-32 max-w-sm flex-1" placeholder={search.regex ? '正则表达式' : '查找文字'} value={search.query} onChange={(event) => search.setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search.navigate(event.shiftKey ? -1 : 1) } }} />
      <UiIconButton title="使用正则表达式" aria-label="使用正则表达式" on={search.regex} onClick={search.toggleRegex}><Regex size={16} /></UiIconButton>
      <UiIconButton title="上一处 · Shift+Enter" disabled={!search.matches.length} onClick={() => search.navigate(-1)}><ArrowUp size={16} /></UiIconButton>
      <UiIconButton title="下一处 · Enter" disabled={!search.matches.length} onClick={() => search.navigate(1)}><ArrowDown size={16} /></UiIconButton>
      <span className="text-xs tabular-nums text-text3" aria-live="polite">{search.matches.length ? `${search.currentIndex + 1} / ${search.matches.length} 处` : search.query ? '无匹配' : ''}</span>
      {search.error && <span role="alert" className="text-xs text-warning-text">{search.error}</span>}
      {!search.showReplace && search.message && <span className="text-xs text-text3" aria-live="polite">{search.message}</span>}
      <UiIconButton aria-label="关闭查找替换" title="关闭查找替换 · Esc" className="ml-auto" onClick={search.close}><X size={16} /></UiIconButton>
    </div>
    {search.showReplace && <div className="flex flex-wrap items-center gap-1.5">
      {/* 与上一行展开按钮同宽的占位，让两行输入框左缘对齐 */}
      <span aria-hidden="true" className="w-7 shrink-0" />
      <UiInput size="sm" aria-label="替换为" className="min-w-32 max-w-sm flex-1" placeholder={search.regex ? '替换为（支持 $1 等捕获组）' : '替换为'} value={search.replacement} onChange={(event) => search.setReplacement(event.target.value)} />
      {!search.preview ? <UiButton size="sm" disabled={!search.matches.length || disabled} onClick={search.startPreview}>预览替换</UiButton> : <>
        <UiButton size="sm" disabled={disabled || !search.currentCanChange} onClick={() => search.confirm(false)}>确认当前</UiButton>
        <UiButton size="sm" variant="secondary" disabled={disabled || !search.changeCount} onClick={() => search.confirm(true)}>确认全部 {search.changeCount} 处</UiButton>
        <UiButton size="sm" onClick={search.cancelPreview}>取消预览</UiButton>
      </>}
      {(search.message || search.preview) && <span className="text-xs text-text3" aria-live="polite">{search.message || `正在预览，确认后才修改文字；声音不变${search.lockedCount ? `，跳过 ${search.lockedCount} 处锁定文字` : ''}`}</span>}
    </div>}
  </div>
}

export function AudioEditMatchedText({ block, search }: { block: AudioEditTranscriptBlock; search: AudioEditTextSearch }) {
  const fragments = search.fragments.get(block.id)
  if (!fragments) return <>{block.text}</>
  return <>{fragments.map((fragment, index) => fragment.matchIndex === undefined ? <span key={index}>{fragment.text}</span> : <span key={index}
    data-audio-search-current={fragment.matchIndex === search.currentIndex ? 'true' : undefined}
    className={fragment.matchIndex === search.currentIndex ? 'rounded-sm bg-warning-tint text-text1 ring-1 ring-accent-ring' : 'rounded-sm bg-warning-tint text-text1'}>
    {fragment.replacement === undefined ? fragment.text : <><del className="text-text3">{fragment.text}</del>{fragment.replacement && <ins className="ml-1 bg-accent-tint font-medium text-accent-text no-underline">{fragment.replacement}</ins>}</>}
  </span>)}</>
}
