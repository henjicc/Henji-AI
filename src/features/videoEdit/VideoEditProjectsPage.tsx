import { FolderOpen } from 'lucide-react'
import type { ProjectCardGridItem } from '@/components/ProjectCardGrid'
import { ProjectLibraryPage, type ProjectLibraryLabels } from '@/components/ProjectLibraryPage'
import { ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'

/**
 * 剪辑项目页的一项。数据来源与界面解耦：现在由“本次已打开的项目”提供，
 * 2.2 换成持久化的最近项目列表时只换来源，不改这一页（`missing` 给文件被移走或删除的最近项）。
 */
export interface VideoEditProjectEntry {
  id: string
  name: string
  /** 项目文件位置，作为卡片元信息显示，便于区分同名项目 */
  path: string
  missing?: boolean
  updatedAt?: number
  coverPath?: string | null
}

interface VideoEditProjectsPageProps {
  projects: VideoEditProjectEntry[]
  busy?: boolean
  onCreate: () => void
  onOpenFile: () => void
  onOpen: (entry: VideoEditProjectEntry) => void
}

const LABELS: ProjectLibraryLabels = {
  createAction: '新建项目',
  count: (count) => `${count} 个项目`,
  searchPlaceholder: '搜索项目',
  noResults: '没有符合条件的项目',
  sortLabel: '排序',
  sortOptions: { updated: '最近编辑', created: '最近创建', name: '名称' },
  emptyTitle: '从一个剪辑项目开始',
  emptyDescription: '新建项目，或打开已有的项目文件。项目保存在你选择的位置。',
  cancel: '取消',
  card: { open: '打开项目', more: '项目操作' },
}

function toCardItem(entry: VideoEditProjectEntry): ProjectCardGridItem {
  return {
    id: entry.id,
    name: entry.name,
    metaLine: entry.path,
    ...(entry.missing ? { status: '文件不存在' } : {}),
    ...(entry.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {}),
    ...(entry.coverPath ? { coverPath: entry.coverPath } : {}),
  }
}

/** 剪辑的项目页：新建项目（选择保存位置）、打开项目文件、点开已有项目。 */
export function VideoEditProjectsPage({ projects, busy = false, onCreate, onOpenFile, onOpen }: VideoEditProjectsPageProps): JSX.Element {
  const byId = new Map(projects.map((entry) => [entry.id, entry]))
  return (
    <ProjectLibraryPage
      title="剪辑"
      description="从本地素材开始创作，将可编辑项目保存在自己的磁盘上。"
      items={projects.map(toCardItem)}
      icon={ICON_WORKSPACE_VIDEO_EDIT}
      emptyIcon={<ICON_WORKSPACE_VIDEO_EDIT size={40} strokeWidth={1.5} aria-hidden="true" />}
      busy={busy}
      labels={LABELS}
      create={{ kind: 'direct', onCreate }}
      secondaryAction={{ label: '打开项目文件', icon: FolderOpen, onClick: onOpenFile }}
      onOpen={(item) => { const entry = byId.get(item.id); if (entry) onOpen(entry) }}
    />
  )
}
