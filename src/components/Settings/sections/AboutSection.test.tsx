/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import type { ThirdPartyNotices } from '../about/thirdPartyLicenses'

const loadNotices = vi.hoisted(() => vi.fn())
const openExternal = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../about/thirdPartyLicenses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../about/thirdPartyLicenses')>()),
  loadThirdPartyNotices: loadNotices,
}))
vi.mock('../hooks/useExternalLink', () => ({ useExternalLink: () => ({ openExternal }) }))
/** jsdom 里容器高度为 0，Virtuoso 一行都不渲染；替换为全量渲染，与被测逻辑无关。 */
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: unknown) => React.ReactNode }) => (
    <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div>
  ),
}))

import AboutSection from './AboutSection'

const notices: ThirdPartyNotices = {
  project: { name: '痕迹AI', version: '2.0.0', license: 'Apache-2.0', licenseTextId: 'tA' },
  highlights: ['runtime:chromium', 'runtime:ffmpeg'],
  components: [
    {
      id: 'runtime:chromium', name: 'Chromium', version: '148.0', license: 'BSD-3-Clause', ecosystem: 'runtime',
      homepage: 'https://www.chromium.org', textIds: [], textOrigin: 'none', licenseFileHint: 'LICENSES.chromium.html',
    },
    {
      id: 'runtime:ffmpeg', name: 'FFmpeg', version: '9.0.2', license: 'GPL-3.0-or-later', ecosystem: 'runtime',
      homepage: 'https://ffmpeg.org', textIds: ['tG'], textOrigin: 'package',
      sources: ['https://github.com/FFmpeg/FFmpeg/tree/2a571b6068'], includes: ['x264', 'dav1d'],
    },
    { id: 'npm:react@18.3.1', name: 'react', version: '18.3.1', license: 'MIT', ecosystem: 'npm', homepage: 'https://react.dev', textIds: ['tM'], textOrigin: 'package' },
    { id: 'npm:tiny@1.0.0', name: 'tiny', version: '1.0.0', license: 'ISC', ecosystem: 'npm', homepage: null, textIds: ['tI'], textOrigin: 'standard' },
  ],
  texts: { tA: 'Apache License Version 2.0 全文', tG: 'GNU GENERAL PUBLIC LICENSE 全文', tM: 'MIT react 全文', tI: 'ISC 标准文本' },
}

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN')
})

beforeEach(() => {
  loadNotices.mockReset()
  openExternal.mockClear()
})

afterEach(cleanup)

describe('AboutSection', () => {
  it('展示软件、作者、项目主页与开源协议，链接走系统浏览器', async () => {
    loadNotices.mockResolvedValue(notices)
    render(<AboutSection />)

    expect(screen.getByText('痕迹AI')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /痕继痕迹/ }))
    expect(openExternal).toHaveBeenCalledWith('https://space.bilibili.com/39337803')
    fireEvent.click(screen.getByRole('button', { name: /github\.com\/henjicc\/Henji-AI/ }))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/henjicc/Henji-AI')

    const viewLicense = await screen.findByRole('button', { name: '查看全文' })
    await vi.waitFor(() => expect((viewLicense as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(viewLicense)
    const dialog = await screen.findByRole('dialog', { name: /痕迹AI 开源协议（Apache-2.0）/ })
    expect(within(dialog).getByText('Apache License Version 2.0 全文')).toBeTruthy()
  })

  it('重点组件可直接打开许可详情：GPL 组件给出源码获取地址与包含的外部库', async () => {
    loadNotices.mockResolvedValue(notices)
    render(<AboutSection />)

    fireEvent.click(await screen.findByRole('button', { name: /FFmpeg.*9\.0\.2.*GPL-3\.0-or-later/ }))
    const dialog = await screen.findByRole('dialog', { name: /第三方开源组件/ })
    expect(within(dialog).getByText('GNU GENERAL PUBLIC LICENSE 全文')).toBeTruthy()
    expect(within(dialog).getByText('x264, dav1d')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /github\.com\/FFmpeg\/FFmpeg\/tree\/2a571b6068/ }))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/FFmpeg/FFmpeg/tree/2a571b6068')

    // Chromium 的许可汇总在安装目录，标准文本回退会注明来源
    fireEvent.click(within(dialog).getByRole('button', { name: /Chromium/ }))
    expect(within(dialog).getByText(/LICENSES\.chromium\.html/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /tiny/ }))
    expect(within(dialog).getByText('该组件未附带许可文件，以下为 ISC 标准文本。')).toBeTruthy()
  })

  it('全部组件可搜索', async () => {
    loadNotices.mockResolvedValue(notices)
    render(<AboutSection />)

    expect(await screen.findByText('共 4 项')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))
    const dialog = await screen.findByRole('dialog', { name: /第三方开源组件/ })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '搜索组件或许可证…' }), { target: { value: 'mit' } })
    expect(within(dialog).getByText('共 1 项')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /^react/ })).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('textbox', { name: '搜索组件或许可证…' }), { target: { value: 'nothing' } })
    expect(within(dialog).getByText('没有匹配的组件')).toBeTruthy()
  })

  it('清单不可用时说明状态，软件信息仍可查看', async () => {
    loadNotices.mockRejectedValue(new Error('missing'))
    render(<AboutSection />)

    expect(await screen.findByText('开源许可信息暂不可用')).toBeTruthy()
    expect(screen.getByRole('button', { name: /痕继痕迹/ })).toBeTruthy()
    expect((screen.getByRole('button', { name: '查看全文' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '查看全部' })).toBeNull()
  })
})
