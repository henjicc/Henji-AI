import { useTranslation } from 'react-i18next'

import { AlertDialog } from '@/components/ui'

import { DocumentSaveNameDialog } from './DocumentSaveNameDialog'
import { useDocumentPromptStore, type DocumentPromptRequest } from './documentPromptStore'

/*
 * 文档会话的提示宿主：在应用根层挂载一次，按队列逐个渲染
 * “保存 / 不保存 / 取消”、起名对话框与“重新载入 / 覆盖”。
 */

function LeavePrompt({ request }: { request: Extract<DocumentPromptRequest, { type: 'leave' }> }): JSX.Element {
  const { t } = useTranslation('ui')
  const isProject = request.info.subject === 'project'
  return (
    <AlertDialog
      isOpen
      type="warning"
      title={t('documentSession.leave.title', { name: request.info.name })}
      message={t(isProject ? 'documentSession.leave.messageProject' : 'documentSession.leave.messageDocument')}
      closeLabel={t('documentSession.leave.cancel')}
      closeImmediately
      onClose={() => request.resolve('cancel')}
      actions={[
        { label: t('documentSession.leave.discard'), tone: 'danger', onClick: () => request.resolve('discard') },
        { label: t('documentSession.leave.save'), variant: 'primary', onClick: () => request.resolve('save') },
      ]}
    />
  )
}

function ConflictPrompt({ request }: { request: Extract<DocumentPromptRequest, { type: 'conflict' }> }): JSX.Element {
  const { t } = useTranslation('ui')
  return (
    <AlertDialog
      isOpen
      type="warning"
      title={t('documentSession.conflict.title')}
      message={t('documentSession.conflict.message', { name: request.info.name })}
      closeLabel={t('documentSession.conflict.later')}
      closeImmediately
      onClose={() => request.resolve('later')}
      actions={[
        { label: t('documentSession.conflict.overwrite'), tone: 'danger', onClick: () => request.resolve('overwrite') },
        { label: t('documentSession.conflict.reload'), variant: 'primary', onClick: () => request.resolve('reload') },
      ]}
    />
  )
}

export function DocumentSessionDialogs(): JSX.Element | null {
  const current = useDocumentPromptStore((state) => state.queue[0])
  if (!current) return null
  switch (current.type) {
    case 'leave':
      return <LeavePrompt key={current.key} request={current} />
    case 'conflict':
      return <ConflictPrompt key={current.key} request={current} />
    case 'saveName':
      return <DocumentSaveNameDialog key={current.key} info={current.info} onDone={current.resolve} />
  }
}
