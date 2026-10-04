// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import { createUpdatePreviewRelease } from '@/core/development/updatePreviewFixture'
import UpdateDialog from './UpdateDialog'

vi.mock('@/services/updateChecker', () => ({
  downloadElectronUpdate: vi.fn(),
  installElectronUpdate: vi.fn(),
  formatReleaseDate: () => '2 天前',
}))

describe('UpdateDialog（任务 5.7 标准弹窗骨架）', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })
  afterEach(() => cleanup())

  it('有新版本：标准标题栏、更新说明分段为标题与列表、主动作在最右，不用符号字符当图标', () => {
    render(<UpdateDialog releaseInfo={createUpdatePreviewRelease('available', '1.0.0')} currentVersion="1.0.0" onClose={() => undefined} />)
    const dialog = screen.getByRole('dialog')
    expect(screen.getByRole('heading', { name: '发现新版本' })).toBeTruthy()
    expect(dialog.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(5)
    expect(dialog.textContent).not.toMatch(/[•→]/)
    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons.slice(-3)).toEqual(['跳过此版本', '稍后提醒', '立即更新'])
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('下载中显示进度且主动作禁用；失败显示原因、主动作改为重试', () => {
    const { rerender } = render(<UpdateDialog releaseInfo={createUpdatePreviewRelease('downloading', '1.0.0')} currentVersion="1.0.0" onClose={() => undefined} />)
    expect(screen.getByText('42%')).toBeTruthy()
    expect((screen.getByRole('button', { name: '下载中' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<UpdateDialog releaseInfo={createUpdatePreviewRelease('failed', '1.0.0')} currentVersion="1.0.0" onClose={() => undefined} />)
    expect(screen.getByRole('alert').textContent).toContain('网络连接中断')
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
