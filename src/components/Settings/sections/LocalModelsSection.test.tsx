// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import type { LocalModelInfo, LocalModelProgressEvent, LocalModelsState } from '@/platform/contracts/localModels'

const mocks = vi.hoisted(() => ({
  state: null as unknown as LocalModelsState,
  listener: null as ((event: LocalModelProgressEvent) => void) | null,
  ensure: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  openFolder: vi.fn(),
  setSource: vi.fn(),
}))

vi.mock('@/commands/localModels', () => ({
  getLocalModelsState: async () => mocks.state,
  ensureLocalModel: mocks.ensure,
  cancelLocalModelDownload: mocks.cancel,
  removeLocalModel: mocks.remove,
  openLocalModelFolder: mocks.openFolder,
  setLocalModelDownloadSource: mocks.setSource,
  subscribeLocalModelProgress: (handler: (event: LocalModelProgressEvent) => void) => { mocks.listener = handler; return () => { mocks.listener = null } },
}))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

import LocalModelsSection from './LocalModelsSection'

function model(id: LocalModelInfo['id'], title: string, status: LocalModelInfo['status'], extra: Partial<LocalModelInfo> = {}): LocalModelInfo {
  return { id, title: { zh: title, en: title }, purpose: { zh: `${title}用途`, en: 'purpose' }, license: 'MIT', sizeBytes: 7_503_483, status, progress: null, lastFailure: null, ...extra }
}

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensure.mockResolvedValue({ id: 'face_detection_yunet', directory: 'x', files: [] })
  mocks.remove.mockResolvedValue(undefined)
  mocks.setSource.mockResolvedValue(undefined)
  mocks.state = {
    revision: 1,
    downloadSource: 'auto',
    models: [
      model('face_detection_yunet', '人脸检测 YuNet', 'not_downloaded'),
      model('person_matting_rvm', '人物抠像 RVM', 'ready'),
      model('text_detection_ppocr', '文字检测 PP-OCR', 'not_downloaded', { lastFailure: 'network' }),
      model('object_tracking_efficienttam', '任意物体跟踪 EfficientTAM', 'unavailable', { sizeBytes: 0 }),
    ],
  }
})
afterEach(cleanup)

describe('设置 › 本地模型', () => {
  it('列出模型的大小、许可证与状态，按状态给出对应动作', async () => {
    render(<LocalModelsSection />)
    expect(await screen.findByText('人脸检测 YuNet')).toBeTruthy()
    expect(screen.getAllByText('7.5 MB · MIT').length).toBe(3)
    expect(screen.getByText('暂不可下载')).toBeTruthy()
    expect(screen.getByText('已下载')).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除 人物抠像 RVM' })).toBeTruthy()
    // 上次失败的模型给出原因与重试
    expect(screen.getByText(/连不上下载源/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('点下载调用下载服务，进度推送就地更新并可取消', async () => {
    render(<LocalModelsSection />)
    fireEvent.click(await screen.findByRole('button', { name: '下载' }))
    expect(mocks.ensure).toHaveBeenCalledWith('face_detection_yunet')

    act(() => mocks.listener?.({ id: 'face_detection_yunet', status: 'downloading', progress: { receivedBytes: 3_751_742, totalBytes: 7_503_483 }, lastFailure: null }))
    expect(screen.getByText('50%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(mocks.cancel).toHaveBeenCalledWith('face_detection_yunet')
  })

  it('删除与切换下载源委托主进程服务', async () => {
    render(<LocalModelsSection />)
    fireEvent.click(await screen.findByRole('button', { name: '删除 人物抠像 RVM' }))
    expect(mocks.remove).toHaveBeenCalledWith('person_matting_rvm')
    fireEvent.click(screen.getByRole('radio', { name: '国内' }))
    await waitFor(() => expect(mocks.setSource).toHaveBeenCalledWith('domestic'))
    expect(screen.getByRole('radio', { name: '国内' }).getAttribute('aria-checked')).toBe('true')
  })
})
