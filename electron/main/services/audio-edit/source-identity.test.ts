import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => os.tmpdir() }))
vi.mock('../db', () => ({ getDb: vi.fn() }))
vi.mock('./project-store', () => ({ requireAudioEditProject: vi.fn() }))
import { audioEditSourceContentKey, fingerprintAudioEditSource, digestWholeAudioEditSource } from './source-identity'
import { verifyAudioEditSource } from './media'

let directory: string | undefined
afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); directory = undefined })

/** 24 MiB 伪随机内容（超过整文件哈希的 16 MiB，走采样）。 */
function bytes(size = 24 * 1024 * 1024, seed = 1): Buffer {
  const buffer = Buffer.alloc(size)
  let state = seed
  for (let index = 0; index < size; index += 4) { state = (state * 1664525 + 1013904223) >>> 0; buffer.writeUInt32LE(state, index) }
  return buffer
}

it('指纹对同一内容稳定（复制、改修改时间都不变），对截断、尾部追加、中间改动的文件不同', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-fingerprint-'))
  const content = bytes()
  const file = path.join(directory, '原素材.wav')
  await fs.writeFile(file, content)
  const original = await fingerprintAudioEditSource(file)
  expect(original.size).toBe(content.length)
  expect(await fingerprintAudioEditSource(file)).toEqual(original)
  const copy = path.join(directory, '拷贝.wav')
  await fs.copyFile(file, copy)
  await fs.utimes(copy, new Date(2030, 0, 1), new Date(2030, 0, 1))
  expect((await fingerprintAudioEditSource(copy)).digest).toBe(original.digest)
  const variant = async (change: (buffer: Buffer) => Buffer): Promise<string> => {
    const target = path.join(directory!, `变体-${Math.random()}.wav`)
    await fs.writeFile(target, change(Buffer.from(content)))
    return (await fingerprintAudioEditSource(target)).digest
  }
  expect(await variant(buffer => buffer.subarray(0, buffer.length - 1))).not.toBe(original.digest)
  expect(await variant(buffer => Buffer.concat([buffer, Buffer.alloc(4)]))).not.toBe(original.digest)
  // 落在采样块里的一个字节（正中间那一块）
  expect(await variant(buffer => { buffer[buffer.length >> 1] ^= 1; return buffer })).not.toBe(original.digest)
  // 换成同长度的另一段录音
  expect(await variant(() => bytes(content.length, 2))).not.toBe(original.digest)
  // 16 MiB 以内整文件：任何一个字节都算
  const small = path.join(directory, '短.wav')
  await fs.writeFile(small, content.subarray(0, 1024 * 1024))
  const smallDigest = (await fingerprintAudioEditSource(small)).digest
  await fs.writeFile(small, Buffer.from(content.subarray(0, 1024 * 1024)).fill(7, 700_001, 700_002))
  expect((await fingerprintAudioEditSource(small)).digest).not.toBe(smallDigest)
})

it('改动落在未采样位置：采样指纹认不出，但外部素材的缓存键随修改时间变、整文件摘要的素材（拼接结果）连修改时间相同都能区分', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-unsampled-'))
  const content = bytes()
  const same = new Date(2029, 0, 1)
  const write = async (name: string, buffer: Buffer, time: Date): Promise<string> => {
    const file = path.join(directory!, name)
    await fs.writeFile(file, buffer)
    await fs.utimes(file, time, time)
    return file
  }
  const before = await write('覆盖前.wav', content, same)
  // 正中块之后、下一块之前的空档里改一个字节：离两侧采样块都有几百 KB
  const changed = Buffer.from(content); changed[Math.floor(content.length * 17 / 33)] ^= 1
  const after = await write('覆盖后.wav', changed, same)
  expect((await fingerprintAudioEditSource(after)).digest).toBe((await fingerprintAudioEditSource(before)).digest)
  // 外部素材（只有指纹）：缓存键带文件当前的大小与修改时间，改过的文件修改时间不同就换键
  const touched = await write('覆盖后-新时间.wav', changed, new Date(2030, 0, 1))
  const external = async (file: string): Promise<string> => audioEditSourceContentKey({ sourcePath: file, fingerprint: await fingerprintAudioEditSource(file) })
  expect(await external(touched)).not.toBe(await external(before))
  // 应用写出的拼接结果带整文件摘要：内容不同键就不同，与修改时间无关
  const managed = async (file: string): Promise<string> => audioEditSourceContentKey({ sourcePath: file, identity: await digestWholeAudioEditSource(file) })
  expect(await managed(after)).not.toBe(await managed(before))
})

it('校验先比大小与修改时间，不一致才比内容；新作品比指纹、旧作品比整文件摘要；派生缓存键随之变化', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-verify-'))
  const file = path.join(directory, '中文 & # 原素材.wav')
  await fs.writeFile(file, bytes())
  // 修改时间取整秒：之后能原样改回去（文件系统的修改时间比毫秒更细）
  const imported = new Date(2029, 0, 1)
  await fs.utimes(file, imported, imported)
  const fingerprint = await fingerprintAudioEditSource(file)
  const current = { source: { sourcePath: file, fingerprint } }
  await expect(verifyAudioEditSource(current)).resolves.toBeUndefined()
  const importedKey = await audioEditSourceContentKey(current.source)
  expect(await audioEditSourceContentKey(current.source)).toBe(importedKey)
  // 只改了修改时间（拷贝、touch）：内容相同照常通过，但派生缓存换键重建
  await fs.utimes(file, new Date(2031, 0, 1), new Date(2031, 0, 1))
  await expect(verifyAudioEditSource(current)).resolves.toBeUndefined()
  expect(await audioEditSourceContentKey(current.source)).not.toBe(importedKey)
  // 同名同大小换了内容，还把修改时间改回去：高频路径只看大小与修改时间，关口处比指纹认得出
  await fs.writeFile(file, bytes(24 * 1024 * 1024, 3))
  await fs.utimes(file, imported, imported)
  await expect(verifyAudioEditSource(current, undefined, 'quick')).resolves.toBeUndefined()
  await expect(verifyAudioEditSource(current)).rejects.toThrow('内容已改变')
  // 旧作品：只有整文件摘要，大小与修改时间一致时不读内容；不一致才整文件比对
  const legacyFile = path.join(directory, '旧作品.wav')
  await fs.writeFile(legacyFile, 'original')
  const identity = await digestWholeAudioEditSource(legacyFile)
  const legacy = { source: { sourcePath: legacyFile, identity } }
  await expect(verifyAudioEditSource(legacy)).resolves.toBeUndefined()
  expect(await audioEditSourceContentKey(legacy.source)).toBe(identity.digest)
  await fs.utimes(legacyFile, new Date(2032, 0, 1), new Date(2032, 0, 1))
  await expect(verifyAudioEditSource(legacy)).resolves.toBeUndefined()
  await fs.writeFile(legacyFile, 'replaced')
  await expect(verifyAudioEditSource(legacy)).rejects.toThrow('内容已改变')
  expect(await fs.readFile(legacyFile, 'utf8')).toBe('replaced')
  await fs.rename(legacyFile, path.join(directory, '移动.wav'))
  await expect(verifyAudioEditSource(legacy)).rejects.toThrow('重新定位')
})
