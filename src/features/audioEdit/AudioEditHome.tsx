import { FolderOpen } from 'lucide-react'
import type { ProjectCardGridItem } from '@/components/ProjectCardGrid'
import { ProjectLibraryPage, type ProjectLibraryLabels } from '@/components/ProjectLibraryPage'
import type { AudioEditProjectSummary } from '@/core/audioEdit/types'
import { ICON_MEDIA_VIDEO, ICON_TOOL_AUDIO_EDIT as AudioEditIcon } from '@/core/theme/icons'

interface AudioEditHomeProps {
  projects: AudioEditProjectSummary[]
  loading: boolean
  loadFailed: boolean
  disabled: boolean
  onBack?: () => void
  onImport: () => void
  onOpen: (id: string) => void
  onRetry: () => void
  onRename: (id: string, name: string) => void
  onDelete: (ids: string[]) => Promise<void>
}

const LABELS: ProjectLibraryLabels = {
  createAction: '导入音频或视频',
  count: (count) => `${count} 个项目`,
  searchPlaceholder: '搜索项目',
  noResults: '没有符合条件的项目',
  sortLabel: '排序',
  sortOptions: { updated: '最近编辑', created: '最近创建', name: '名称' },
  renameDialogTitle: '重命名项目',
  namePlaceholder: '项目名称',
  loadingMessage: '正在读取项目…',
  emptyTitle: '从一段口播开始',
  emptyDescription: '导入音频或视频，压缩停顿、清理语气词，再导出到 Premiere 或达芬奇继续编辑。项目直接引用原素材。',
  deleteTitle: '删除项目',
  deleteConfirmSingle: (name) => `确定删除「${name}」？只删除项目和缓存，原素材保持不变。`,
  deleteConfirmMultiple: (count) => `确定删除选中的 ${count} 个项目？只删除项目和缓存，原素材保持不变。`,
  confirmDelete: '删除',
  cancel: '取消',
  card: {
    open: '打开项目',
    rename: '重命名',
    delete: '删除',
    selectMultiple: '多选',
    selectItem: '选中',
    deselectItem: '取消选中',
    more: '项目操作',
  },
  selection: {
    selectedCount: (count) => `已选择 ${count} 项`,
    selectAll: '全选',
    deselectAll: '取消全选',
    deleteSelected: '删除所选',
    cancel: '取消',
  },
}

function formatDuration(project: AudioEditProjectSummary): string {
  const seconds = Math.max(0, Math.floor(project.durationFrames / Math.max(1, project.sampleRate)))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function toCardItem(project: AudioEditProjectSummary): ProjectCardGridItem {
  return {
    id: project.id,
    name: project.name,
    metaLine: `${project.mediaType === 'video' ? '视频' : '音频'} · ${formatDuration(project)} · ${new Date(project.updatedAt).toLocaleDateString()}`,
    // 口播没有封面：占位图按素材类型区分音频与视频
    icon: project.mediaType === 'video' ? ICON_MEDIA_VIDEO : AudioEditIcon,
    updatedAt: project.updatedAt,
  }
}

/** 口播项目页：复用五个模块共用的项目页；新建 = 导入音频或视频（不起名，名称取文件名）。 */
export function AudioEditHome({ projects, loading, loadFailed, disabled, onBack, onImport, onOpen, onRetry, onRename, onDelete }: AudioEditHomeProps) {
  return (
    <ProjectLibraryPage
      title="口播剪辑"
      description="用文字和波形剪辑，再交给专业剪辑软件"
      onBack={onBack}
      backLabel="返回工具"
      items={projects.map(toCardItem)}
      icon={AudioEditIcon}
      emptyIcon={<AudioEditIcon size={40} strokeWidth={1.5} aria-hidden="true" />}
      loading={loading}
      loadError={loadFailed ? { title: '暂时无法读取项目', message: '请重试以加载已有项目。', onRetry } : undefined}
      busy={disabled}
      labels={LABELS}
      create={{ kind: 'direct', icon: FolderOpen, onCreate: onImport }}
      onOpen={(item) => onOpen(item.id)}
      onRename={(item, name) => onRename(item.id, name)}
      onDelete={(items) => onDelete(items.map((item) => item.id))}
    />
  )
}
