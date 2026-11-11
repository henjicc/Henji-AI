import { useTranslation } from 'react-i18next'

import type { DocumentSession } from './documentSession'
import { useDocumentSessionState } from './useDocumentSessionState'

/**
 * 编辑器左上角文件名后面的保存状态：还没保存到位置的草稿写“未保存”（提示色），
 * 写入失败与文件被别处改过用危险色，其余是第三档的“已保存 / 保存中…”。
 * 失败的原因与重试由各编辑器的报错入口负责，这里只说明状态。
 */
export function DocumentSaveStatus({ session }: { session: DocumentSession | null | undefined }): JSX.Element | null {
  const { t } = useTranslation('ui')
  const state = useDocumentSessionState(session)
  if (!state || state.status === 'closed') return null
  const [label, tone] = state.status === 'failed'
    ? [t('documentSession.status.failed'), 'text-danger-text']
    : state.status === 'conflict'
      ? [t('documentSession.status.conflict'), 'text-danger-text']
      : state.meta.draft
        ? [t('documentSession.status.draft'), 'text-warning-text']
        : state.status === 'saved'
          ? [t('documentSession.status.saved'), 'text-text3']
          : [t('documentSession.status.saving'), 'text-text3']
  return <span data-document-save-status={state.status} className={`shrink-0 whitespace-nowrap text-xs ${tone}`}>{label}</span>
}
