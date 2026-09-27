import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
const state = vi.hoisted(() => ({ project: undefined as AudioEditProjectDocument | undefined, processed: '' }))
vi.mock('./project-store', () => ({ requireAudioEditProject: () => structuredClone(state.project) }))
vi.mock('./media', () => ({ verifyAudioEditSource: vi.fn(), validateAudioEditAudio: vi.fn() }))
vi.mock('./processors', () => ({ prepareAudioEditProcessedAudio: async () => state.processed }))
vi.mock('./process', () => ({ runAudioEditProcess: vi.fn(async () => { throw new Error('XML must not encode') }) }))
vi.mock('./task-store', () => ({ runAudioEditTask: async (_id: string, _kind: string, operation: (signal: AbortSignal, progress: (n: number) => void) => Promise<unknown>) => operation(new AbortController().signal, () => undefined) }))
import { exportAudioEditProject } from './export'
import { runAudioEditProcess } from './process'

let directory: string
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-export-test-'))
  const sourcePath = path.join(directory, '原声 & #.wav')
  await fs.writeFile(sourcePath, 'original file')
  state.project = { id: 'p', name: '剪辑', source: { mediaType: 'audio', sourcePath, audioPath: sourcePath, sampleRate: 48000, channels: 2, durationFrames: 96000 }, transcript: [], suggestions: [], referenceScript: '', vstEnabled: false, revision: 1, createdAt: 1, updatedAt: 1 }
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }) })
it('exports original file URLs without invoking an encoder and refuses source overwrite', async () => {
  const targetPath = path.join(directory, '剪辑.xml')
  await exportAudioEditProject({ projectId: 'p', format: 'xml', targetPath })
  const xml = await fs.readFile(targetPath, 'utf8')
  const url = /<pathurl>([^<]+)<\/pathurl>/.exec(xml)![1].replaceAll('&amp;', '&')
  expect(fileURLToPath(url)).toBe(state.project!.source.sourcePath)
  expect(runAudioEditProcess).not.toHaveBeenCalled()
  await expect(exportAudioEditProject({ projectId: 'p', format: 'xml', targetPath: state.project!.source.sourcePath })).rejects.toThrow('原素材')
  expect(await fs.readFile(state.project!.source.sourcePath, 'utf8')).toBe('original file')
})
it('missing processed audio never publishes a successful XML', async () => {
  state.processed = path.join(directory, 'missing.wav')
  const targetPath = path.join(directory, '剪辑.xml')
  await expect(exportAudioEditProject({ projectId: 'p', format: 'xml', targetPath, includeProcessing: true })).rejects.toThrow()
  expect(await fs.readdir(directory)).toEqual(['原声 & #.wav'])
})
it('rolls back companion files when publishing XML fails', async () => {
  const targetPath = path.join(directory, '剪辑.xml')
  const subtitleTargetPath = path.join(directory, '剪辑.srt')
  await fs.writeFile(targetPath, 'old XML'); await fs.writeFile(subtitleTargetPath, 'old SRT')
  const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    if (target === targetPath && !String(source).endsWith('.backup')) throw new Error('disk refused XML')
    await rename(source, target)
  })
  await expect(exportAudioEditProject({ projectId: 'p', format: 'xml', targetPath, subtitleTargetPath })).rejects.toThrow('disk refused XML')
  expect(await fs.readFile(targetPath, 'utf8')).toBe('old XML')
  expect(await fs.readFile(subtitleTargetPath, 'utf8')).toBe('old SRT')
  expect((await fs.readdir(directory)).sort()).toEqual(['剪辑.srt', '剪辑.xml', '原声 & #.wav'].sort())
})
