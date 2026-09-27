import { useMemo, useState } from 'react'
import { UiButton, UiInput, UiModal, UiTextArea } from '@/components/ui'
import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import { findAudioEditText, replaceAudioEditText } from '@/core/audioEdit/text'
import { editAudioEditProject } from './application/audioEditProjectInstances'

export function AudioEditTitle({ name, disabled, onChange }: { name: string; disabled: boolean; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const cancel = () => setEditing(false)
  const save = () => { if (draft.trim()) onChange(draft.trim()); cancel() }
  return editing ? <UiInput autoFocus aria-label="工程名" className="min-w-0 flex-1" value={draft} maxLength={200} disabled={disabled}
    onChange={(event) => setDraft(event.target.value)} onBlur={save}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save() } else if (event.key === 'Escape') { event.preventDefault(); cancel() } }} />
    : <UiButton variant="plain" className="min-w-0 flex-1 justify-start truncate text-left" disabled={disabled} title="双击修改工程名" onDoubleClick={() => { setDraft(name); setEditing(true) }}>{name}</UiButton>
}

export function AudioEditTextEditor({ block, disabled, onSave, onClose }: { block: AudioEditTranscriptBlock; disabled: boolean; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(block.text)
  return <UiModal isOpen onClose={onClose} title="编辑字幕" size="compact">
    <UiTextArea autoFocus aria-label="字幕文字" rows={3} maxLength={20000} value={text} disabled={disabled || block.locked} onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!disabled && !block.locked) onSave(text) } }} />
    <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-text-muted">{block.locked ? '请先解锁再编辑' : '只校正文字，不改变声音'}</span><UiButton variant="primary" size="sm" disabled={disabled || block.locked} onClick={() => onSave(text)}>保存</UiButton></div>
  </UiModal>
}

export function AudioEditFindReplace({ project, disabled, onSeek, onClose, onError }: {
  project: AudioEditProjectDocument; disabled: boolean; onSeek: (frame: number, ids: string[]) => void; onClose: () => void; onError: (error: unknown) => void
}) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [index, setIndex] = useState(0)
  const [message, setMessage] = useState('')
  const matches = useMemo(() => findAudioEditText(project.transcript, query), [project.transcript, query])
  const current = Math.min(index, Math.max(0, matches.length - 1))
  const navigate = (next: number) => {
    if (!matches.length) return
    const selected = (next + matches.length) % matches.length
    setIndex(selected)
    const match = matches[selected]
    const block = project.transcript.find((entry) => entry.id === match.blockIds[0])
    if (block) onSeek(block.startFrame, match.blockIds)
  }
  const replace = (all: boolean) => {
    try {
      let count = 0
      editAudioEditProject(project.id, (document) => {
        const latest = findAudioEditText(document.transcript, query)
        const targets = (all ? latest : latest.slice(current, current + 1)).filter((match) => !document.transcript.some((block) => block.locked && match.blockIds.includes(block.id)))
        count = targets.length
        return { ...document, transcript: replaceAudioEditText(document.transcript, targets, replacement) }
      })
      setMessage(count ? `已替换 ${count} 处，可撤销` : '没有可替换内容，锁定文字已跳过')
    } catch (error) { onError(error) }
  }
  return <UiModal isOpen onClose={onClose} title="查找与替换" size="compact">
    <div className="space-y-3">
      <UiInput autoFocus aria-label="查找文字" placeholder="查找文字" value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); setMessage('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? current - 1 : current + 1) } }} />
      <div className="flex items-center gap-2 text-sm text-text-muted"><span className="mr-auto">{matches.length ? `${current + 1} / ${matches.length}` : '无匹配'}</span><UiButton variant="plain" size="sm" disabled={!matches.length} onClick={() => navigate(current - 1)}>上一处</UiButton><UiButton variant="plain" size="sm" disabled={!matches.length} onClick={() => navigate(current)}>定位</UiButton><UiButton variant="plain" size="sm" disabled={!matches.length} onClick={() => navigate(current + 1)}>下一处</UiButton></div>
      <UiInput aria-label="替换为" placeholder="替换为" value={replacement} onChange={(event) => setReplacement(event.target.value)} />
      <div className="flex justify-end gap-2"><UiButton variant="plain" size="sm" disabled={disabled || !matches.length} onClick={() => replace(false)}>替换当前</UiButton><UiButton variant="primary" size="sm" disabled={disabled || !matches.length} onClick={() => replace(true)}>全部替换</UiButton></div>
      <p className="text-xs text-text-muted" aria-live="polite">{message || '只替换文字和字幕，声音保持不变；锁定文字会跳过。'}</p>
    </div>
  </UiModal>
}
