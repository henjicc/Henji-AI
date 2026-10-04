import { useMemo, useState } from 'react'
import { UI_TEXT_META_CLASS, UiButton, UiOptionButton } from '@/components/ui'
import { AudioEditDisclosure } from './AudioEditDisclosure'
import { audioEditSuggestionStates } from '@/core/audioEdit/edits'
import { normalizeAudioEditFiller } from '@/core/audioEdit/analysis'
import type { AudioEditProjectDocument, AudioEditSuggestion } from '@/core/audioEdit/types'

interface ClueGroup { title: string; items: AudioEditSuggestion[] }

function ClueGroupRows({ group, project, onSeek, onResolve }: {
  group: ClueGroup; project: AudioEditProjectDocument
  onSeek: (frame: number) => void; onResolve: (ids: string[], apply: boolean) => void
}) {
  const [page, setPage] = useState(0)
  const pageSize = 5
  const pages = Math.ceil(group.items.length / pageSize)
  const current = Math.min(page, pages - 1)
  const time = (frame: number) => { const seconds = frame / project.source.sampleRate; return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}` }
  const context = (item: AudioEditSuggestion) => project.transcript
    .filter((block) => block.included && block.endFrame > item.startFrame - project.source.sampleRate * 2 && block.startFrame < item.endFrame + project.source.sampleRate * 2)
    .map((block) => block.text).join('').slice(0, 70)
  return <details>
    <summary className="cursor-pointer text-13 text-text1">{group.title} <span className="text-xs text-text3">· {group.items.length} 处</span></summary>
    <div className="mt-1 flex gap-1">
      <UiButton size="sm" onClick={() => onResolve(group.items.map((item) => item.id), true)}>{group.items[0].kind === 'long_silence' ? '压缩这一组' : '删除这一组'}</UiButton>
      <UiButton size="sm" onClick={() => onResolve(group.items.map((item) => item.id), false)}>隐藏这一组</UiButton>
    </div>
    {group.items.slice(current * pageSize, (current + 1) * pageSize).map((item) => <div key={item.id} className="py-1">
      {/* 可定位的建议列表行（多行文字）：menu 选项，高度随内容 */}
      <UiOptionButton variant="menu" className="w-full" title="定位到这段声音" onClick={() => onSeek(item.startFrame)}>
        <span className="mr-2 shrink-0 font-mono text-xs tabular-nums text-text3">{time(item.startFrame)}</span><span className="line-clamp-2 break-all text-xs text-text1">{context(item) || item.title}</span>
      </UiOptionButton>
      <div className="flex gap-1"><UiButton size="sm" onClick={() => onResolve([item.id], true)}>{item.kind === 'long_silence' ? '压缩' : '删除'}</UiButton><UiButton size="sm" onClick={() => onResolve([item.id], false)}>隐藏</UiButton></div>
    </div>)}
    {pages > 1 && <div className="flex items-center gap-2 text-xs text-text3"><UiButton size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</UiButton><span className="tabular-nums">{current + 1} / {pages}</span><UiButton size="sm" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>下一页</UiButton></div>}
  </details>
}

export function AudioEditSuggestions({ project, onSeek, onResolve }: {
  project: AudioEditProjectDocument
  onSeek: (frame: number) => void
  onResolve: (ids: string[], apply: boolean) => void
}) {
  const groups = useMemo(() => {
    const result = new Map<string, ClueGroup>()
    const blocks = new Map(project.transcript.map((block) => [block.id, block]))
    const states = audioEditSuggestionStates(project)
    for (const suggestion of project.suggestions) {
      if (states.get(suggestion.id) !== 'available') continue
      const word = normalizeAudioEditFiller(suggestion.blockIds.map((id) => blocks.get(id)?.text ?? '').join(''))
      const title = suggestion.kind === 'filler' ? `「${word || suggestion.title}」` : suggestion.kind === 'long_silence' ? '停顿' : '重复片段'
      const group = result.get(title) ?? { title, items: [] }
      group.items.push(suggestion)
      result.set(title, group)
    }
    return [...result.values()]
  }, [project])
  if (!groups.length) return null
  return <AudioEditDisclosure title="剪辑线索" value={`${groups.reduce((total, group) => total + group.items.length, 0)} 处`}>
    <p className={UI_TEXT_META_CLASS}>关键词与音频检测结果，仅供定位；助手会结合全文自行判断。</p>
    <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">{groups.map((group) => <ClueGroupRows key={`${project.id}:${group.title}`} group={group} project={project} onSeek={onSeek} onResolve={onResolve} />)}</div>
  </AudioEditDisclosure>
}
