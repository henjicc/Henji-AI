import { useState } from 'react'
import { FolderOpen, Search } from 'lucide-react'
import {
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiEmpty,
  UiError,
  UiInput,
  UiLoading,
  UiOptionButton,
  UiPageHeader,
  UiRegion,
} from '@/components/ui'
import type { AudioEditProjectSummary } from '@/core/audioEdit/types'
import { ICON_TOOL_AUDIO_EDIT as AudioEditIcon } from '@/core/theme/icons'

interface AudioEditHomeProps {
  projects: AudioEditProjectSummary[]
  loading: boolean
  loadFailed: boolean
  disabled: boolean
  onBack?: () => void
  onImport: () => void
  onOpen: (id: string) => void
  onRetry: () => void
}

const PAGE_SIZE = 12

export function AudioEditHome({ projects, loading, loadFailed, disabled, onBack, onImport, onOpen, onRetry }: AudioEditHomeProps) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const filtered = projects.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(0, pageCount - 1))
  const hasProjects = projects.length > 0
  const importButton = (
    <UiButton variant="primary" className="shrink-0 gap-2 whitespace-nowrap" disabled={disabled} onClick={onImport}>
      <FolderOpen size={16} aria-hidden="true" />导入音频或视频
    </UiButton>
  )

  return (
    <div className="h-full overflow-y-auto bg-window p-6">
      <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto flex min-h-full flex-col">
        <UiPageHeader
          title="口播剪辑"
          description="用文字和波形剪辑，再交给专业剪辑软件"
          onBack={onBack}
          backLabel="返回工具"
          actions={hasProjects ? importButton : undefined}
        />
        {loading ? (
          <UiLoading message="正在读取工程…" className="flex-1" />
        ) : loadFailed ? (
          <UiError title="暂时无法读取工程" message="请重试以加载已有工程。" onRetry={onRetry} className="flex-1" />
        ) : !hasProjects ? (
          <UiEmpty
            icon={<AudioEditIcon size={40} strokeWidth={1.5} aria-hidden="true" />}
            title="从一段口播开始"
            description="导入音频或视频，压缩停顿、清理语气词，再导出到 Premiere 或达芬奇继续编辑。工程直接引用原素材。"
            action={importButton}
            className="flex-1"
          />
        ) : (
          <section aria-label="口播工程" className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className={UI_TEXT_LABEL_CLASS}>我的工程 <span className={UI_TEXT_META_CLASS}>（{projects.length}）</span></h3>
              <div className="relative w-full sm:w-72">
                <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text2" />
                <UiInput aria-label="搜索工程" placeholder="搜索工程" className="pl-9" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} />
              </div>
            </div>
            {filtered.length === 0 ? (
              <UiEmpty title="没有找到匹配的工程" description="试试其他名称，或清除搜索查看全部工程。" action={<UiButton variant="secondary" onClick={() => { setQuery(''); setPage(0) }}>清除搜索</UiButton>} />
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((item) => {
                  const seconds = Math.max(0, Math.floor(item.durationFrames / Math.max(1, item.sampleRate)))
                  return (
                    <UiOptionButton key={item.id} variant="card" className="min-h-28 min-w-0 flex-col items-start gap-3 p-5 text-left" disabled={disabled} onClick={() => onOpen(item.id)}>
                      <span className={`w-full truncate text-left ${UI_TEXT_LABEL_CLASS}`} title={item.name}>{item.name}</span>
                      <span className={`w-full text-left ${UI_TEXT_META_CLASS}`}>{item.mediaType === 'video' ? '视频' : '音频'} · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · 继续编辑</span>
                    </UiOptionButton>
                  )
                })}
              </div>
            )}
            {pageCount > 1 && (
              <nav aria-label="工程分页" className="mt-6 flex items-center justify-end gap-3">
                <UiButton variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</UiButton>
                <span className={UI_TEXT_META_CLASS}>{currentPage + 1} / {pageCount}</span>
                <UiButton variant="secondary" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</UiButton>
              </nav>
            )}
          </section>
        )}
      </UiRegion>
    </div>
  )
}
