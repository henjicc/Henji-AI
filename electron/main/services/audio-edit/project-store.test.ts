import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAudioEditDocumentContent } from '../../../../src/core/audioEdit/documentContent'

/*
 * 口播的主进程读取口（3.3）：按文档 ID 读 `.henji-audio` 文件，主进程不写口播内容；
 * 文件没变时复用上次读到的内容（试听连续请求），文件一变就重新读。
 */

const mocks = vi.hoisted(() => ({ readDocument: vi.fn() }))
vi.mock('../documents/runtime', () => ({ getDocumentService: () => ({ readDocument: mocks.readDocument }) }))

import { clearAudioEditProjectCacheForTests, requireAudioEditProject } from './project-store'

let directory: string
let file: string
const source = { mediaType: 'audio' as const, sourcePath: 'D:/外部/录音.wav', audioPath: 'D:/外部/录音.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }

function read(revision: number, referenceScript = '') {
  return {
    meta: { id: 'doc-1', kind: 'audio_edit', name: '录音', path: file, revision, createdAt: 1, updatedAt: 2 },
    content: { ...createAudioEditDocumentContent(source), referenceScript },
  }
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-audio-store-'))
  file = path.join(directory, '录音.henji-audio')
  await fs.writeFile(file, 'v1')
  clearAudioEditProjectCacheForTests()
  mocks.readDocument.mockReset()
})
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

it('按文档 ID 读文件：外壳字段来自文档元信息', async () => {
  mocks.readDocument.mockResolvedValue(read(4, '稿子'))
  const project = await requireAudioEditProject('doc-1')
  expect(mocks.readDocument).toHaveBeenCalledWith({ id: 'doc-1' })
  expect(project).toMatchObject({ id: 'doc-1', name: '录音', revision: 4, referenceScript: '稿子', source })
})

it('文件没变时复用，文件改变后重新读取；返回的是副本', async () => {
  mocks.readDocument.mockResolvedValueOnce(read(1, '第一版'))
  const first = await requireAudioEditProject('doc-1')
  first.referenceScript = '调用方改了副本'
  expect((await requireAudioEditProject('doc-1')).referenceScript).toBe('第一版')
  expect(mocks.readDocument).toHaveBeenCalledTimes(1)
  await fs.writeFile(file, 'v2 更长的内容')
  mocks.readDocument.mockResolvedValueOnce(read(2, '第二版'))
  expect((await requireAudioEditProject('doc-1')).referenceScript).toBe('第二版')
  expect(mocks.readDocument).toHaveBeenCalledTimes(2)
})

it('不是口播或找不到时给出可读的错误', async () => {
  mocks.readDocument.mockResolvedValueOnce({ ...read(1), meta: { ...read(1).meta, kind: 'canvas' } })
  await expect(requireAudioEditProject('doc-1')).rejects.toThrow('不是口播')
  mocks.readDocument.mockRejectedValueOnce(Object.assign(new Error('找不到文档。'), { name: 'DocumentNotFoundError' }))
  await expect(requireAudioEditProject('doc-2')).rejects.toThrow('NOT_FOUND')
})
