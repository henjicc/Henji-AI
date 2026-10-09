/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import type { DocumentKindDescriptor } from '@/core/documents/kinds'

import { DocumentLibraryPage } from './DocumentLibraryPage'
import { DocumentOperations } from './documentOperations'
import { createTestRegistry, testDocumentKind } from './documentSessionTestKit'

/*
 * 文档类型项目页（存储底座 2.5）：通用数据源 + 卡片右键。用测试类型与内存替身，不跑主进程。
 */

beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
afterEach(cleanup)

function setup() {
  const kit = createTestRegistry()
  const operations = new DocumentOperations({
    commands: kit.commands,
    registry: kit.registry,
    kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor },
  })
  const project = kit.commands.seedProject({ name: '宣传片' })
  const standalone = kit.commands.seed({ name: '分镜', content: { items: ['a'] } })
  const inProject = kit.commands.seed({ name: '分镜', content: { items: [] }, folder: project.path, projectId: project.id })
  const onOpen = vi.fn()
  const view = render(
    <DocumentLibraryPage
      kind="canvas"
      title="画布"
      operations={operations}
      registry={kit.registry}
      onOpen={onOpen}
      create={{ kind: 'direct', onCreate: vi.fn() }}
    />,
  )
  return { ...kit, operations, project, standalone, inProject, onOpen, view }
}

const card = (id: string): HTMLElement => document.querySelector(`[data-project-id="${id}"]`) as HTMLElement
const metaOf = (id: string): string | null => card(id).getAttribute('data-project-meta')

async function openMenu(id: string): Promise<void> {
  await waitFor(() => expect(card(id)).toBeTruthy())
  fireEvent.contextMenu(card(id))
}

describe('通用数据源', () => {
  it('列出全部同类文档，标出所属项目，同名时显示所在位置；页面打开时扫描一次', async () => {
    const { standalone, inProject, commands } = setup()
    await waitFor(() => expect(card(inProject.id)).toBeTruthy())
    expect(metaOf(inProject.id)).toContain('宣传片')
    expect(metaOf(standalone.id)).toContain('不在项目里')
    expect(screen.getByRole('button', { name: /新建画布/ })).toBeTruthy()
    await waitFor(() => expect(commands.refreshCount).toBe(1))
  })

  it('左栏“按所属项目”筛选：不在项目里 / 某个项目，全部回到全部', async () => {
    const { standalone, inProject } = setup()
    await waitFor(() => expect(card(inProject.id)).toBeTruthy())
    expect(screen.getByText('按所属项目')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '不在项目里' }))
    await waitFor(() => expect(card(inProject.id)).toBeNull())
    expect(card(standalone.id)).toBeTruthy()
  })

  it('文件不存在的文档显示状态，只能从列表移除（不动磁盘），没有重命名、删除等操作', async () => {
    const kit = createTestRegistry()
    const missing = kit.commands.seed({ name: '丢失的', content: { items: [] } })
    kit.commands.missingIds.add(missing.id)
    const operations = new DocumentOperations({ commands: kit.commands, registry: kit.registry, kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor } })
    render(<DocumentLibraryPage kind="canvas" title="画布" operations={operations} registry={kit.registry} onOpen={vi.fn()} create={{ kind: 'direct', onCreate: vi.fn() }} />)
    await waitFor(() => expect(card(missing.id)).toBeTruthy())
    expect(card(missing.id).textContent).toContain('文件不存在')
    fireEvent.contextMenu(card(missing.id))
    expect(screen.queryByText('重命名')).toBeNull()
    expect(screen.queryByText('删除')).toBeNull()
    fireEvent.click(await screen.findByText('从列表移除'))
    await waitFor(() => expect(card(missing.id)).toBeNull())
    expect(kit.commands.calls).toContain('forgetDocument')
    expect(kit.commands.trashed).toEqual([])
  })

  it('遗留草稿带标记排在最前，只出现一次；单击走同一个打开入口，菜单移到回收站经确认', async () => {
    const kit = createTestRegistry()
    const saved = kit.commands.seed({ name: '已保存', content: { items: [] } })
    const draft = kit.commands.seed({ name: '未命名测试 1', content: { items: ['x'] }, draft: true })
    const operations = new DocumentOperations({ commands: kit.commands, registry: kit.registry, kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor } })
    const onOpen = vi.fn()
    render(<DocumentLibraryPage kind="canvas" title="画布" operations={operations} registry={kit.registry} onOpen={onOpen} create={{ kind: 'direct', onCreate: vi.fn() }} />)
    await waitFor(() => expect(card(draft.id)).toBeTruthy())
    await waitFor(() => expect(card(saved.id)).toBeTruthy())
    const ids = Array.from(document.querySelectorAll('[data-project-id]')).map((element) => element.getAttribute('data-project-id'))
    expect(ids).toEqual([draft.id, saved.id])
    expect(card(draft.id).getAttribute('data-project-draft')).toBe('true')
    fireEvent.click(card(draft.id))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: draft.id })))
    fireEvent.contextMenu(card(draft.id))
    fireEvent.click(within(document.querySelector('[data-context-menu]') as HTMLElement).getByText('移到回收站'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '移到回收站' }))
    await waitFor(() => expect(card(draft.id)).toBeNull())
    expect(kit.commands.trashed).toEqual([draft.id])
  })
})

