import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiGroup, UiPanel, UI_TEXT_META_CLASS, UI_TEXT_PANEL_TITLE_CLASS } from '@/components/ui'
import type { DocumentContainerFilter, DocumentKindId, DocumentSummary } from '@/core/documents/types'
import { createLogger } from '@/core/logging/logger'

import { toError } from './documentErrors'
import { getDocumentSessionRegistry, type DocumentSessionRegistry } from './documentSessionRegistry'

/*
 * 意外退出留下的草稿（重要记录 007）：放进各工具的项目页，列出该类型尚未保存、当前没打开的草稿。
 * 恢复 = 交给页面打开它（继续编辑，离开时照常询问保存）；丢弃 = 移到回收站。
 * 没有遗留草稿时不渲染任何内容。
 */

const logger = createLogger('features.documents.recovery')

export interface DocumentDraftRecoveryNoticeProps {
  kind: DocumentKindId
  container?: DocumentContainerFilter
  /** 页面打开这份草稿（与打开普通文档同一入口）。 */
  onRecover: (draft: DocumentSummary) => void
  registry?: DocumentSessionRegistry
}

export function DocumentDraftRecoveryNotice({ kind, container, onRecover, registry: providedRegistry }: DocumentDraftRecoveryNoticeProps): JSX.Element | null {
  const { t, i18n } = useTranslation('ui')
  const registry = providedRegistry ?? getDocumentSessionRegistry()
  const [drafts, setDrafts] = useState<DocumentSummary[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerKey = JSON.stringify(container ?? null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setDrafts(await registry.listLeftoverDrafts({ kind, ...(container ? { container } : {}) }))
    } catch (raw) {
      logger.warn('读取遗留草稿失败', { event: 'documents.recovery.list.failed', error: toError(raw), context: { kind } })
    }
    // containerKey 代替对象引用参与比较
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, kind, containerKey])

  useEffect(() => {
    void load()
    return registry.subscribe(() => { void load() })
  }, [registry, load])

  if (!drafts.length) return null

  const discard = async (draft: DocumentSummary): Promise<void> => {
    setBusyId(draft.id)
    setError(null)
    try {
      await registry.discardLeftoverDraft(draft)
      setDrafts((current) => current.filter((item) => item.id !== draft.id))
    } catch (raw) {
      setError(t('documentSession.recovery.discardFailed', { message: toError(raw).message }))
    } finally {
      setBusyId(null)
    }
  }

  const formatTime = (time: number): string => new Date(time).toLocaleString(i18n.language, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <UiGroup
      title={t('documentSession.recovery.title', { count: drafts.length })}
      description={t('documentSession.recovery.description')}
    >
      <UiPanel variant="inset" className="flex flex-col py-1">
        {drafts.map((draft) => (
          <div key={draft.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className={`truncate ${UI_TEXT_PANEL_TITLE_CLASS}`}>{draft.name}</div>
              <div className={UI_TEXT_META_CLASS}>
                {draft.projectName
                  ? t('documentSession.recovery.metaInProject', { time: formatTime(draft.updatedAt), project: draft.projectName })
                  : t('documentSession.recovery.meta', { time: formatTime(draft.updatedAt) })}
              </div>
            </div>
            <UiButton type="button" variant="danger" size="sm" disabled={busyId === draft.id} onClick={() => void discard(draft)}>
              {t('documentSession.recovery.discard')}
            </UiButton>
            <UiButton type="button" variant="secondary" size="sm" disabled={busyId === draft.id} onClick={() => onRecover(draft)}>
              {t('documentSession.recovery.recover')}
            </UiButton>
          </div>
        ))}
      </UiPanel>
      {error ? <p role="alert" className="mt-1.5 text-xs text-danger-text">{error}</p> : null}
    </UiGroup>
  )
}
