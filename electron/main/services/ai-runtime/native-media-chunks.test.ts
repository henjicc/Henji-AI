import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nativeMediaChunks } from './native-media-chunks'

const scope = vi.hoisted(() => ({ allowed: true }))
vi.mock('../../protocol', () => ({ isPathWithinAllowedMediaRoots: () => true, isRealPathWithinAllowedMediaRoots: async () => scope.allowed }))
let directory: string
let ref: string
beforeEach(async () => {
  scope.allowed = true
  directory = await mkdtemp(path.join(os.tmpdir(), 'henji-chunks-'))
  ref = path.join(directory, 'voice.wav')
  await writeFile(ref, Uint8Array.from([1, 2, 3, 4, 5]))
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

it('describes a scoped file and reads only the requested range, including short EOF reads', async () => {
  expect(await nativeMediaChunks.describe(ref)).toEqual({ size: 5, mimeType: 'audio/wav', filename: 'voice.wav' })
  expect(await nativeMediaChunks.readChunk(ref, 1, 2)).toEqual(Uint8Array.from([2, 3]))
  expect(await nativeMediaChunks.readChunk(ref, 4, 3)).toEqual(Uint8Array.from([5]))
  expect(await nativeMediaChunks.readChunk(ref, 5, 1)).toEqual(new Uint8Array())
})

it('rejects invalid chunk ranges before reading', async () => {
  await expect(nativeMediaChunks.readChunk(ref, 0, 65 * 1024)).rejects.toMatchObject({ code: 'invalid_parameter' })
  await expect(nativeMediaChunks.readChunk(ref, -1, 1)).rejects.toMatchObject({ code: 'invalid_parameter' })
})
