/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import type { NameCheckResult } from '@/core/documents/types'

import { DocumentSaveNameDialog } from './DocumentSaveNameDialog'
import type { DocumentSaveNamePromptInfo } from './documentSessionTypes'

/*
 * 起名对话框保留实时检查、重名和非法名称校验、更改位置与保存失败恢复。
 */

beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
afterEach(() => {
  cleanup()
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

  it('重名检查还没回来时按回车，检查一结束且名称可用就保存；检查结果重名则不保存', async () => {
    const info = nameInfo()
    const onDone = vi.fn()
    render(<DocumentSaveNameDialog info={info} onDone={onDone} />)
    fireEvent.change(nameInput(), { target: { value: '雨夜海报' } })
    // 检查有防抖，此刻还在“检查中”：按钮不可用，回车也不能直接提交
    expect(saveButton().disabled).toBe(true)
    fireEvent.submit(nameInput().closest('form')!)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true))
    expect(info.submit).toHaveBeenCalledWith('雨夜海报', null)
  })

  it('回车后检查结果是重名：不保存，改名后要重新确认', async () => {
    const info = nameInfo()
    const onDone = vi.fn()
    render(<DocumentSaveNameDialog info={info} onDone={onDone} />)
    fireEvent.change(nameInput(), { target: { value: '已有作品' } })
    fireEvent.submit(nameInput().closest('form')!)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.change(nameInput(), { target: { value: '另一个名字' } })
    await waitFor(() => expect(saveButton().disabled).toBe(false))
    expect(info.submit).not.toHaveBeenCalled()
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
