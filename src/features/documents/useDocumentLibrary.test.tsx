/** @vitest-environment jsdom */

import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import i18n from '@/i18n/config'
import type { DocumentKindDescriptor } from '@/core/documents/kinds'

import { DocumentOperations } from './documentOperations'
import { createTestRegistry, testDocumentKind } from './documentSessionTestKit'
import { useProjectLibrary } from './useDocumentLibrary'

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
