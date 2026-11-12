import { useTranslation } from 'react-i18next'

import type { DocumentSession } from './documentSession'
import { useDocumentSessionState } from './useDocumentSessionState'

/**
 * 编辑器左上角文件名后面的保存状态。改动一律实时写盘，草稿也已经写在它所在的文件夹里，
 * 正常的“已保存 / 保存中 / 还没起名”都不显示；只在需要用户处理时出现：写入失败、文件被别处改过。
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
      : [null, '']
  if (!label) return null
  return <span data-document-save-status={state.status} className={`shrink-0 whitespace-nowrap text-xs ${tone}`}>{label}</span>
}
