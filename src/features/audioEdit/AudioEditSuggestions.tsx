import { useMemo } from 'react'
import { UiButton } from '@/components/ui'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'

export function AudioEditSuggestions({ project, onSeek, onResolve }: {
  project: AudioEditProjectDocument
  onSeek: (frame: number) => void
  onResolve: (ids: string[], apply: boolean) => void
}) {
  const groups = useMemo(() => {
    const result = new Map<string, { title: string; items: typeof project.suggestions }>()
    const blocks = new Map(project.transcript.map((block) => [block.id, block]))
    for (const suggestion of project.suggestions.filter((item) => item.status === 'pending')) {
      const word = suggestion.blockIds.map((id) => blocks.get(id)?.text ?? '').join('').replace(/[\s，。！？、,.!?]/g, '')
      const title = suggestion.kind === 'filler' ? `语气词「${word || suggestion.title}」` : suggestion.kind === 'long_silence' ? '停顿' : '重复口播'
      const key = `${suggestion.kind}:${title}`
      const group = result.get(key) ?? { title, items: [] }
      group.items.push(suggestion)
      result.set(key, group)
    }
    return [...result.values()]
  }, [project.transcript, project.suggestions])
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  if (!total) return null
  const time = (frame: number) => { const seconds = frame / project.source.sampleRate; return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}` }
  return <details className="space-y-3">
    <summary className="cursor-pointer text-sm text-text-muted">待审建议 · {total} 处</summary>
    <div className="max-h-64 space-y-3 overflow-y-auto">
      {groups.map((group) => <div key={group.title}>
        <div className="flex items-center justify-between gap-2">
          <UiButton variant="plain" size="sm" className="min-w-0 truncate !px-0" onClick={() => onSeek(group.items[0].startFrame)}>{group.title} · {group.items.length}</UiButton>
        </div>
        <div className="flex gap-2">
          <UiButton variant="plain" size="sm" onClick={() => onResolve(group.items.map((item) => item.id), true)}>全部应用</UiButton>
          <UiButton variant="plain" size="sm" onClick={() => onResolve(group.items.map((item) => item.id), false)}>全部忽略</UiButton>
        </div>
        <details><summary className="cursor-pointer text-xs text-text-muted">逐处查看</summary>
          {group.items.map((item) => <div key={item.id} className="flex items-center gap-1 text-xs">
            <UiButton variant="plain" size="sm" className="mr-auto" onClick={() => onSeek(item.startFrame)}>{time(item.startFrame)}</UiButton>
            <UiButton variant="plain" size="sm" onClick={() => onResolve([item.id], true)}>应用</UiButton>
            <UiButton variant="plain" size="sm" onClick={() => onResolve([item.id], false)}>忽略</UiButton>
          </div>)}
        </details>
      </div>)}
    </div>
  </details>
}
