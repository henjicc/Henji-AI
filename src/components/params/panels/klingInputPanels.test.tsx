// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildShotPrompts } from '../../../../packages/ai-sdk/src/catalog/shared/shotList'
import { buildKieSubjectElements } from '../../../../packages/ai-sdk/src/catalog/shared/subjectElements'

const mocks = vi.hoisted(() => ({ uploader: vi.fn(), notify: vi.fn(), importMedia: vi.fn() }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: (key: string) => key }),
}))
vi.mock('@/components/ui/FileUploader', () => ({ default: (props: { onUpload: (files: File[]) => Promise<void> }) => { mocks.uploader(props); return null } }))
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: mocks.notify }) }))
vi.mock('@/services/localMediaImport', () => ({ importLocalMedia: mocks.importMedia }))
vi.mock('@/services/imageSource', () => ({ resolveImageDisplayUrl: (source: string) => source }))
import { ShotListPanel } from './ShotListPanel'
import { SubjectElementsPanel } from './SubjectElementsPanel'

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

const limits = { maxPromptLength: 512, minShotSeconds: 1, maxShotSeconds: 30, minTotalSeconds: 3, maxTotalSeconds: 30 }

it('分镜面板写出的值能直接交给 SDK 组装 multi_prompt', () => {
  const onChange = vi.fn()
  const { rerender } = render(<ShotListPanel value={[]} onChange={onChange} config={{ ...limits, defaultShotSeconds: 5 }} />)
  fireEvent.click(screen.getByRole('button', { name: /添加镜头/ }))
  const added = onChange.mock.lastCall![0]
  expect(added).toEqual([{ id: expect.any(String), prompt: '', duration: 5 }])

  rerender(<ShotListPanel value={added} onChange={onChange} config={{ ...limits, defaultShotSeconds: 5 }} />)
  fireEvent.change(screen.getByLabelText('镜头 1 提示词'), { target: { value: '镜头推近' } })
  expect(buildShotPrompts(onChange.mock.lastCall![0], limits, 'Kling 4.0')).toEqual([{ prompt: '镜头推近', duration: 5 }])
})

it('元素面板按名称新建元素，视频时长超出范围时不写入', async () => {
  const onChange = vi.fn()
  const config = { naming: 'named' as const, minVideoSeconds: 3, maxVideoSeconds: 8 }
  const { rerender } = render(<SubjectElementsPanel value={[]} onChange={onChange} config={config} />)
  fireEvent.click(screen.getByRole('button', { name: /添加元素/ }))
  const added = onChange.mock.lastCall![0]
  expect(added).toEqual([{ id: expect.any(String), name: '主体1', kind: 'image', images: [], videos: [] }])

  const video = [{ ...added[0], kind: 'video' }]
  rerender(<SubjectElementsPanel value={video} onChange={onChange} config={config} />)
  const { onUpload } = mocks.uploader.mock.lastCall![0] as { onUpload: (files: File[]) => Promise<void> }
  const file = new File(['v'], 'a.mp4', { type: 'video/mp4' })
  mocks.importMedia.mockResolvedValueOnce({ kind: 'video', fullPath: '/media/long.mp4', durationSeconds: 12 })
  onChange.mockClear()
  await onUpload([file])
  expect(onChange).not.toHaveBeenCalled()
  expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('3–8'), 'error')

  mocks.importMedia.mockResolvedValueOnce({ kind: 'video', fullPath: '/media/a.mp4', durationSeconds: 5 })
  await onUpload([file])
  expect(buildKieSubjectElements(onChange.mock.lastCall![0], 'Kling 4.0', { sendType: true })).toEqual([{ name: '主体1', video_url: '/media/a.mp4', type: 'video' }])
})
