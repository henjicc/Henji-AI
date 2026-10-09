/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { DocumentOperations } from '@/features/documents/documentOperations'
import { createTestRegistry } from '@/features/documents/documentSessionTestKit'
import { VideoEditProjectsPage } from './VideoEditProjectsPage'

/*
 * 剪辑页 = 项目列表（3.1）：数据来自通用项目列表，用内存文档仓库替身，不跑主进程。
 */

beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
afterEach(cleanup)

function setup() {
  const kit = createTestRegistry()
  const operations = new DocumentOperations({ commands: kit.commands, registry: kit.registry })
  const actions = { onCreate: vi.fn(), onOpenFolder: vi.fn(), onOpen: vi.fn() }
  const view = (): ReturnType<typeof render> => render(<VideoEditProjectsPage operations={operations} registry={kit.registry} {...actions} />)
  return { kit, operations, actions, view }
}

describe('剪辑项目页', () => {
  it('没有项目时只有新建项目（主按钮）与打开项目文件夹', async () => {
    const { actions, view } = setup()
    view()
    const create = await screen.findByRole('button', { name: '新建项目' })
    expect(create.getAttribute('data-variant')).toBe('primary')
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1)
    fireEvent.click(create)
    expect(actions.onCreate).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '打开项目文件夹…' }))
    expect(actions.onOpenFolder).toHaveBeenCalledOnce()
  })

  it('项目卡片封面用主剪辑的通用封面；没有封面的保持占位图', async () => {
    const { kit, operations, actions } = setup()
    const withCover = kit.commands.seedProject({ name: '旅行 Vlog' })
    kit.commands.projects.set(withCover.id, { ...withCover, mainVideoEditId: 'main-edit' })
    const plain = kit.commands.seedProject({ name: '花絮' })
    const readCover = vi.fn(async (docId: string) => docId === 'main-edit' ? 'C:/covers/main-edit/1.webp' : null)
    render(<VideoEditProjectsPage operations={operations} registry={kit.registry} readCover={readCover} {...actions} />)
    await waitFor(() => expect(document.querySelector(`[data-project-id="${withCover.id}"] img`)).not.toBeNull())
    expect(readCover).toHaveBeenCalledWith('main-edit')
    expect(document.querySelector(`[data-project-id="${plain.id}"] img`)).toBeNull()
  })

  it('没有封面的项目与草稿从剪辑内容补生成封面', async () => {
    const { kit, operations, actions } = setup()
    const saved = kit.commands.seedProject({ name: '旅行 Vlog' })
    kit.commands.projects.set(saved.id, { ...saved, mainVideoEditId: 'saved-edit' })
    const draft = kit.commands.seedProject({ name: '未命名项目 1', draft: true })
    kit.commands.projects.set(draft.id, { ...draft, mainVideoEditId: 'draft-edit' })
    const ensureCover = vi.fn(async () => undefined)
    render(<VideoEditProjectsPage operations={operations} registry={kit.registry} readCover={async () => null} ensureCover={ensureCover} {...actions} />)
    await waitFor(() => expect(ensureCover).toHaveBeenCalledWith('draft-edit'))
    expect(ensureCover).toHaveBeenCalledWith('saved-edit')
  })

  it('已保存项目点开交回项目；草稿项目带标记排在最前，可继续编辑或经确认整个移到回收站', async () => {
    const { kit, actions, view } = setup()
    const saved = kit.commands.seedProject({ name: '旅行 Vlog' })
    const draft = kit.commands.seedProject({ name: '未命名项目 1', draft: true })
    view()
    await waitFor(() => expect(document.querySelector(`[data-project-id="${draft.id}"]`)).toBeTruthy())
    await waitFor(() => expect(document.querySelector(`[data-project-id="${saved.id}"]`)).toBeTruthy())
    const ids = Array.from(document.querySelectorAll('[data-project-id]')).map((element) => element.getAttribute('data-project-id'))
    expect(ids).toEqual([draft.id, saved.id])
    fireEvent.click(document.querySelector(`[data-project-id="${saved.id}"]`)!)
    expect(actions.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id }))
    const draftCard = document.querySelector(`[data-project-id="${draft.id}"]`) as HTMLElement
    expect(draftCard.getAttribute('data-project-draft')).toBe('true')
    fireEvent.click(draftCard)
    expect(actions.onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: draft.id }))
    fireEvent.contextMenu(draftCard)
    fireEvent.click(within(document.querySelector('[data-context-menu]') as HTMLElement).getByText('移到回收站'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '移到回收站' }))
    await waitFor(() => expect(kit.commands.trashed).toContain(draft.id))
    await waitFor(() => expect(document.querySelector(`[data-project-id="${draft.id}"]`)).toBeNull())
  })

  it('右键在文件夹中显示、重命名实时查重、删除整个项目文件夹移到回收站；找不到的外部项目只能从列表移除', async () => {
    const { kit, view } = setup()
    const project = kit.commands.seedProject({ name: '宣传片' })
    kit.commands.seedProject({ name: '花絮' })
    const external = await kit.commands.registerExternalProject('E:/别处/外部项目')
    kit.commands.projects.set(external.id, { ...external, missing: true })
    view()
    await screen.findByText('3 个项目')
    expect(screen.getByText('文件夹不存在')).toBeTruthy()

    fireEvent.contextMenu(document.querySelector(`[data-project-id="${project.id}"]`)!)
    fireEvent.click(await screen.findByText('在文件夹中显示'))
    await waitFor(() => expect(kit.commands.revealed).toContain(project.id))

    fireEvent.contextMenu(document.querySelector(`[data-project-id="${project.id}"]`)!)
    fireEvent.click(await screen.findByText('重命名'))
    const input = await screen.findByDisplayValue('宣传片')
    fireEvent.change(input, { target: { value: '花絮' } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '这个位置已有同名文件夹，请换一个名称。')
    const confirm = screen.getByRole('button', { name: '确认' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '正片' } })
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => expect(kit.commands.projects.get(project.id)?.name).toBe('正片'))

    fireEvent.contextMenu(document.querySelector(`[data-project-id="${project.id}"]`)!)
    fireEvent.click(await screen.findByText('删除'))
    expect(await screen.findByText(/整个文件夹移到回收站/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '移到回收站' }).at(-1)!)
    await waitFor(() => expect(kit.commands.trashed).toContain(project.id))

    fireEvent.contextMenu(document.querySelector(`[data-project-id="${external.id}"]`)!)
    expect(screen.queryByText('删除')).toBeNull()
    fireEvent.click(await screen.findByText('从列表移除'))
    await waitFor(() => expect(kit.commands.projects.has(external.id)).toBe(false))
  })
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = () => undefined
})
