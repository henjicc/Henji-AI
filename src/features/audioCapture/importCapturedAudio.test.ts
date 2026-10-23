import { beforeEach, expect, it, vi } from 'vitest'
import { importCapturedAudio } from './importCapturedAudio'

const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), import: vi.fn(), open: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ documents: { listDocuments: mocks.list, readDocument: mocks.read } }) }))
vi.mock('@/features/audioEdit', () => ({ importAudioEditMedia: mocks.import, openAudioEditDocument: mocks.open }))
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([]) })
it('新录音复用导入入口，跨重启恢复打开同源草稿，不重复创建', async () => {
  await importCapturedAudio('D:/作品/录音/录音.wav')
  expect(mocks.import).toHaveBeenCalledWith('D:/作品/录音/录音.wav')
  mocks.list.mockResolvedValue([{ id: 'draft', draft: true }])
  mocks.read.mockResolvedValue({ content: { source: { mediaType: 'audio', sourcePath: 'D:\\作品\\录音\\录音.wav', audioPath: 'audio.wav', durationFrames: 144000, sampleRate: 48000, channels: 1 }, referenceScript: '', transcript: [], suggestions: [], vstEnabled: false } })
  await importCapturedAudio('D:/作品/录音/录音.wav')
  expect(mocks.open).toHaveBeenCalledWith({ id: 'draft' }); expect(mocks.import).toHaveBeenCalledTimes(1)
})
