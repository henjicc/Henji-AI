import React, { useCallback, useEffect, useState } from 'react'
import { type ProjectCardGridItem } from '@/components/ProjectCardGrid'
import { ProjectLibraryPage, type ProjectLibraryLabels } from '@/components/ProjectLibraryPage'
import { ICON_TOOL_CAMERA_STAGE } from '@/core/theme/icons'
import type { CameraStageProjectPlatformSummary } from '@/platform/contracts/cameraStageProjects'
import { cameraStageApplicationService } from '../application/cameraStageApplicationService'
import { useCameraStageSessionStore } from '../store/cameraStageSessionStore'
import { CAMERA_STAGE_DEFAULT_PROJECT_NAME } from '../store/cameraStageStore'

/**
 * 3D 镜头参考工程列表页：新建 / 打开 / 重命名 / 删除 / 多选批量删除工程。
 * 打开或新建成功后调用 onEnterEditor 进入场景编辑器（场景已加载进 store）。
 *
 * 页面外壳整体复用 `ProjectLibraryPage`（画布项目管理页用的是同一个组件），
 * 这里只提供数据来源与工程列表专属文案，不重写骨架，也不覆盖它的样式。
 */

interface CameraStageProjectListProps {
  onEnterEditor: () => void
  onBackToToolbox?: () => void
}

const LABELS: ProjectLibraryLabels = {
  createAction: '新建工程',
  createDialogTitle: '新建工程',
  renameDialogTitle: '重命名工程',
  namePlaceholder: '工程名称',
  defaultNewName: CAMERA_STAGE_DEFAULT_PROJECT_NAME,
  loadingMessage: '加载中…',
  emptyTitle: '还没有工程',
  emptyDescription: '点击右上「新建工程」开始。',
  deleteTitle: '删除工程',
  deleteConfirmSingle: (name) => `确定删除「${name}」？此操作不可恢复。`,
  deleteConfirmMultiple: (count) => `确定删除选中的 ${count} 个工程？此操作不可恢复。`,
  confirmDelete: '删除',
  cancel: '取消',
  card: {
    open: '打开工程',
    rename: '重命名',
    delete: '删除',
    selectMultiple: '多选',
    selectItem: '选中',
    deselectItem: '取消选中',
  },
  selection: {
    selectedCount: (count) => `已选择 ${count} 项`,
    selectAll: '全选',
    deselectAll: '取消全选',
    deleteSelected: '删除所选',
    cancel: '取消',
  },
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toCardItem(project: CameraStageProjectPlatformSummary): ProjectCardGridItem {
  return {
    id: project.id,
    name: project.name,
    metaLine: `${project.objectCount} 个对象 · ${formatTime(project.updatedAt)}`,
    coverPath: project.coverPath,
  }
}

const CameraStageProjectList: React.FC<CameraStageProjectListProps> = ({ onEnterEditor, onBackToToolbox }) => {
  const [projects, setProjects] = useState<CameraStageProjectPlatformSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setProjects(await cameraStageApplicationService.listProjects())
    } finally {
      setLoading(false)
    }
  }, [])

  // 退出编辑器时写入的封面是异步落盘的，coverRevision 变化即重新拉一次摘要
  const coverRevision = useCameraStageSessionStore((state) => state.coverRevision)

  useEffect(() => {
    void refresh()
  }, [refresh, coverRevision])

  const handleCreate = useCallback(async (name: string): Promise<void> => {
    setBusy(true)
    try {
      await cameraStageApplicationService.createProject(name.trim() || CAMERA_STAGE_DEFAULT_PROJECT_NAME)
      onEnterEditor()
    } finally {
      setBusy(false)
    }
  }, [onEnterEditor])

  const handleOpen = useCallback(
    async (projectId: string): Promise<void> => {
      setBusy(true)
      try {
        await cameraStageApplicationService.openProject(projectId)
        onEnterEditor()
      } finally {
        setBusy(false)
      }
    },
    [onEnterEditor],
  )

  const handleRename = useCallback(async (projectId: string, name: string): Promise<void> => {
    await cameraStageApplicationService.renameProject(projectId, name)
    await refresh()
  }, [refresh])

  const handleDelete = useCallback(async (items: ProjectCardGridItem[]): Promise<void> => {
    await Promise.all(items.map((item) => cameraStageApplicationService.deleteProject(item.id)))
    await refresh()
  }, [refresh])

  return (
    <ProjectLibraryPage
      title="3D 镜头参考"
      description="搭建三维场景、摆姿势、调摄像机，截图给 AI 当参考图"
      onBack={onBackToToolbox}
      backLabel="返回工具箱"
      items={projects.map(toCardItem)}
      icon={ICON_TOOL_CAMERA_STAGE}
      loading={loading}
      busy={busy}
      labels={LABELS}
      onOpen={(item) => void handleOpen(item.id)}
      onCreate={(name) => void handleCreate(name)}
      onRename={(item, name) => void handleRename(item.id, name)}
      onDelete={handleDelete}
    />
  )
}

export default CameraStageProjectList