describe('卡片右键', () => {
  it('重命名实时查重：重名提示且不能确认，换名后改名成功', async () => {
    const { standalone, commands } = setup()
    commands.seed({ name: '已有', content: { items: [] } })
    await openMenu(standalone.id)
    fireEvent.click(await screen.findByText('重命名'))
    const input = await screen.findByDisplayValue('分镜')
    fireEvent.change(input, { target: { value: '已有' } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '这个位置已有同名文件，请换一个名称。')
    const confirm = screen.getByRole('button', { name: '确认' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '新分镜' } })
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => expect(commands.stored(standalone.id)?.meta.name).toBe('新分镜'))
  })

  it('移到项目遇到重名时询问，两个都保留后加序号移入', async () => {
    const { standalone, project, commands } = setup()
    await openMenu(standalone.id)
    fireEvent.click(await screen.findByText('移到项目…'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('option', { name: '宣传片' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '移入' }))
    fireEvent.click(await screen.findByRole('button', { name: '两个都保留' }))
    await waitFor(() => expect(commands.stored(standalone.id)?.meta).toMatchObject({ name: '分镜 (2)', container: { kind: 'project', projectId: project.id } }))
  })

  it('移到新建的项目：起名查重后新建并移入', async () => {
    const { standalone, commands } = setup()
    await openMenu(standalone.id)
    fireEvent.click(await screen.findByText('移到项目…'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('option', { name: '新建项目' }))
    const input = within(dialog).getByRole('textbox', { name: '新项目名称' })
    fireEvent.change(input, { target: { value: '宣传片' } })
    expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', '已有同名项目，请换一个名称。')
    fireEvent.change(input, { target: { value: '短片' } })
    const confirm = within(dialog).getByRole('button', { name: '移入' }) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => {
      const created = [...commands.projects.values()].find((item) => item.name === '短片')
      expect(created).toBeTruthy()
      expect(commands.stored(standalone.id)?.meta.container).toEqual({ kind: 'project', projectId: created!.id })
    })
  })

  it('移出项目、创建副本、在文件夹中显示、删除（移到回收站）', async () => {
    const { standalone, inProject, commands } = setup()
    await openMenu(inProject.id)
    fireEvent.click(await screen.findByText('移出项目'))
    // 与“不在项目里”的同名文档冲突，询问后两个都保留
    fireEvent.click(await screen.findByRole('button', { name: '两个都保留' }))
    await waitFor(() => expect(commands.stored(inProject.id)?.meta.container).toEqual({ kind: 'user' }))

    await openMenu(standalone.id)
    fireEvent.click(await screen.findByText('创建副本'))
    await waitFor(() => expect([...commands.documents.values()].filter((item) => item.meta.name.startsWith('分镜'))).toHaveLength(3))

    await openMenu(standalone.id)
    fireEvent.click(await screen.findByText('在文件夹中显示'))
    await waitFor(() => expect(commands.revealed).toContain(standalone.id))

    await openMenu(standalone.id)
    fireEvent.click(await screen.findByText('删除'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('可以从系统回收站找回')
    fireEvent.click(within(dialog).getByRole('button', { name: '移到回收站' }))
    await waitFor(() => expect(commands.trashed).toContain(standalone.id))
  })
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = () => undefined
})
