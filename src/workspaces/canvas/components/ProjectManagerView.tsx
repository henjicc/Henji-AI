import React, { useMemo, useState } from 'react'
import { FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import type { CanvasProjectSummary } from '@/services/canvasProjects'

interface ProjectManagerViewProps {
  projects: CanvasProjectSummary[]
  loading: boolean
  creating: boolean
  isOpeningProject: boolean
  onCreate: (name: string) => Promise<void>
  onOpen: (projectId: string) => Promise<void>
  onDelete: (projectId: string) => Promise<void>
  onRename: (projectId: string, name: string) => Promise<void>
}

interface RenameDialogState {
  open: boolean
  mode: 'create' | 'rename'
  projectId?: string
  value: string
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN')
}

function RenameDialog({
  state,
  onClose,
  onConfirm,
}: {
  state: RenameDialogState
  onClose: () => void
  onConfirm: (value: string) => Promise<void>
}): JSX.Element | null {
  const [name, setName] = useState(state.value)

  React.useEffect(() => {
    if (state.open) setName(state.value)
  }, [state.open, state.value])

  if (!state.open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-[360px] rounded-xl border border-zinc-700 bg-[#171920] p-5 shadow-2xl">
        <div className="mb-4 text-base font-semibold text-zinc-100">
          {state.mode === 'create' ? '新建项目' : '重命名项目'}
        </div>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={async (event) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'Enter' && name.trim()) await onConfirm(name.trim())
          }}
          placeholder="输入项目名称"
          className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200" onClick={onClose}>
            取消
          </button>
          <button
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-zinc-700"
            disabled={!name.trim()}
            onClick={async () => {
              await onConfirm(name.trim())
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProjectManagerView({
  projects,
  loading,
  creating,
  isOpeningProject,
  onCreate,
  onOpen,
  onDelete,
  onRename,
}: ProjectManagerViewProps): JSX.Element {
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<RenameDialogState>({
    open: false,
    mode: 'create',
    value: '',
  })

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects]
  )

  return (
    <div className="h-full overflow-auto bg-[#0b0c10] text-zinc-100">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-100">项目管理</h1>
          <button
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
            disabled={creating}
            onClick={() => setDialog({ open: true, mode: 'create', value: '' })}
          >
            <Plus className="h-4 w-4" />
            新建项目
          </button>
        </div>

        {loading && <div className="text-sm text-zinc-500">加载项目中...</div>}

        {!loading && sortedProjects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-500">
            <FolderOpen className="mb-4 h-14 w-14 opacity-60" />
            <div className="text-base">暂无项目</div>
            <div className="mt-2 text-sm">点击“新建项目”开始创建画布。</div>
          </div>
        )}

        {!loading && sortedProjects.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedProjects.map((project) => (
              <button
                key={project.id}
                className="group rounded-xl border border-zinc-700 bg-[#14161d] p-4 text-left transition hover:border-sky-600/60 hover:shadow-lg"
                onClick={async () => {
                  setBusyProjectId(project.id)
                  try {
                    await onOpen(project.id)
                  } finally {
                    setBusyProjectId(null)
                  }
                }}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="truncate text-sm font-semibold text-zinc-100">{project.name}</div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <span
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      onClick={(event) => {
                        event.stopPropagation()
                        setDialog({
                          open: true,
                          mode: 'rename',
                          projectId: project.id,
                          value: project.name,
                        })
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </span>
                    <span
                      className="rounded p-1 text-zinc-400 hover:bg-red-950/40 hover:text-red-300"
                      onClick={async (event) => {
                        event.stopPropagation()
                        if (!window.confirm('确认删除该项目？')) return
                        setBusyProjectId(project.id)
                        try {
                          await onDelete(project.id)
                        } finally {
                          setBusyProjectId(null)
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-zinc-400">
                  <div>节点数：{project.nodeCount}</div>
                  <div>更新时间：{formatDate(project.updatedAt)}</div>
                </div>
                {busyProjectId === project.id && <div className="mt-2 text-xs text-sky-400">打开中...</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      {(isOpeningProject || creating) && (
        <div className="pointer-events-none fixed inset-0 z-[90] bg-black/10" />
      )}

      <RenameDialog
        state={dialog}
        onClose={() => setDialog((prev) => ({ ...prev, open: false }))}
        onConfirm={async (value) => {
          if (dialog.mode === 'create') {
            await onCreate(value)
            setDialog((prev) => ({ ...prev, open: false }))
            return
          }
          if (dialog.projectId) {
            await onRename(dialog.projectId, value)
          }
          setDialog((prev) => ({ ...prev, open: false }))
        }}
      />
    </div>
  )
}
