import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Files, FolderSearch, PackageOpen, Plus } from 'lucide-react'
import { PanelTrigger, UiButton, UiIconButton, UiModal, UiOptionButton, UI_DIVIDER_CLASS, UI_TEXT_META_CLASS, UI_TEXT_SECONDARY_CLASS } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import type { DocumentSummary } from '@/core/documents/types'
import { createLogger } from '@/core/logging/logger'
import { toError } from '@/features/documents/documentErrors'
import { documentKindPresentation } from '@/features/documents/documentKindPresentation'
import { importPackageInteractive } from '@/features/documents/documentPackageActions'
import type { VideoEditInstance } from '../application/videoEditService'
import { videoEditDocumentOperations } from '../application/videoEditService'
import {
  bringDocumentIntoVideoEditProject,
  createDocumentInVideoEdit,
  listVideoEditReferencedDocuments,
  openDocumentFromVideoEdit,
  VIDEO_EDIT_COMPOSABLE_KINDS,
  type VideoEditReferencedDocument,
} from '../application/videoEditComposition'

/*
 * 剪辑素材面板的“项目文档”（4.1 自由组合）：
 * - 本项目里的文档：点一下以嵌入模式打开（工具命令带左端“返回剪辑 · 项目名”）；其他剪辑直接切过去。
 * - 来自其他位置：片段引用的、不在本项目里的文档，标出“来自其他位置”（“收集素材”会把它们复制进项目）。
 * - 新建画布 / 口播 / 镜头参考 / 图片文档（草稿建在本项目里，嵌入模式打开）、打开其他位置的文档…、导入单个文件…。
 * 打开下拉时才读取（作品索引与片段来源），不常驻轮询。
 */

const logger = createLogger('features.videoEdit.projectDocuments')

interface PanelData {
  inProject: DocumentSummary[]
  elsewhere: VideoEditReferencedDocument[]
}

function DocumentRow({ document, meta, onOpen }: { document: DocumentSummary; meta: string; onOpen: () => void }): React.ReactElement {
  const presentation = documentKindPresentation(document.kind)
  const Icon = presentation.icon
  return <UiOptionButton variant="menu" size="sm" className="w-full min-w-0 gap-2" disabled={document.missing} onClick={onOpen} data-video-edit-project-document={document.id}>
    <Icon size={14} className="shrink-0 text-text3" aria-hidden="true" />
    <span className="min-w-0 flex-1 truncate text-left" data-observation-sensitive>{document.name}</span>
    <span className="shrink-0 text-2xs text-text3">{meta}</span>
  </UiOptionButton>
}

