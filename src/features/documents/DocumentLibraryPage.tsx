import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, File as FileIcon, FileInput, FolderInput, FolderOpen, FolderOutput, ListX, PackageCheck, PackageOpen, PackagePlus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { ProjectCardGridExtraAction, ProjectCardGridItem } from '@/components/ProjectCardGrid'
import {
  ProjectLibraryPage,
  type ProjectLibraryCreate,
  type ProjectLibraryLabels,
  type ProjectLibrarySecondaryAction,
} from '@/components/ProjectLibraryPage'
import { AlertDialog, UI_TEXT_META_CLASS } from '@/components/ui'
import { documentKindRegistry } from '@/core/documents/kinds'
import { MAX_ENTRY_NAME_LENGTH, normalizeEntryName } from '@/core/documents/naming'
import type { DocumentContainerRef, DocumentKindId, DocumentSummary, NameCheckResult } from '@/core/documents/types'
import { openDialog } from '@/platform/desktopApi'

import { toError } from './documentErrors'
import { documentKindPresentation } from './documentKindPresentation'
import { exportDocumentPackageInteractive, importPackageInteractive, packageFileName } from './documentPackageActions'
import { getDocumentOperations, isDocumentNameConflict, type DocumentOperations } from './documentOperations'
import type { DocumentSessionRegistry } from './documentSessionRegistry'
import { MoveToProjectDialog, type MoveToProjectChoice } from './MoveToProjectDialog'
import {
  ALL_DOCUMENTS_FILTER,
  documentLibraryFilterValue,
  parseDocumentLibraryFilter,
  toDocumentCardItems,
  useDocumentLibrary,
  type DocumentCardItem,
  type DocumentLibraryFilter,
} from './useDocumentLibrary'
import { useLeftoverDocumentDrafts } from './useLeftoverDrafts'

/*
 * 文档类型的项目页（存储底座 2.5，实施方案 2.10）：共用 ProjectLibraryPage 外壳，接上通用数据源与右键操作。
 * 3.x 各工具切换时只换成 <DocumentLibraryPage kind="…" …/>，不再自己取数、自己写重命名 / 删除。
 *
 * 右键：打开、重命名（实时查重，重名不加后缀）、移到项目…、移出项目、创建副本、在文件夹中显示、
 * 导出为单个文件…（4.1 通用单文件包）、收集素材到项目（4.4，只对项目里的文档）、删除（移到回收站）。
 * “在文件夹中显示”同时是悬停快捷按钮。左栏次要动作“打开文件…”（4.4：打开别处的文档，所在位置登记为外部位置）
 * 与“导入单个文件…”（导入到作品目录）；位置筛选（不在项目里 / 某个项目）是左栏的“按所属项目”一组导航。
 * 找不到文件的文档只有“从列表移除”（只改作品索引，不动磁盘）。
 * 移动遇到重名时询问“两个都保留 / 取消”；创建副本与原件在同一文件夹，按“两个都保留”自动加序号，不再询问。
 * 遗留草稿（意外退出、没保存）带“草稿”标记排在列表最前：单击继续编辑，菜单里可以移到回收站；按当前位置筛选。
 */

export interface DocumentLibraryPageProps {
  kind: DocumentKindId
  title: ReactNode
  description?: ReactNode
  /** 打开文档；省略时交给通用打开方式（该类型登记的 opener）。草稿“继续编辑”也走这里。 */
  onOpen?: (document: DocumentSummary) => void | Promise<void>
  /** 新建方式；文案默认“新建<类型>”。 */
  create: ProjectLibraryCreate
  secondaryAction?: ProjectLibrarySecondaryAction
  onDropFiles?: (files: File[]) => void
  onBack?: () => void
  backLabel?: string
  icon?: LucideIcon
  /** 类型专属的卡片元信息（如“12 个对象”）。 */
  describe?: (document: DocumentSummary) => string | undefined
  busy?: boolean
  /** 覆盖个别文案（如空态说明）。 */
  labels?: Partial<Omit<ProjectLibraryLabels, 'card' | 'selection'>>
  /** 类型专属的卡片右键动作（排在通用动作之后，如画布的“导出工程包”）；找不到文件的文档不显示。 */
  documentActions?: (document: DocumentSummary) => ProjectCardGridExtraAction[]
  /** 页头下方的类型专属提示（如导出进度、导入失败）。 */
  banner?: ReactNode
  /** 测试替换；正式运行用应用唯一的服务与会话登记表。 */
  operations?: DocumentOperations
  registry?: DocumentSessionRegistry
}

type PendingConflict = { name: string; retry: () => Promise<void> }

