import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Files } from 'lucide-react'
import { PanelTrigger, UiIconButton, UI_TEXT_META_CLASS } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import type { DocumentSummary } from '@/core/documents/types'
import { createLogger } from '@/core/logging/logger'
import { toError } from '@/features/documents/documentErrors'
import { documentKindPresentation } from '@/features/documents/documentKindPresentation'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import type { VideoEditInstance } from '../application/videoEditService'

/*
 * 剪辑项目面板里“本项目里的其他文档”（3.1）：只读列出同一项目文件夹里的画布、口播、镜头参考、图片文档
 * 与其他剪辑，让用户知道项目里有什么。在剪辑里新建 / 打开这些文档、嵌入模式与回到来源由 4.1 接上。
 * 打开下拉时才读取（作品索引），不常驻轮询。
 */

const logger = createLogger('features.videoEdit.projectDocuments')

function OtherDocumentsList({ instance }: { instance: VideoEditInstance }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null)
  const container = instance.session.documentMeta.container
  const projectId = container.kind === 'project' ? container.projectId : null
  const selfId = instance.document.id
  useEffect(() => {
    if (!projectId) { setDocuments([]); return }
    let cancelled = false
    getDocumentOperations().listDocuments({ container: { kind: 'project', projectId }, includeDrafts: true, includeMissing: true })
      .then(listed => { if (!cancelled) setDocuments(listed.filter(document => document.id !== selfId)) })
      .catch((raw: unknown) => {
        logger.warn('读取项目里的文档失败', { event: 'video_edit.project_documents.list.failed', error: toError(raw) })
        if (!cancelled) setDocuments([])
      })
    return () => { cancelled = true }
  }, [projectId, selfId])
  if (documents === null) return <p className={`px-2 py-1.5 ${UI_TEXT_META_CLASS}`}>{t('documentLibrary.loading')}</p>
  return <div className="flex flex-col gap-0.5" role="list" aria-label={t('videoEditProject.otherDocuments')}>
    <p className={`px-2 pb-1 pt-1.5 ${UI_TEXT_META_CLASS}`}>{t('videoEditProject.otherDocuments')}</p>
    {!documents.length ? <p className="px-2 pb-1.5 text-xs text-text2">{t('videoEditProject.otherDocumentsEmpty')}</p> : documents.map(document => {
      const presentation = documentKindPresentation(document.kind)
      const Icon = presentation.icon
      return <div key={document.id} role="listitem" className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-xs text-text1">
        <Icon size={14} className="shrink-0 text-text3" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" data-observation-sensitive>{document.name}</span>
        <span className="shrink-0 text-2xs text-text3">{document.missing ? t('videoEditProject.otherDocumentsMissing') : t(presentation.nameKey)}</span>
      </div>
    })}
  </div>
}

export function VideoEditProjectDocumentsButton({ instance }: { instance: VideoEditInstance }): React.ReactElement {
  const { t } = useTranslation('ui')
  return <PanelTrigger panelWidth={240} zIndex={Z_LAYERS.dropdown} panelPadding="menu" renderPanel={() => <OtherDocumentsList instance={instance} />}>
    {({ open, togglePanel }) => <UiIconButton aria-label={t('videoEditProject.otherDocuments')} title={t('videoEditProject.otherDocuments')} aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><Files size={15} /></UiIconButton>}
  </PanelTrigger>
}
