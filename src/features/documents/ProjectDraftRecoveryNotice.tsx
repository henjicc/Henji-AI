import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiGroup, UiPanel, UI_TEXT_META_CLASS, UI_TEXT_PANEL_TITLE_CLASS } from '@/components/ui'
import type { ProjectSummary } from '@/core/documents/types'
import { createLogger } from '@/core/logging/logger'

import { toError } from './documentErrors'
import { getDocumentSessionRegistry, type DocumentSessionRegistry } from './documentSessionRegistry'

/*
 * 意外退出留下的草稿项目（重要记录 007、012；3.1 剪辑页）：与 DocumentDraftRecoveryNotice 同一套样式，
 * 列出尚未保存、当前没有打开文档的草稿项目。恢复 = 交给页面打开（继续编辑，离开时照常询问保存）；
 * 丢弃 = 整个项目文件夹移到回收站。没有遗留草稿项目时不渲染任何内容。
 */

const logger = createLogger('features.documents.recovery')

export interface ProjectDraftRecoveryNoticeProps {
  /** 页面打开这个草稿项目（与打开普通项目同一入口）。 */
  onRecover: (project: ProjectSummary) => void
  registry?: DocumentSessionRegistry
}

export function ProjectDraftRecoveryNotice({ onRecover, registry: providedRegistry }: ProjectDraftRecoveryNoticeProps): JSX.Element | null {
  const { t, i18n } = useTranslation('ui')
  const registry = providedRegistry ?? getDocumentSessionRegistry()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setProjects(await registry.listLeftoverDraftProjects())
    } catch (raw) {
      logger.warn('读取遗留草稿项目失败', { event: 'documents.recovery.projects.failed', error: toError(raw) })
    }
  }, [registry])

  useEffect(() => {
    void load()
    return registry.subscribe(() => { void load() })
  }, [registry, load])

  if (!projects.length) return null

  const discard = async (project: ProjectSummary): Promise<void> => {
    setBusyId(project.id)
    setError(null)
    try {
      await registry.discardLeftoverDraftProject(project.id)
      setProjects((current) => current.filter((item) => item.id !== project.id))
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
      title={t('documentSession.recovery.projectTitle', { count: projects.length })}
      description={t('documentSession.recovery.projectDescription')}
    >
      <UiPanel variant="inset" className="flex flex-col py-1">
        {projects.map((project) => (
          <div key={project.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className={`truncate ${UI_TEXT_PANEL_TITLE_CLASS}`}>{project.name}</div>
              <div className={UI_TEXT_META_CLASS}>{t('documentSession.recovery.projectMeta', { time: formatTime(project.createdAt) })}</div>
            </div>
            <UiButton type="button" variant="danger" size="sm" disabled={busyId === project.id} onClick={() => void discard(project)}>
              {t('documentSession.recovery.discard')}
            </UiButton>
            <UiButton type="button" variant="secondary" size="sm" disabled={busyId === project.id} onClick={() => onRecover(project)}>
              {t('documentSession.recovery.recover')}
            </UiButton>
          </div>
        ))}
      </UiPanel>
      {error ? <p role="alert" className="mt-1.5 text-xs text-danger-text">{error}</p> : null}
    </UiGroup>
  )
}
