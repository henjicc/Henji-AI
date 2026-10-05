/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUDIO_EDIT_VIEW_SETTINGS } from '@/core/audioEdit/edits'
import { AudioEditFileMenu } from './AudioEditTextTools'
import { AudioEditViewSettings } from './AudioEditViewSettings'

/**
 * 口播剪辑外壳（界面重设计 5.5 第二批）：界面设置不再用系统原生下拉（不随主题、不能键盘高亮），
 * 文件菜单里“删除项目”与其他菜单项同一组件，删除仍要二次确认。
 */

afterEach(cleanup)

describe('口播剪辑外壳', () => {
  it('界面设置用主题下拉而不是原生 select', () => {
    const view = render(<AudioEditViewSettings open onClose={vi.fn()} value={DEFAULT_AUDIO_EDIT_VIEW_SETTINGS} onChange={vi.fn()} />)
    expect(view.baseElement.querySelector('select')).toBeNull()
    expect(screen.getByRole('button', { name: '整个界面缩放' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '波形上方显示字幕' })).toBeTruthy()
  })

  it('文件菜单的删除是普通菜单项，点了先弹确认', async () => {
    const onDelete = vi.fn()
    render(<AudioEditFileMenu name="口播 1" disabled={false} onRename={vi.fn()} onRelink={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: /口播 1/ }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['重命名', '重新定位原素材', '删除项目'])
    fireEvent.click(items[2])
    await waitFor(() => expect(screen.getByRole('button', { name: '删除项目' })).toBeTruthy())
    expect(onDelete).not.toHaveBeenCalled()
  })
})
