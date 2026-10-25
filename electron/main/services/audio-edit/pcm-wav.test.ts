import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createF32WavWriter, openF32Wav } from './pcm-wav'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-pcm-wav-'))
afterAll(() => fs.rm(directory, { recursive: true, force: true }))

describe('32 位浮点 WAV 读写', () => {
  it('写出后能随机读回，越界补零', async () => {
    const file = path.join(directory, 'roundtrip.wav')
    const writer = await createF32WavWriter(file, 48000, 2, 1000)
    const pcm = Float32Array.from({ length: 2000 }, (_, i) => (i % 2 ? -1 : 1) * i / 2000)
    await writer.write(pcm.subarray(0, 600))
    await writer.write(pcm.subarray(600))
    await writer.close()
    const reader = await openF32Wav(file)
    expect(reader).toMatchObject({ sampleRate: 48000, channels: 2, frames: 1000 })
    expect(await reader!.read(100, 5)).toEqual(pcm.slice(200, 210))
    const edge = await reader!.read(998, 4)
    expect(edge.slice(0, 4)).toEqual(pcm.slice(1996, 2000))
    expect(edge.slice(4)).toEqual(new Float32Array(4))
    expect(await reader!.read(-2, 3)).toEqual(Float32Array.from([0, 0, 0, 0, pcm[0], pcm[1]]))
    await reader!.close()
  })

  it('不是浮点 WAV 时返回空，由调用方转码', async () => {
    const file = path.join(directory, 'pcm16.wav')
    const header = Buffer.alloc(44)
    header.write('RIFF', 0); header.writeUInt32LE(36, 4); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(48000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
    header.write('data', 36); header.writeUInt32LE(0, 40)
    await fs.writeFile(file, header)
    expect(await openF32Wav(file)).toBeNull()
    await fs.writeFile(path.join(directory, 'text.wav'), 'not a wav file at all')
    expect(await openF32Wav(path.join(directory, 'text.wav'))).toBeNull()
  })
})