function ProjectDocumentsPanel({ instance, onError, onOpenElsewhere, onImport }: { instance: VideoEditInstance; onError: (reason: unknown) => void; onOpenElsewhere: () => void; onImport: () => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [data, setData] = useState<PanelData | null>(null)
  const container = instance.session.documentMeta.container
  const projectId = container.kind === 'project' ? container.projectId : null
  const selfId = instance.document.id
  useEffect(() => {
    if (!projectId) { setData({ inProject: [], elsewhere: [] }); return }
    let cancelled = false
    Promise.all([
      videoEditDocumentOperations().listDocuments({ container: { kind: 'project', projectId }, includeDrafts: true, includeMissing: true }),
      listVideoEditReferencedDocuments(selfId),
    ]).then(([listed, referenced]) => {
      if (!cancelled) setData({ inProject: listed.filter(document => document.id !== selfId), elsewhere: referenced.filter(entry => entry.elsewhere || !entry.document) })
    }).catch((raw: unknown) => {
      logger.warn('读取项目里的文档失败', { event: 'video_edit.project_documents.list.failed', error: toError(raw) })
      if (!cancelled) setData({ inProject: [], elsewhere: [] })
    })
    return () => { cancelled = true }
  }, [projectId, selfId])
  const run = (operation: () => Promise<unknown>): void => { void operation().catch(onError) }
  const open = (document: DocumentSummary): void => run(async () => {
    // 其他剪辑直接切过去（剪辑不嵌入剪辑）；其余以嵌入模式打开
    if (document.kind === 'video_edit') await videoEditDocumentOperations().openDocument(document)
    else await openDocumentFromVideoEdit(selfId, document)
  })
  if (data === null) return <p className={`px-2 py-1.5 ${UI_TEXT_META_CLASS}`}>{t('documentLibrary.loading')}</p>
  return <div className="flex flex-col gap-0.5" aria-label={t('videoEditProject.documents.title')}>
    <p className={`px-2 pb-1 pt-1.5 ${UI_TEXT_META_CLASS}`}>{t('videoEditProject.otherDocuments')}</p>
    {!data.inProject.length ? <p className="px-2 pb-1.5 text-xs text-text2">{t('videoEditProject.otherDocumentsEmpty')}</p> : data.inProject.map(document => (
      <DocumentRow key={document.id} document={document} meta={document.missing ? t('videoEditProject.otherDocumentsMissing') : t(documentKindPresentation(document.kind).nameKey)} onOpen={() => open(document)} />
    ))}
    {data.elsewhere.length ? <>
      <p className={`px-2 pb-1 pt-2 ${UI_TEXT_META_CLASS}`}>{t('videoEditProject.documents.elsewhere')}</p>
      {data.elsewhere.map(entry => entry.document
        ? <DocumentRow key={entry.docRef.docId} document={entry.document} meta={t('videoEditProject.documents.fromElsewhere')} onOpen={() => open(entry.document!)} />
        : <p key={entry.docRef.docId} className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-xs text-text2">
          <span className="min-w-0 flex-1 truncate" data-observation-sensitive>{entry.docRef.path.slice(Math.max(entry.docRef.path.lastIndexOf('/'), entry.docRef.path.lastIndexOf('\\')) + 1)}</span>
          <span className="shrink-0 text-2xs text-text3">{t('videoEditProject.otherDocumentsMissing')}</span>
        </p>)}
    </> : null}
    <div className={`my-1 ${UI_DIVIDER_CLASS}`} />
    {VIDEO_EDIT_COMPOSABLE_KINDS.map(kind => (
      <UiOptionButton key={kind} variant="menu" size="sm" className="w-full gap-2" data-video-edit-create-document={kind} onClick={() => run(() => createDocumentInVideoEdit(selfId, kind))}>
        <Plus size={14} className="shrink-0" aria-hidden="true" />{t('documentLibrary.create', { kind: t(documentKindPresentation(kind).nameKey) })}
      </UiOptionButton>
    ))}
    <UiOptionButton variant="menu" size="sm" className="w-full gap-2" onClick={onOpenElsewhere}><FolderSearch size={14} className="shrink-0" aria-hidden="true" />{t('videoEditProject.documents.openElsewhere')}</UiOptionButton>
    <UiOptionButton variant="menu" size="sm" className="w-full gap-2" onClick={onImport}><PackageOpen size={14} className="shrink-0" aria-hidden="true" />{t('documentLibrary.importPackage')}</UiOptionButton>
  </div>
}

/**
 * 打开其他位置的文档：列出不在本项目里的画布、口播、镜头参考、图片文档（别的项目、作品目录、外部位置），
 * 选一份后打开（嵌入模式）、移进本项目或复制进本项目（新 ID，用到的素材一并复制）。
 */
function OtherLocationDocumentsDialog({ instance, onClose, onError, onNotice }: { instance: VideoEditInstance; onClose: () => void; onError: (reason: unknown) => void; onNotice: (message: string) => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const container = instance.session.documentMeta.container
  const projectId = container.kind === 'project' ? container.projectId : null
  useEffect(() => {
    let cancelled = false
    videoEditDocumentOperations().listDocuments({ container: { kind: 'any' }, includeDrafts: false, includeMissing: false })
      .then(listed => {
        if (cancelled) return
        const others = listed.filter(document => VIDEO_EDIT_COMPOSABLE_KINDS.includes(document.kind) && !(document.container.kind === 'project' && document.container.projectId === projectId))
        setDocuments(others)
        setSelected(others[0]?.id ?? null)
      })
      .catch((raw: unknown) => { if (!cancelled) { setDocuments([]); onError(raw) } })
    return () => { cancelled = true }
  }, [projectId, onError])
  const chosen = useMemo(() => documents?.find(document => document.id === selected) ?? null, [documents, selected])
  const act = useCallback(async (action: 'open' | 'move' | 'copy'): Promise<void> => {
    if (!chosen) return
    setWorking(true)
    try {
      if (action === 'open') await openDocumentFromVideoEdit(instance.document.id, chosen)
      else {
        const meta = await bringDocumentIntoVideoEditProject(instance.document.id, chosen, action)
        onNotice(t(action === 'move' ? 'videoEditProject.documents.moved' : 'videoEditProject.documents.copied', { name: meta.name }))
      }
      onClose()
    } catch (raw) {
      onError(raw)
      setWorking(false)
    }
  }, [chosen, instance.document.id, onClose, onError, onNotice, t])
  const location = (document: DocumentSummary): string => document.projectName ?? t('documentLibrary.location.standalone')
  return <UiModal isOpen title={t('videoEditProject.documents.openElsewhereTitle')} onClose={() => { if (!working) onClose() }} size="compact" footer={<>
    <UiButton variant="secondary" disabled={working} onClick={onClose}>{t('documentLibrary.move.cancel')}</UiButton>
    <UiButton variant="secondary" disabled={working || !chosen} onClick={() => void act('copy')}>{t('videoEditProject.documents.copyIn')}</UiButton>
    <UiButton variant="secondary" disabled={working || !chosen} onClick={() => void act('move')}>{t('videoEditProject.documents.moveIn')}</UiButton>
    <UiButton variant="primary" disabled={working || !chosen} onClick={() => void act('open')}>{t('documentLibrary.card.open')}</UiButton>
  </>}>
    {documents === null ? <p className={UI_TEXT_SECONDARY_CLASS}>{t('documentLibrary.loading')}</p>
      : !documents.length ? <p className={UI_TEXT_SECONDARY_CLASS}>{t('videoEditProject.documents.noOthers')}</p>
        : <div role="listbox" aria-label={t('videoEditProject.documents.openElsewhereTitle')} className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {documents.map(document => {
            const Icon = documentKindPresentation(document.kind).icon
            return <UiOptionButton key={document.id} role="option" variant="menu" aria-selected={selected === document.id} active={selected === document.id} disabled={working} className="w-full min-w-0 gap-2" onClick={() => setSelected(document.id)} onDoubleClick={() => { setSelected(document.id); void act('open') }}>
              <Icon size={14} className="shrink-0 text-text3" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left" data-observation-sensitive>{document.name}</span>
              <span className="shrink-0 text-2xs text-text3" data-observation-sensitive>{t(documentKindPresentation(document.kind).nameKey)} · {location(document)}</span>
            </UiOptionButton>
          })}
        </div>}
  </UiModal>
}

export function VideoEditProjectDocumentsButton({ instance, onError, onNotice }: { instance: VideoEditInstance; onError: (reason: unknown) => void; onNotice?: (message: string) => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [elsewhereOpen, setElsewhereOpen] = useState(false)
  const container = instance.session.documentMeta.container
  const notice = onNotice ?? ((message: string) => logger.info(message, { event: 'video_edit.project_documents.notice' }))
  const importIntoProject = (): void => {
    if (container.kind !== 'project') return
    void importPackageInteractive(container, videoEditDocumentOperations()).then(result => {
      if (!result) return
      notice(result.type === 'project'
        ? t('documentLibrary.package.importedProject', { name: result.project.name })
        : t('documentLibrary.package.importedDocument', { name: result.meta.name }))
    }).catch(onError)
  }
  return <>
    <PanelTrigger panelWidth={260} zIndex={Z_LAYERS.dropdown} panelPadding="menu" closeOnPanelClick renderPanel={() => <ProjectDocumentsPanel instance={instance} onError={onError} onOpenElsewhere={() => setElsewhereOpen(true)} onImport={importIntoProject} />}>
      {({ open, togglePanel }) => <UiIconButton aria-label={t('videoEditProject.documents.title')} title={t('videoEditProject.documents.title')} aria-expanded={open} data-panel-trigger-button data-video-edit-project-documents onClick={togglePanel}><Files size={15} /></UiIconButton>}
    </PanelTrigger>
    {elsewhereOpen ? <OtherLocationDocumentsDialog instance={instance} onClose={() => setElsewhereOpen(false)} onError={onError} onNotice={notice} /> : null}
  </>
}
