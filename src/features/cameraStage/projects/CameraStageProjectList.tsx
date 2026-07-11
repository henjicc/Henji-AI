import React, { useCallback, useEffect, useState } from 'react'
import { Boxes, Pencil, Plus, Trash2 } from 'lucide-react'
import { UiButton, UiIconButton, UiInput, UiModal, UiOptionButton } from '@/components/ui'
import type { CameraStageProjectPlatformSummary } from '@/platform/contracts/cameraStageProjects'
import type { StageEditorMode } from '../domain/shotTypes'
import { CAMERA_STAGE_DEFAULT_PROJECT_NAME } from '../store/cameraStageStore'
import {
  createNewProject,
  deleteProject,
  listProjects,
  loadProjectIntoScene,
  renameProject,
} from './cameraStageProjectService'

/**
 * 运镜控制工程列表页：新建 / 打开 / 重命名 / 删除工程。
 * 打开或新建成功后调用 onEnterEditor 进入场景编辑器（场景已加载进 store）。
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

const CameraStageProjectList: React.FC<CameraStageProjectListProps> = ({ onEnterEditor }) => {
  const [projects, setProjects] = useState<CameraStageProjectPlatformSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [renameTarget, setRenameTarget] = useState<CameraStageProjectPlatformSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CameraStageProjectPlatformSummary | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createMode, setCreateMode] = useState<StageEditorMode>('simple')
  const [createName, setCreateName] = useState(CAMERA_STAGE_DEFAULT_PROJECT_NAME)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setProjects(await listProjects())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCreate = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await createNewProject(createName.trim() || CAMERA_STAGE_DEFAULT_PROJECT_NAME, createMode)
      setCreateDialogOpen(false)
      onEnterEditor()
    } finally {
      setBusy(false)
    }
  }, [createMode, createName, onEnterEditor])

  const handleOpen = useCallback(
    async (projectId: string): Promise<void> => {
      setBusy(true)
      try {
        const ok = await loadProjectIntoScene(projectId)
        if (ok) {
          onEnterEditor()
        } else {
          await refresh()
        }
      } finally {
        setBusy(false)
      }
    },
    [onEnterEditor, refresh],
  )

  const submitRename = useCallback(async (): Promise<void> => {
    if (!renameTarget) return
    await renameProject(renameTarget.id, renameValue)
    setRenameTarget(null)
    await refresh()
  }, [renameTarget, renameValue, refresh])

  const submitDelete = useCallback(async (): Promise<void> => {
    if (!deleteTarget) return
    await deleteProject(deleteTarget.id)
    setDeleteTarget(null)
    await refresh()
  }, [deleteTarget, refresh])

  return (
    <div className="h-full overflow-y-auto bg-app">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-lg font-medium text-text-dark">运镜控制</div>
            <div className="mt-1 text-sm text-text-muted">搭建三维场景、摆姿势、调摄像机，截图给 AI 当参考图</div>
          </div>
          <UiButton onClick={() => {
            setCreateMode('simple')
            setCreateName(CAMERA_STAGE_DEFAULT_PROJECT_NAME)
            setCreateDialogOpen(true)
          }} disabled={busy}>
            <Plus size={15} className="mr-1" />
            新建工程
          </UiButton>
        </div>

        {loading ? (
          <div className="pt-10 text-center text-sm text-text-muted">加载中…</div>
        ) : projects.length === 0 ? (
          <div className="pt-10 text-center text-sm text-text-muted">
            还没有工程，点击右上「新建工程」开始
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div key={project.id} className="group relative">
                <UiOptionButton
                  variant="card"
                  className="h-auto w-full flex-col !items-start gap-2 p-4 text-left"
                  onClick={() => void handleOpen(project.id)}
                  disabled={busy}
                >
                  <Boxes size={20} className="text-text-muted" />
                  <span className="w-full truncate pr-14 text-sm font-medium">{project.name}</span>
                  <span className="text-xs text-text-muted">
                    {project.objectCount} 个对象 · {formatTime(project.updatedAt)}
                  </span>
                </UiOptionButton>
                <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <UiIconButton
                    showBorder={false}
                    appearance="hover-only"
                    className="h-7 w-7"
                    title="重命名"
                    onClick={() => {
                      setRenameTarget(project)
                      setRenameValue(project.name)
                    }}
                  >
                    <Pencil size={13} />
                  </UiIconButton>
                  <UiIconButton
                    showBorder={false}
                    appearance="hover-only"
                    hoverVariant="danger"
                    className="h-7 w-7"
                    title="删除"
                    onClick={() => setDeleteTarget(project)}
                  >
                    <Trash2 size={13} />
                  </UiIconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <UiModal
        isOpen={createDialogOpen}
        title="新建工程"
        onClose={() => setCreateDialogOpen(false)}
        footer={
          <>
            <UiButton variant="ghost" onClick={() => setCreateDialogOpen(false)}>取消</UiButton>
            <UiButton onClick={() => void handleCreate()} disabled={busy}>创建工程</UiButton>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-text-muted">工程名称</div>
            <UiInput
              autoFocus
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !busy) void handleCreate()
              }}
              placeholder={CAMERA_STAGE_DEFAULT_PROJECT_NAME}
            />
          </div>
          <div className="pt-1 text-sm text-text-muted">选择编辑方式。创建后模式会随工程保存。</div>
          <div className="grid grid-cols-2 gap-2">
            <UiOptionButton
              variant="card"
              active={createMode === 'simple'}
              className="h-auto flex-col !items-start gap-1 p-3 text-left"
              onClick={() => setCreateMode('simple')}
            >
              <span className="text-sm font-medium">简易模式 · 推荐</span>
              <span className="text-xs text-text-muted">用镜头卡组织运镜，无需关键帧。</span>
            </UiOptionButton>
            <UiOptionButton
              variant="card"
              active={createMode === 'pro'}
              className="h-auto flex-col !items-start gap-1 p-3 text-left"
              onClick={() => setCreateMode('pro')}
            >
              <span className="text-sm font-medium">专业模式</span>
              <span className="text-xs text-text-muted">使用关键帧时间轴进行精细编辑。</span>
            </UiOptionButton>
          </div>
        </div>
      </UiModal>

      <UiModal
        isOpen={!!renameTarget}
        title="重命名工程"
        onClose={() => setRenameTarget(null)}
        footer={
          <>
            <UiButton variant="ghost" onClick={() => setRenameTarget(null)}>
              取消
            </UiButton>
            <UiButton onClick={() => void submitRename()}>确定</UiButton>
          </>
        }
      >
        <UiInput
          autoFocus
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitRename()
          }}
          placeholder="工程名称"
        />
      </UiModal>

      <UiModal
        isOpen={!!deleteTarget}
        title="删除工程"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <UiButton variant="ghost" onClick={() => setDeleteTarget(null)}>
              取消
            </UiButton>
            <UiButton
              className="border-red-500/40 bg-red-600/80 text-white hover:bg-red-600"
              onClick={() => void submitDelete()}
            >
              删除
            </UiButton>
          </>
        }
      >
        <div className="text-sm text-text-dark">
          确定删除「{deleteTarget?.name}」？此操作不可恢复。
        </div>
      </UiModal>
    </div>
  )
}

export default CameraStageProjectList
