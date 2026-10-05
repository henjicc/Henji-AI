/** @vitest-environment jsdom */

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import type { NameCheckResult } from '@/core/documents/types'

import { DocumentDraftRecoveryNotice } from './DocumentDraftRecoveryNotice'
import { DocumentSaveNameDialog } from './DocumentSaveNameDialog'
import { DocumentSessionDialogs } from './DocumentSessionDialogs'
import { dialogDocumentSessionPrompter, useDocumentPromptStore } from './documentPromptStore'
import { createTestRegistry } from './documentSessionTestKit'
import type { DocumentSaveNamePromptInfo } from './documentSessionTypes'

/*
 * 文档会话的界面：离开提示、冲突提示、起名对话框（实时检查、重名 / 非法不能保存、更改位置）、遗留草稿区块。
 */

beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
afterEach(() => {
  cleanup()
  useDocumentPromptStore.setState({ queue: [] })
})

function nameInfo(overrides: Partial<DocumentSaveNamePromptInfo> = {}): DocumentSaveNamePromptInfo {
  const taken = new Set(['已有作品'])
  return {
    subject: { type: 'document', kind: 'canvas' },
    initialName: '未命名画布 1',
    defaultFolder: 'D:/作品/画布',
    check: vi.fn(async (name: string, folder: string | null): Promise<NameCheckResult> => {
      const at = folder ?? 'D:/作品/画布'
      return taken.has(name)
        ? { status: 'duplicate', name, path: `${at}/${name}`, existingPath: `${at}/${name}` }
        : { status: 'available', name, path: `${at}/${name}` }
    }),
    submit: vi.fn(async () => undefined),
    ...overrides,
  }
}

const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
const nameInput = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement

describe('起名对话框', () => {
  it('重名时提示原因且不能保存，不加后缀；换名后可保存', async () => {
    const info = nameInfo()
    const onDone = vi.fn()
    render(<DocumentSaveNameDialog info={info} onDone={onDone} />)
    await waitFor(() => expect(saveButton().disabled).toBe(false))
    fireEvent.change(nameInput(), { target: { value: '已有作品' } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '这个位置已有同名文件，请换一个名称。')
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(nameInput(), { target: { value: '  新海报  ' } })
    await waitFor(() => expect(saveButton().disabled).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(saveButton())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true))
    expect(info.submit).toHaveBeenCalledWith('新海报', null)
  })

  it('非法名称立即提示，不请求检查', async () => {
    const info = nameInfo()
    render(<DocumentSaveNameDialog info={info} onDone={vi.fn()} />)
    await waitFor(() => expect(info.check).toHaveBeenCalledTimes(1))
    fireEvent.change(nameInput(), { target: { value: 'a:b' } })
    expect(screen.getByRole('alert').textContent).toContain('名称不能包含')
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(nameInput(), { target: { value: '   ' } })
    expect(saveButton().disabled).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(info.check).toHaveBeenCalledTimes(1)
  })

  it('更改位置：按新文件夹检查并提交；可恢复默认位置', async () => {
    const info = nameInfo()
    const pickFolder = vi.fn(async () => 'E:/别处')
    render(<DocumentSaveNameDialog info={info} onDone={vi.fn()} pickFolder={pickFolder} />)
    expect(screen.getByText('D:/作品/画布')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更改位置…' }))
    expect(await screen.findByText('E:/别处')).toBeTruthy()
    expect(pickFolder).toHaveBeenCalledWith('D:/作品/画布')
    await waitFor(() => expect(info.check).toHaveBeenLastCalledWith('未命名画布 1', 'E:/别处'))
    await waitFor(() => expect(saveButton().disabled).toBe(false))
    fireEvent.click(saveButton())
    await waitFor(() => expect(info.submit).toHaveBeenCalledWith('未命名画布 1', 'E:/别处'))
  })

  it('保存失败时显示原因并保持打开', async () => {
    const info = nameInfo({ submit: vi.fn(async () => { throw new Error('已有同名文件。') }) })
    const onDone = vi.fn()
    render(<DocumentSaveNameDialog info={info} onDone={onDone} />)
    await waitFor(() => expect(saveButton().disabled).toBe(false))
    fireEvent.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toBe('没能保存：已有同名文件。')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('取消返回 false', async () => {
    const onDone = vi.fn()
    render(<DocumentSaveNameDialog info={nameInfo()} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onDone).toHaveBeenCalledWith(false)
  })
})

describe('提示宿主', () => {
  it('离开提示三个选择：取消 / 不保存 / 保存，“保存”是唯一主动作', async () => {
    render(<DocumentSessionDialogs />)
    let choice: Promise<string> = Promise.resolve('')
    act(() => { choice = dialogDocumentSessionPrompter.chooseLeaveAction({ subject: 'document', name: '未命名画布 2' }) })
    expect(await screen.findByText('要保存“未命名画布 2”吗？')).toBeTruthy()
    expect(screen.getByText('不保存的话，这份草稿会移到回收站。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存' }).getAttribute('data-variant')).toBe('primary')
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '不保存' }))
    await expect(choice).resolves.toBe('discard')
    await waitFor(() => expect(screen.queryByText('要保存“未命名画布 2”吗？')).toBeNull())
  })

  it('冲突提示：重新载入 / 覆盖 / 稍后处理', async () => {
    render(<DocumentSessionDialogs />)
    let choice: Promise<string> = Promise.resolve('')
    act(() => { choice = dialogDocumentSessionPrompter.resolveConflict({ name: '海报' }) })
    expect(await screen.findByText('文件已在别处被修改')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '覆盖' }))
    await expect(choice).resolves.toBe('overwrite')
  })
})

describe('遗留草稿区块', () => {
  it('列出遗留草稿；继续编辑交给页面，移到回收站后消失；没有时不渲染', async () => {
    const { registry, commands } = createTestRegistry()
    const leftover = commands.seed({ name: '未命名画布 3', content: { items: ['x'] }, draft: true })
    const onRecover = vi.fn()
    const { container } = render(<DocumentDraftRecoveryNotice kind="canvas" registry={registry} onRecover={onRecover} />)
    expect(await screen.findByText('有 1 份草稿没有保存')).toBeTruthy()
    expect(screen.getByText('未命名画布 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(onRecover).toHaveBeenCalledWith(expect.objectContaining({ id: leftover.id }))
    fireEvent.click(screen.getByRole('button', { name: '移到回收站' }))
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(commands.trashed).toEqual([leftover.id])
  })
})
