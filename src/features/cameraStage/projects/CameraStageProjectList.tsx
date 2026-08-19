import React, { useCallback, useEffect, useState } from 'react'
import ContextMenu from '@/components/ContextMenu'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { ProjectCardGrid, type ProjectCardGridItem } from '@/components/ProjectCardGrid'
import { ProjectSelectionToolbar } from '@/components/ProjectSelectionToolbar'
import { RenameDialog } from '@/components/RenameDialog'
import { ICON_TOOL_CAMERA_STAGE } from '@/core/theme/icons'
import { UiButton, UiPageHeader, UiRegion } from '@/components/ui'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import type { CameraStageProjectPlatformSummary } from '@/platform/contracts/cameraStageProjects'
import { cameraStageApplicationService } from '../application/cameraStageApplicationService'
import { CAMERA_STAGE_DEFAULT_PROJECT_NAME } from '../store/cameraStageStore'

/**
 * 3D 镜头参考工程列表页：新建 / 打开 / 重命名 / 删除 / 多选批量删除工程。
 * 打开或新建成功后调用 onEnterEditor 进入场景编辑器（场景已加载进 store）。
 *
 * 卡片网格、右键菜单、多选与删除确认均复用画布工程管理（`ProjectManager`）的同一套
 * 共享组件，两处工程列表只在数据来源与专属操作（这里没有导入/导出）上不同。
 */

interface CameraStageProjectListProps {
  onEnterEditor: () => void
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
  }
}

const CameraStageProjectList: React.FC<CameraStageProjectListProps> = ({ onEnterEditor }) => {
  const [projects, setProjects] = useState<CameraStageProjectPlatformSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editingProject, setEditingProject] = useState<CameraStageProjectPlatformSummary | null>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ProjectCardGridItem[] | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { menuVisible, menuPosition, menuItems, showMenu, hideMenu } = useContextMenu()
  const selection = useMultiSelect(projects.map((project) => project.id))
  const cardItems = projects.map(toCardItem)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setProjects(await cameraStageApplicationService.listProjects())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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

  const submitRename = useCallback(async (projectId: string, name: string): Promise<void> => {
    await cameraStageApplicationService.renameProject(projectId, name)
    await refresh()
  }, [refresh])

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await Promise.all(pendingDelete.map((item) => cameraStageApplicationService.deleteProject(item.id)))
      await refresh()
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }, [pendingDelete, refresh])

  return (
    <div className="h-full overflow-y-auto bg-app">
      <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto px-6 py-8">
        <UiPageHeader
          className="mb-6"
          title="3D 镜头参考"
          description="搭建三维场景、摆姿势、调摄像机，截图给 AI 当参考图"
          actions={selection.active ? (
            <ProjectSelectionToolbar
              selection={selection}
              labels={{
                selectedCount: (count) => `已选择 ${count} 项`,
                selectAll: '全选',
                deselectAll: '取消全选',
                deleteSelected: '删除所选',
                cancel: '取消',
              }}
              onDeleteSelected={() => setPendingDelete(cardItems.filter((item) => selection.isSelected(item.id)))}
            />
          ) : (
            <UiButton
              variant="primary"
              onClick={() => {
                setEditingProject(null)
                setShowEditDialog(true)
              }}
              disabled={busy}
            >
              新建工程
            </UiButton>
          )}
        />

        <ProjectCardGrid
          items={cardItems}
          loading={loading}
          loadingMessage="加载中…"
          busy={busy}
          icon={ICON_TOOL_CAMERA_STAGE}
          selection={selection}
          labels={{
            open: '打开工程',
            rename: '重命名',
            delete: '删除',
            selectMultiple: '多选',
            selectItem: '选中',
            deselectItem: '取消选中',
          }}
          emptyTitle="还没有工程"
          emptyDescription="点击右上「新建工程」开始。"
          onOpen={(item) => void handleOpen(item.id)}
          onRename={(item) => {
            const target = projects.find((project) => project.id === item.id) ?? null
            setEditingProject(target)
            setShowEditDialog(true)
          }}
          onDeleteRequest={(items) => setPendingDelete(items)}
          showMenu={showMenu}
        />
      </UiRegion>

      <RenameDialog
        isOpen={showEditDialog}
        title={editingProject ? '重命名工程' : '新建工程'}
        defaultValue={editingProject ? editingProject.name : CAMERA_STAGE_DEFAULT_PROJECT_NAME}
        placeholder="工程名称"
        onClose={() => setShowEditDialog(false)}
        onConfirm={(name) => {
          if (editingProject) void submitRename(editingProject.id, name)
          else void handleCreate(name)
        }}
      />

      <DeleteConfirmDialog
        isOpen={!!pendingDelete}
        title="删除工程"
        message={
          pendingDelete
            ? pendingDelete.length === 1
              ? `确定删除「${pendingDelete[0].name}」？此操作不可恢复。`
              : `确定删除选中的 ${pendingDelete.length} 个工程？此操作不可恢复。`
            : ''
        }
        cancelLabel="取消"
        confirmLabel="删除"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      <ContextMenu items={menuItems} position={menuPosition} onClose={hideMenu} visible={menuVisible} />
    </div>
  )
}

export default CameraStageProjectList
