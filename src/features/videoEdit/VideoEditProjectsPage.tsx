import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, ListX, PackageCheck, PackageOpen } from 'lucide-react'
import type { ProjectCardGridExtraAction, ProjectCardGridItem } from '@/components/ProjectCardGrid'
import { ProjectLibraryPage, type ProjectLibraryLabels } from '@/components/ProjectLibraryPage'
import { UI_TEXT_META_CLASS } from '@/components/ui'
import { ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'
import { MAX_ENTRY_NAME_LENGTH, normalizeEntryName } from '@/core/documents/naming'
import type { NameCheckResult, ProjectSummary } from '@/core/documents/types'
import { toError } from '@/features/documents/documentErrors'
import { getDocumentOperations, type DocumentOperations } from '@/features/documents/documentOperations'
import { exportProjectPackageInteractive, importPackageInteractive, packageFileName } from '@/features/documents/documentPackageActions'
import type { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { toProjectCardItems, useProjectLibrary, type ProjectCardItem } from '@/features/documents/useDocumentLibrary'
import { useLeftoverDraftProjects } from '@/features/documents/useLeftoverDrafts'
import { createLogger } from '@/core/logging/logger'
import { useNavigationStore } from '@/stores/navigationStore'
import { getDocumentCover } from '@/commands/documents'
import { ensureDocumentCover, loadDocumentHoverPreview, subscribeDocumentCoverChanged } from '@/features/documents/documentCovers'

/*
 * 剪辑页 = 项目列表（实施方案 2.10，3.1 剪辑接入）：每个项目是一个文件夹，剪辑是它的主文档。
 * 新建项目（草稿，离开时询问保存）、打开项目（打开主剪辑）、打开别处的项目文件夹（登记为外部位置）。
 * 数据来自通用项目列表（作品索引）；右键：打开、重命名、在文件夹中显示（也是悬停快捷按钮）、导出为单个文件…（4.1）、
 * 删除（整个文件夹移到回收站）；左栏次要动作：打开项目文件夹…、导入单个文件…（项目包放进“项目”文件夹，单个文档的包放进作品目录），
 * 找不到文件夹的外部项目只能“从列表移除”。意外退出留下的草稿项目带“草稿”标记排在最前，可继续编辑或整个移到回收站。
 */

interface VideoEditProjectsPageProps {
  busy?: boolean
  onCreate: () => void
  onOpenFolder: () => void
  onOpen: (project: ProjectSummary) => void
  /** 测试替换；正式运行用应用唯一的服务与会话登记表。 */
  operations?: DocumentOperations
  registry?: DocumentSessionRegistry
  /** 测试替换：读主剪辑的通用封面。 */
  readCover?: (docId: string) => Promise<string | null>
  /** 没有封面时从剪辑内容补生成（测试可替换） */
  ensureCover?: (docId: string) => Promise<void>
}

const logger = createLogger('features.videoEdit.projects')

/** 主剪辑没有封面时按剪辑登记的取法从内容补生成。 */
function ensureMainVideoEditCover(docId: string): Promise<void> {
  return ensureDocumentCover(docId, 'video_edit')
}

function asProjectItem(item: ProjectCardGridItem): ProjectCardItem {
  return item as ProjectCardItem
}

/** 项目卡片封面 = 主剪辑的通用封面；列表变化或剪辑封面更新后重读，读不到时保持占位图。 */
function useProjectCovers(items: readonly ProjectCardItem[], readCover: (docId: string) => Promise<string | null>, ensureCover: (docId: string) => Promise<void>): ProjectCardItem[] {
  const [covers, setCovers] = useState<ReadonlyMap<string, string>>(new Map())
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeDocumentCoverChanged(() => setVersion(value => value + 1)), [])
  const mainIds = useMemo(() => items.map(item => item.project.mainVideoEditId).filter((id): id is string => Boolean(id)), [items])
  useEffect(() => {
    let disposed = false
    void Promise.all(mainIds.map(async (id) => [id, await readCover(id).catch(() => null)] as const)).then((entries) => {
      if (disposed) return
      setCovers(new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
      // 没有封面的（含草稿）从剪辑内容补生成；写好后经封面更新通知重读
      for (const [id, cover] of entries) if (!cover) void ensureCover(id)
    })
    return () => { disposed = true }
  }, [mainIds, readCover, ensureCover, version])
  return useMemo(() => items.map((item) => {
    const mainId = item.project.mainVideoEditId
    const cover = mainId ? covers.get(mainId) : undefined
    // 悬停在封面上左右移动：预览主剪辑不同位置的画面
    const withPreview = mainId ? { ...item, hoverPreview: () => loadDocumentHoverPreview(mainId, 'video_edit') } : item
    return cover ? { ...withPreview, coverPath: cover } : withPreview
  }), [items, covers])
}

export function VideoEditProjectsPage({ busy = false, onCreate, onOpenFolder, onOpen, operations: providedOperations, registry, readCover = getDocumentCover, ensureCover = ensureMainVideoEditCover }: VideoEditProjectsPageProps): JSX.Element {
  const { t } = useTranslation('ui')
  const operations = providedOperations ?? getDocumentOperations()
  const library = useProjectLibrary({ operations })
  const items = useProjectCovers(library.items, readCover, ensureCover)
  const leftover = useLeftoverDraftProjects(registry)
  const draftItems = useProjectCovers(useMemo(() => toProjectCardItems(leftover.drafts, t), [leftover.drafts, t]), readCover, ensureCover)
  // 工作区切走后页面仍保留（不卸载）：回到剪辑页时重新扫描并重读，资源管理器里的增删、别处新建的项目随之出现
  const active = useNavigationStore(state => state.activeWorkspace === 'videoEdit')
  const wasActive = useRef(active)
  const { reload } = library
  useEffect(() => {
    if (active && !wasActive.current) {
      void operations.refreshIndex().catch((raw: unknown) => logger.warn('刷新作品索引失败', { event: 'video_edit.projects.refresh.failed', error: toError(raw) })).finally(() => { void reload() })
    }
    wasActive.current = active
  }, [active, operations, reload])
  const [actionError, setActionError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [packageStatus, setPackageStatus] = useState<string | null>(null)

  const run = useCallback(async (failureKey: string, action: () => Promise<void>): Promise<void> => {
    setActionError(null)
    setPackageStatus(null)
    setWorking(true)
    try { await action() } catch (raw) {
      setActionError(t(`projectLibrary.failed.${failureKey}`, { message: toError(raw).message }))
    } finally { setWorking(false) }
  }, [t])

  const nameMessage = useCallback((result: NameCheckResult): string | null => {
    if (result.status === 'available') return null
    if (result.status === 'duplicate') return t('projectLibrary.duplicate')
    return t(`documentSession.nameDialog.invalid.${result.reason}`, { max: MAX_ENTRY_NAME_LENGTH })
  }, [t])

  const validateName = useCallback(async (name: string, context: { mode: 'create' } | { mode: 'rename'; item: ProjectCardGridItem }): Promise<string | null> => {
    const local = normalizeEntryName(name)
    if (!local.ok) return t(`documentSession.nameDialog.invalid.${local.reason}`, { max: MAX_ENTRY_NAME_LENGTH })
    try {
      return nameMessage(context.mode === 'rename'
        ? await operations.checkProjectRename(asProjectItem(context.item).project, local.name)
        : await operations.checkNewProjectName(local.name))
    } catch {
      return t('documentLibrary.rename.checkFailed')
    }
  }, [operations, nameMessage, t])

  const extraActions = useCallback((item: ProjectCardGridItem): ProjectCardGridExtraAction[] => {
    const project = asProjectItem(item).project
    if (project.missing) {
      return project.external ? [{
        id: 'forget',
        label: t('documentLibrary.actions.forget'),
        icon: <ListX className="h-4 w-4" />,
        onClick: () => { void run('forget', () => operations.forgetExternalProject(project)) },
      }] : []
    }
    return [{
      id: 'reveal',
      label: t('documentLibrary.actions.reveal'),
      icon: <FolderOpen className="h-4 w-4" />,
      quick: true,
      onClick: () => { void run('reveal', () => operations.revealProject(project.id)) },
    }, {
      id: 'export-package',
      label: t('documentLibrary.actions.exportPackage'),
      icon: <PackageCheck className="h-4 w-4" />,
      onClick: () => {
        void run('exportPackage', async () => {
          setPackageStatus(t('documentLibrary.package.exporting'))
          const result = await exportProjectPackageInteractive(project, operations)
          setPackageStatus(result ? (result.missingPaths.length
            ? t('documentLibrary.package.exportedMissing', { name: packageFileName(result), count: result.missingPaths.length })
            : t('documentLibrary.package.exported', { name: packageFileName(result) })) : null)
        })
      },
    }]
  }, [t, run, operations])

  const importPackage = useCallback((): void => {
    void run('importPackage', async () => {
      setPackageStatus(t('documentLibrary.package.importing'))
      const result = await importPackageInteractive(undefined, operations)
      if (!result) { setPackageStatus(null); return }
      setPackageStatus(result.type === 'project'
        ? t('documentLibrary.package.importedProject', { name: result.project.name })
        : t('documentLibrary.package.importedDocument', { name: result.meta.name }))
    })
  }, [run, operations, t])

  const labels = useMemo((): ProjectLibraryLabels => ({
    createAction: t('projectLibrary.create'),
    count: (count) => t('projectLibrary.count', { count }),
    searchPlaceholder: t('projectLibrary.searchPlaceholder'),
    noResults: t('projectLibrary.noResults'),
    sortLabel: t('documentLibrary.sortLabel'),
    sortOptions: {
      updated: t('documentLibrary.sortOptions.updated'),
      created: t('documentLibrary.sortOptions.created'),
      name: t('documentLibrary.sortOptions.name'),
    },
    nav: {
      all: t('documentLibrary.nav.all'),
      recent: t('documentLibrary.nav.recent'),
      drafts: t('documentLibrary.nav.drafts'),
    },
    recentEmpty: t('documentLibrary.recentEmpty'),
    view: { grid: t('documentLibrary.view.grid'), list: t('documentLibrary.view.list') },
    columns: {
      name: t('documentLibrary.columns.name'),
      location: t('documentLibrary.columns.location'),
      modified: t('documentLibrary.columns.modified'),
      created: t('documentLibrary.columns.created'),
      size: t('documentLibrary.columns.size'),
    },
    renameDialogTitle: t('projectLibrary.renameTitle'),
    loadingMessage: t('documentLibrary.loading'),
    emptyTitle: t('projectLibrary.emptyTitle'),
    emptyDescription: t('projectLibrary.emptyDescription'),
    deleteTitle: t('documentLibrary.delete.title'),
    deleteConfirmSingle: (name) => t('projectLibrary.deleteConfirmSingle', { name }),
    deleteConfirmMultiple: (count) => t('projectLibrary.deleteConfirmMultiple', { count }),
    confirmDelete: t('documentLibrary.delete.confirm'),
    cancel: t('documentLibrary.delete.cancel'),
    card: {
      open: t('documentLibrary.card.open'),
      rename: t('documentLibrary.card.rename'),
      delete: t('documentLibrary.card.delete'),
      selectMultiple: t('documentLibrary.card.selectMultiple'),
      selectItem: t('documentLibrary.card.selectItem'),
      deselectItem: t('documentLibrary.card.deselectItem'),
      more: t('documentLibrary.card.more'),
      draft: {
        marker: t('documentLibrary.card.draft.marker'),
        open: t('documentLibrary.card.draft.open'),
        discard: t('documentLibrary.card.draft.discard'),
      },
    },
    selection: {
      selectedCount: (count) => t('documentLibrary.selection.selectedCount', { count }),
      selectAll: t('documentLibrary.selection.selectAll'),
      deselectAll: t('documentLibrary.selection.clearSelection'),
      deleteSelected: t('documentLibrary.selection.deleteSelected'),
      cancel: t('documentLibrary.selection.exit'),
    },
  }), [t])

  const loadError = library.error && library.items.length === 0
    ? { title: t('documentLibrary.loadFailed', { kind: t('documentLibrary.kinds.video_edit') }), message: library.error.message, onRetry: () => { void library.reload() } }
    : undefined

  return (
    <ProjectLibraryPage
      title={t('projectLibrary.title')}
      description={t('projectLibrary.description')}
      persistKey="projects.videoEdit"
      items={items}
      drafts={draftItems}
      onDiscardDraft={async (item) => {
        setActionError(null)
        try {
          await leftover.discard(asProjectItem(item).project)
        } catch (raw) {
          setActionError(t('documentSession.recovery.discardFailed', { message: toError(raw).message }))
        }
      }}
      icon={ICON_WORKSPACE_VIDEO_EDIT}
      emptyIcon={<ICON_WORKSPACE_VIDEO_EDIT size={40} strokeWidth={1.5} aria-hidden="true" />}
      loading={library.loading}
        total={library.total}
        loadingMore={library.loadingMore}
      loadError={loadError}
      busy={busy || working}
      labels={labels}
      create={{ kind: 'direct', onCreate }}
      secondaryAction={[
        { label: t('projectLibrary.openFolder'), icon: FolderOpen, onClick: onOpenFolder },
        { label: t('documentLibrary.importPackage'), icon: PackageOpen, onClick: importPackage },
      ]}
      banner={(
        <>
          {actionError ? <p role="alert" className="mb-4 text-xs text-danger-text">{actionError}</p> : null}
          {packageStatus && !actionError ? <p role="status" className={`mb-4 ${UI_TEXT_META_CLASS}`} data-observation-sensitive>{packageStatus}</p> : null}
        </>
      )}
      canManage={(item) => !asProjectItem(item).project.missing}
      extraActions={extraActions}
      onOpen={(item) => onOpen(asProjectItem(item).project)}
      validateName={validateName}
      onRename={async (item, name) => {
        setActionError(null)
        await operations.renameProject(asProjectItem(item).project.id, name)
      }}
      onDelete={async (items) => {
        await run('delete', async () => {
          for (const item of items) {
            const project = asProjectItem(item).project
            if (!project.missing) await operations.trashProject(project)
          }
        })
      }}
    />
  )
}