function asDocumentItem(item: ProjectCardGridItem): DocumentCardItem {
  return item as DocumentCardItem
}

function draftMatchesFilter(draft: DocumentSummary, filter: DocumentLibraryFilter): boolean {
  if (filter.kind === 'all') return true
  if (filter.kind === 'standalone') return draft.container.kind === 'user'
  return draft.container.kind === 'project' && draft.container.projectId === filter.projectId
}

export function DocumentLibraryPage({
  kind,
  title,
  description,
  onOpen,
  create,
  secondaryAction,
  onDropFiles,
  onBack,
  backLabel,
  icon,
  describe,
  busy = false,
  labels: labelOverrides,
  documentActions,
  banner,
  operations: providedOperations,
  registry,
}: DocumentLibraryPageProps): JSX.Element {
  const { t } = useTranslation('ui')
  const operations = providedOperations ?? getDocumentOperations()
  const library = useDocumentLibrary({ kind, describe, operations })
  const leftover = useLeftoverDocumentDrafts(kind, registry)
  // 草稿跟随左栏的位置筛选：选了某个项目就只看这个项目里的草稿
  const draftItems = useMemo(
    () => toDocumentCardItems(leftover.drafts.filter((draft) => draftMatchesFilter(draft, library.filter)), { t, describe }),
    [leftover.drafts, library.filter, t, describe],
  )
  const presentation = documentKindPresentation(kind)
  const kindName = t(presentation.nameKey)
  const PageIcon = icon ?? presentation.icon
  const [moving, setMoving] = useState<DocumentSummary | null>(null)
  const [conflict, setConflict] = useState<PendingConflict | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [packageStatus, setPackageStatus] = useState<string | null>(null)

  const run = useCallback(async (failureKey: string, action: () => Promise<void>): Promise<void> => {
    setActionError(null)
    setPackageStatus(null)
    setWorking(true)
    try {
      await action()
    } catch (raw) {
      setActionError(t(`documentLibrary.failed.${failureKey}`, { message: toError(raw).message }))
    } finally {
      setWorking(false)
    }
  }, [t])

  const open = useCallback((document: DocumentSummary): void => {
    void run('open', async () => { await (onOpen ? onOpen(document) : operations.openDocument(document)) })
  }, [run, onOpen, operations])

  /** 移动：先按“重名报错”试一次，重名时询问“两个都保留 / 取消”。 */
  const moveWithConflictPrompt = useCallback(async (document: DocumentSummary, container: DocumentContainerRef): Promise<void> => {
    const target = { id: document.id, path: document.path }
    try {
      await operations.moveDocument(target, container, 'fail')
    } catch (raw) {
      if (!isDocumentNameConflict(raw)) throw raw
      setConflict({ name: document.name, retry: async () => { await operations.moveDocument(target, container, 'keepBoth') } })
    }
  }, [operations])

  const nameCheckMessage = useCallback((result: NameCheckResult): string | null => {
    if (result.status === 'available') return null
    if (result.status === 'duplicate') return t('documentLibrary.rename.duplicate')
    return t(`documentSession.nameDialog.invalid.${result.reason}`, { max: MAX_ENTRY_NAME_LENGTH })
  }, [t])

  const validateName = useCallback(async (name: string, context: { mode: 'create' } | { mode: 'rename'; item: ProjectCardGridItem }): Promise<string | null> => {
    const local = normalizeEntryName(name)
    if (!local.ok) return t(`documentSession.nameDialog.invalid.${local.reason}`, { max: MAX_ENTRY_NAME_LENGTH })
    try {
      const result = context.mode === 'rename'
        ? await operations.checkDocumentName(asDocumentItem(context.item).document, local.name)
        : await operations.checkNewDocumentName(kind, { kind: 'user' }, local.name)
      return nameCheckMessage(result)
    } catch {
      return t('documentLibrary.rename.checkFailed')
    }
  }, [operations, kind, nameCheckMessage, t])

  const checkProjectName = useCallback(async (name: string): Promise<string | null> => {
    const result = await operations.checkNewProjectName(name)
    if (result.status === 'duplicate') return t('documentLibrary.move.duplicateProject')
    return nameCheckMessage(result)
  }, [operations, nameCheckMessage, t])

  const confirmMove = useCallback(async (choice: MoveToProjectChoice): Promise<void> => {
    if (!moving) return
    const project = choice.kind === 'existing' ? choice.project : await operations.createProject(choice.name)
    // 选项目对话框先关（由它在成功后关闭），重名询问随后弹出
    await moveWithConflictPrompt(moving, { kind: 'project', projectId: project.id })
  }, [moving, operations, moveWithConflictPrompt])

  const canStandalone = operations.canStandalone(kind)
  const extraActions = useCallback((item: ProjectCardGridItem): ProjectCardGridExtraAction[] => {
    const document = asDocumentItem(item).document
    if (document.missing) {
      return [{
        id: 'forget',
        label: t('documentLibrary.actions.forget'),
        icon: <ListX className="h-4 w-4" />,
        onClick: () => { void run('forget', () => operations.forgetDocument(document.id)) },
      }]
    }
    const inProject = document.container.kind === 'project'
    return [
      { id: 'move-to-project', label: t('documentLibrary.actions.moveToProject'), icon: <FolderInput className="h-4 w-4" />, onClick: () => setMoving(document) },
      ...(inProject && canStandalone ? [{
        id: 'remove-from-project',
        label: t('documentLibrary.actions.removeFromProject'),
        icon: <FolderOutput className="h-4 w-4" />,
        onClick: () => { void run('move', () => moveWithConflictPrompt(document, { kind: 'user' })) },
      }] : []),
      {
        id: 'duplicate',
        label: t('documentLibrary.actions.duplicate'),
        icon: <Copy className="h-4 w-4" />,
        onClick: () => { void run('duplicate', async () => { await operations.duplicateDocument({ id: document.id, path: document.path }, 'keepBoth') }) },
      },
      {
        id: 'reveal',
        label: t('documentLibrary.actions.reveal'),
        icon: <FolderOpen className="h-4 w-4" />,
        quick: true,
        onClick: () => { void run('reveal', () => operations.revealDocument({ id: document.id, path: document.path })) },
      },
      {
        id: 'export-package',
        label: t('documentLibrary.actions.exportPackage'),
        icon: <PackageCheck className="h-4 w-4" />,
        onClick: () => {
          void run('exportPackage', async () => {
            setPackageStatus(t('documentLibrary.package.exporting'))
            const result = await exportDocumentPackageInteractive(document, operations)
            setPackageStatus(result ? (result.missingPaths.length
              ? t('documentLibrary.package.exportedMissing', { name: packageFileName(result), count: result.missingPaths.length })
              : t('documentLibrary.package.exported', { name: packageFileName(result) })) : null)
          })
        },
      },
      ...(inProject ? [{
        id: 'collect-media',
        label: t('documentLibrary.actions.collect'),
        icon: <PackagePlus className="h-4 w-4" />,
        onClick: () => {
          void run('collect', async () => {
            const result = await operations.collectDocumentMedia({ id: document.id, path: document.path })
            const copiedDocuments = result.copiedDocuments ?? 0
            const parts = [
              result.copiedFiles || copiedDocuments
                ? t('documentLibrary.collect.done', { files: result.copiedFiles, documents: copiedDocuments })
                : t('documentLibrary.collect.none'),
              result.missingPaths.length ? t('documentLibrary.collect.missing', { count: result.missingPaths.length }) : '',
            ]
            setPackageStatus(parts.filter(Boolean).join(' '))
          })
        },
      }] : []),
      ...(documentActions?.(document) ?? []),
    ]
  }, [t, canStandalone, run, moveWithConflictPrompt, operations, documentActions])

  // 打开别处的文档（4.4）：选文件后登记所在项目或文件夹为外部位置，再按本页的打开方式打开
  const openExternalFile = useCallback((): void => {
    void run('openFile', async () => {
      const extension = documentKindRegistry.require(kind).extension.slice(1)
      const selected = await openDialog({ multiple: false, filters: [{ name: kindName, extensions: [extension] }] })
      const filePath = typeof selected === 'string' ? selected : Array.isArray(selected) ? selected[0] : null
      if (!filePath) return
      const document = await operations.registerExternalDocument(filePath)
      await (onOpen ? onOpen(document) : operations.openDocument(document))
    })
  }, [run, kind, kindName, operations, onOpen])

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

  const pageLabels = useMemo((): ProjectLibraryLabels => ({
    createAction: t('documentLibrary.create', { kind: kindName }),
    count: (count) => t('documentLibrary.count', { count, kind: kindName }),
    searchPlaceholder: t('documentLibrary.searchPlaceholder', { kind: kindName }),
    noResults: t('documentLibrary.noResults', { kind: kindName }),
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
    dropHint: t('documentLibrary.dropHint'),
    createDialogTitle: t('documentLibrary.create', { kind: kindName }),
    renameDialogTitle: t('documentLibrary.rename.title'),
    defaultNewName: '',
    loadingMessage: t('documentLibrary.loading'),
    emptyTitle: t('documentLibrary.emptyTitle', { kind: kindName }),
    deleteTitle: t('documentLibrary.delete.title'),
    deleteConfirmSingle: (name) => t('documentLibrary.delete.confirmSingle', { name }),
    deleteConfirmMultiple: (count) => t('documentLibrary.delete.confirmMultiple', { count }),
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
    ...labelOverrides,
  }), [t, kindName, labelOverrides])

  const filterOptions = useMemo(() => [
    { value: documentLibraryFilterValue(ALL_DOCUMENTS_FILTER), label: t('documentLibrary.filter.all') },
    ...(canStandalone ? [{ value: 'standalone', label: t('documentLibrary.filter.standalone'), icon: FileIcon }] : []),
    ...library.projects.map((project) => ({ value: documentLibraryFilterValue({ kind: 'project', projectId: project.id }), label: project.name })),
  ], [t, canStandalone, library.projects])

  const loadError = library.error && library.items.length === 0
    ? { title: t('documentLibrary.loadFailed', { kind: kindName }), message: library.error.message, onRetry: () => { void library.reload() } }
    : undefined

  const currentProjectId = moving?.container.kind === 'project' ? moving.container.projectId : null

  return (
    <>
      <ProjectLibraryPage
        title={title}
        description={description}
        persistKey={`documents.${kind}`}
        items={library.items}
        drafts={draftItems}
        onDiscardDraft={async (item) => {
          setActionError(null)
          try {
            await leftover.discard(asDocumentItem(item).document)
          } catch (raw) {
            setActionError(t('documentSession.recovery.discardFailed', { message: toError(raw).message }))
          }
        }}
        icon={PageIcon}
        emptyIcon={<PageIcon size={40} strokeWidth={1.5} aria-hidden="true" />}
        loading={library.loading}
        loadError={loadError}
        busy={busy || working}
        labels={pageLabels}
        create={create}
        secondaryAction={[
          ...(secondaryAction ? [secondaryAction] : []),
          { label: t('documentLibrary.openFile'), icon: FileInput, onClick: openExternalFile },
          { label: t('documentLibrary.importPackage'), icon: PackageOpen, onClick: importPackage },
        ]}
        onDropFiles={onDropFiles}
        onBack={onBack}
        backLabel={backLabel}
        banner={(
          <>
            {actionError ? <p role="alert" className="mb-4 text-xs text-danger-text">{actionError}</p> : null}
            {packageStatus && !actionError ? <p role="status" className={`mb-4 ${UI_TEXT_META_CLASS}`} data-observation-sensitive>{packageStatus}</p> : null}
            {banner}
          </>
        )}
        // 只有存在项目时才有“按所属项目”可选（否则全部就是不在项目里）
        filter={library.projects.length > 0 ? {
          value: documentLibraryFilterValue(library.filter),
          defaultValue: documentLibraryFilterValue(ALL_DOCUMENTS_FILTER),
          options: filterOptions,
          label: t('documentLibrary.filterLabel'),
          onChange: (value) => library.setFilter(parseDocumentLibraryFilter(value)),
        } : undefined}
        canManage={(item) => !asDocumentItem(item).document.missing}
        extraActions={extraActions}
        onOpen={(item) => open(asDocumentItem(item).document)}
        validateName={validateName}
        onRename={async (item, name) => {
          const document = asDocumentItem(item).document
          setActionError(null)
          await operations.renameDocument({ id: document.id, path: document.path }, name)
        }}
        onDelete={async (items) => {
          await run('delete', async () => {
            for (const item of items) {
              const document = asDocumentItem(item).document
              if (document.missing) continue
              await operations.trashDocument({ id: document.id, path: document.path, name: document.name })
            }
          })
        }}
      />

      {moving ? (
        <MoveToProjectDialog
          documentName={moving.name}
          projects={library.projects.filter((project) => project.id !== currentProjectId)}
          checkProjectName={checkProjectName}
          onConfirm={confirmMove}
          onClose={() => setMoving(null)}
        />
      ) : null}

      {conflict ? (
        <AlertDialog
          isOpen
          type="warning"
          title={t('documentLibrary.conflict.title', { name: conflict.name })}
          message={t('documentLibrary.conflict.message')}
          closeLabel={t('documentLibrary.conflict.cancel')}
          closeImmediately
          onClose={() => setConflict(null)}
          actions={[{
            label: t('documentLibrary.conflict.keepBoth'),
            variant: 'primary',
            onClick: () => {
              const pending = conflict
              setConflict(null)
              void run('move', pending.retry)
            },
          }]}
        />
      ) : null}
    </>
  )
}
