import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import type { ProjectCardGridItem } from '@/components/ProjectCardGrid'
import { entryNameKey } from '@/core/documents/naming'
import type { DocumentContainerFilter, DocumentKindId, DocumentSummary, ProjectSummary } from '@/core/documents/types'
import { createLogger } from '@/core/logging/logger'

import { toError } from './documentErrors'
import { getDocumentOperations, type DocumentOperations } from './documentOperations'
import { parentFolderOf } from './documentSessionRegistry'

/*
 * 项目页的通用数据源（存储底座 2.5，实施方案 2.10、重要记录 011）：
 * - 文档：按类型列出全部同类文档（含项目里的），可按“全部 / 不在项目里 / 某个项目”筛选；
 *   这里只列已保存的文档；遗留草稿由 useLeftoverDocumentDrafts 单独取，项目页把它们带标记排在最前，避免同一草稿出现两次。
 * - 项目：剪辑页用的项目列表。
 * 打开页面时先按持久化索引列出，再 refreshIndex() 扫描后刷新；通用操作（页面或助手）写入后自动刷新。
 */

const logger = createLogger('features.documents.library')

export type DocumentLibraryFilter =
  | { kind: 'all' }
  | { kind: 'standalone' }
  | { kind: 'project'; projectId: string }

export const ALL_DOCUMENTS_FILTER: DocumentLibraryFilter = { kind: 'all' }

export function documentLibraryFilterToContainer(filter: DocumentLibraryFilter): DocumentContainerFilter {
  if (filter.kind === 'all') return { kind: 'any' }
  if (filter.kind === 'standalone') return { kind: 'user' }
  return { kind: 'project', projectId: filter.projectId }
}

/** 下拉选项值与筛选互转（下拉只认字符串）。 */
export function documentLibraryFilterValue(filter: DocumentLibraryFilter): string {
  return filter.kind === 'project' ? `project:${filter.projectId}` : filter.kind
}

export function parseDocumentLibraryFilter(value: string): DocumentLibraryFilter {
  if (value === 'standalone') return { kind: 'standalone' }
  if (value.startsWith('project:')) return { kind: 'project', projectId: value.slice('project:'.length) }
  return ALL_DOCUMENTS_FILTER
}

/** 卡片项：保留文档摘要，右键操作据此定位。 */
export interface DocumentCardItem extends ProjectCardGridItem {
  document: DocumentSummary
}

export interface DocumentCardFormatOptions {
  t: TFunction
  /** 类型专属的元信息（如“12 个对象”）；省略时只显示位置与时间。 */
  describe?: (document: DocumentSummary) => string | undefined
  formatTime?: (time: number) => string
}

/** 所在位置的说法：项目名；不在项目里的外部文档显示所在文件夹；其余“不在项目里”。 */
export function documentLocationLabel(document: DocumentSummary, t: TFunction): string {
  if (document.projectName) return document.projectName
  if (document.external) return parentFolderOf(document.path)
  return t('documentLibrary.location.standalone')
}

/**
 * 文档摘要 → 卡片项。卡片标出所属项目；同名（不分大小写）的文档都显示所在位置以便区分；
 * 文件找不到时以危险色显示“文件不存在”。
 */
