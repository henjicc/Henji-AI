/** @vitest-environment jsdom */

import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import type { DocumentKindDescriptor } from '@/core/documents/kinds'

import { DocumentOperations } from './documentOperations'
import { createTestRegistry, testDocumentKind } from './documentSessionTestKit'
import { useDocumentLibrary, useProjectLibrary } from './useDocumentLibrary'

/*
 * 项目列表数据源（剪辑页用，存储底座 2.5）：列出已保存的项目，打开时扫描一次，通用操作写入后自动刷新。
 */

beforeAll(async () => { await i18n.changeLanguage('zh-CN') })

describe('useProjectLibrary', () => {
  it('列出已保存的项目（不含草稿），同名显示所在位置，新建项目后自动刷新', async () => {
    const kit = createTestRegistry()
    const operations = new DocumentOperations({ commands: kit.commands, registry: kit.registry, kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor } })
    kit.commands.seedProject({ name: '宣传片' })
    kit.commands.seedProject({ name: '未命名项目 1', draft: true })
    const { result } = renderHook(() => useProjectLibrary({ operations }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items.map((item) => item.name)).toEqual(['宣传片'])
    expect(result.current.items[0].metaLine).toContain('0 份文档')
    await waitFor(() => expect(kit.commands.refreshCount).toBe(1))

    await act(async () => { await operations.createProject('短片') })
    await waitFor(() => expect(result.current.items.map((item) => item.name).sort()).toEqual(['宣传片', '短片']))
  })
})

it('237 个项目渐进加载，首批已给出完整数量，跨页没有漏项或重复', async () => {
  const kit = createTestRegistry()
  const operations = new DocumentOperations({ commands: kit.commands, registry: kit.registry, kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor } })
  for (let i = 0; i < 237; i++) kit.commands.seedProject({ name: `项目${i}` })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const list = operations.listProjectsPage.bind(operations)
  vi.spyOn(operations, 'listProjectsPage').mockImplementation(async query => {
    if (query?.cursor) await gate
    return list(query)
  })
  const { result } = renderHook(() => useProjectLibrary({ operations }))
  await waitFor(() => expect(result.current.items).toHaveLength(100))
  expect(result.current.total).toBe(237)
  expect(result.current.loading).toBe(false)
  expect(result.current.loadingMore).toBe(true)
  await act(async () => release())
  await waitFor(() => expect(result.current.loadingMore).toBe(false))
  expect(result.current.items).toHaveLength(237)
  expect(new Set(result.current.items.map(row => row.id)).size).toBe(237)
})

it('卸载使进行中的分页失效，不继续取第三页', async () => {
  const kit = createTestRegistry()
  const operations = new DocumentOperations({ commands: kit.commands, registry: kit.registry, kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor } })
  for (let i = 0; i < 237; i++) kit.commands.seedProject({ name: `项目${i}` })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const list = operations.listProjectsPage.bind(operations)
  const spy = vi.spyOn(operations, 'listProjectsPage').mockImplementation(async query => { if (query?.cursor) await gate; return list(query) })
  const { result, unmount } = renderHook(() => useProjectLibrary({ operations }))
  await waitFor(() => expect(result.current.items).toHaveLength(100))
  unmount()
  await act(async () => release())
  expect(spy).toHaveBeenCalledTimes(2)
})

it('文档分页中切换项目筛选，迟到的旧页不能混入新列表', async () => {
  const kit = createTestRegistry()
  const operations = new DocumentOperations({ commands: kit.commands, registry: kit.registry, kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor } })
  const project = kit.commands.seedProject({ name: '目标项目' })
  for (let i = 0; i < 137; i++) kit.commands.seed({ name: `独立${i}`, content: {} })
  const target = kit.commands.seed({ name: '目标文档', projectId: project.id, content: {} })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const list = operations.listDocumentsPage.bind(operations)
  vi.spyOn(operations, 'listDocumentsPage').mockImplementation(async query => {
    if (query?.cursor && query.container?.kind === 'any') await gate
    return list(query)
  })
  const { result } = renderHook(() => useDocumentLibrary({ operations, kind: testDocumentKind.id }))
  await waitFor(() => expect(result.current.items).toHaveLength(100))
  expect(result.current.total).toBe(138)
  act(() => result.current.setFilter({ kind: 'project', projectId: project.id }))
  await waitFor(() => expect(result.current.items.map(row => row.id)).toEqual([target.id]))
  await act(async () => release())
  expect(result.current.items.map(row => row.id)).toEqual([target.id])
  expect(result.current.total).toBe(1)
})