export function toDocumentCardItems(documents: readonly DocumentSummary[], options: DocumentCardFormatOptions): DocumentCardItem[] {
  const formatTime = options.formatTime ?? ((time: number) => new Date(time).toLocaleDateString())
  const nameCounts = new Map<string, number>()
  for (const document of documents) {
    const key = entryNameKey(document.name)
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  return documents.map((document) => {
    const duplicated = (nameCounts.get(entryNameKey(document.name)) ?? 0) > 1
    const detail = options.describe?.(document)
    const parts = [
      document.projectName || duplicated ? documentLocationLabel(document, options.t) : null,
      detail ?? null,
      formatTime(document.updatedAt),
    ].filter((part): part is string => Boolean(part))
    return {
      id: document.id,
      name: document.name,
      metaLine: parts.join(' · '),
      ...(detail ? { detail } : {}),
      location: documentLocationLabel(document, options.t),
      ...(document.missing ? {} : { sizeBytes: document.sizeBytes }),
      ...(document.missing ? { status: options.t('documentLibrary.status.missing') } : {}),
      coverPath: document.coverPath,
      updatedAt: document.updatedAt,
      createdAt: document.createdAt,
      document,
    }
  })
}

export interface UseDocumentLibraryOptions {
  kind: DocumentKindId
  describe?: (document: DocumentSummary) => string | undefined
  operations?: DocumentOperations
}

export interface DocumentLibraryState {
  items: DocumentCardItem[]
  /** 可选作筛选与“移到项目”目标的项目（已保存、文件夹在）。 */
  projects: ProjectSummary[]
  filter: DocumentLibraryFilter
  setFilter: (filter: DocumentLibraryFilter) => void
  /** 只在第一次读取时为 true；之后的刷新不闪加载态。 */
  loading: boolean
  error: Error | null
  reload: () => Promise<void>
}

/** 一页的文档列表：先列出索引里的，再扫描刷新；通用操作写入后自动重读。 */
export function useDocumentLibrary({ kind, describe, operations: provided }: UseDocumentLibraryOptions): DocumentLibraryState {
  const { t } = useTranslation('ui')
  const operations = provided ?? getDocumentOperations()
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [filter, setFilter] = useState<DocumentLibraryFilter>(ALL_DOCUMENTS_FILTER)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const sequence = useRef(0)
  const filterKey = documentLibraryFilterValue(filter)

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++sequence.current
    try {
      const [listed, projectList] = await Promise.all([
        operations.listDocuments({ kind, container: documentLibraryFilterToContainer(parseDocumentLibraryFilter(filterKey)), includeDrafts: false, includeMissing: true }),
        operations.listProjects({ includeDrafts: false, includeMissing: false }),
      ])
      if (seq !== sequence.current) return
      setDocuments(listed)
      setProjects(projectList)
      setError(null)
    } catch (raw) {
      if (seq !== sequence.current) return
      const failure = toError(raw)
      logger.warn('读取文档列表失败', { event: 'documents.library.list.failed', error: failure, context: { kind } })
      setError(failure)
    } finally {
      if (seq === sequence.current) setLoading(false)
    }
  }, [operations, kind, filterKey])

  // 打开页面：先列出索引里的（下一个 effect），同时扫描一次；扫描有变化时经订阅自动重读。
  // 扫描失败只记日志，列表照常可用。
  useEffect(() => {
    operations.refreshIndex().catch((raw: unknown) => {
      logger.warn('刷新作品索引失败', { event: 'documents.library.refresh.failed', error: toError(raw), context: { kind } })
    })
  }, [operations, kind])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => operations.subscribe(() => { void reload() }), [operations, reload])

  // 所选项目被删除或改成别处后回到“全部”
  useEffect(() => {
    if (filter.kind === 'project' && !loading && !projects.some((project) => project.id === filter.projectId)) setFilter(ALL_DOCUMENTS_FILTER)
  }, [filter, projects, loading])

  const items = useMemo(() => toDocumentCardItems(documents, { t, describe }), [documents, t, describe])
  return { items, projects, filter, setFilter, loading, error, reload }
}

/** 项目卡片项。 */
export interface ProjectCardItem extends ProjectCardGridItem {
  project: ProjectSummary
}

export function toProjectCardItems(projects: readonly ProjectSummary[], t: TFunction): ProjectCardItem[] {
  const nameCounts = new Map<string, number>()
  for (const project of projects) nameCounts.set(entryNameKey(project.name), (nameCounts.get(entryNameKey(project.name)) ?? 0) + 1)
  return projects.map((project) => {
    const duplicated = (nameCounts.get(entryNameKey(project.name)) ?? 0) > 1
    const detail = t('documentLibrary.projectDocumentCount', { count: project.documentCount })
    const parts = [
      duplicated ? parentFolderOf(project.path) : null,
      detail,
      new Date(project.createdAt).toLocaleDateString(),
    ].filter((part): part is string => Boolean(part))
    return {
      id: project.id,
      name: project.name,
      metaLine: parts.join(' · '),
      detail,
      ...(project.missing ? { status: t('documentLibrary.status.missingFolder') } : {}),
      createdAt: project.createdAt,
      project,
    }
  })
}

export interface ProjectLibraryState {
  items: ProjectCardItem[]
  loading: boolean
  error: Error | null
  reload: () => Promise<void>
}

/** 项目列表（剪辑页用）：已保存的项目，含找不到文件夹的外部项目；草稿项目由 useLeftoverDraftProjects 单独取。 */
export function useProjectLibrary(options: { operations?: DocumentOperations } = {}): ProjectLibraryState {
  const { t } = useTranslation('ui')
  const operations = options.operations ?? getDocumentOperations()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const sequence = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++sequence.current
    try {
      const listed = await operations.listProjects({ includeDrafts: false, includeMissing: true })
      if (seq !== sequence.current) return
      setProjects(listed)
      setError(null)
    } catch (raw) {
      if (seq !== sequence.current) return
      const failure = toError(raw)
      logger.warn('读取项目列表失败', { event: 'documents.library.projects.failed', error: failure })
      setError(failure)
    } finally {
      if (seq === sequence.current) setLoading(false)
    }
  }, [operations])

  useEffect(() => {
    operations.refreshIndex().catch((raw: unknown) => {
      logger.warn('刷新作品索引失败', { event: 'documents.library.refresh.failed', error: toError(raw) })
    })
  }, [operations])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => operations.subscribe(() => { void reload() }), [operations, reload])

  const items = useMemo(() => toProjectCardItems(projects, t), [projects, t])
  return { items, loading, error, reload }
}
