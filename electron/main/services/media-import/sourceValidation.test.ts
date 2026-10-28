const fallback = vi.hoisted(() => vi.fn())
vi.mock('./probe', () => ({ probeLocalMedia: fallback }))
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mediaSourceFailure, normalizeMediaSourcePath, validateLocalMediaSource } from './sourceValidation'
import { normalizeMediaImportPath, mediaErrorDetails } from '../../../../src/core/media/localMediaImportSafety'
import { removeTemporaryDirectory } from '../../../../src/tests/removeTemporaryDirectory'

let root: string
beforeEach(async () => { fallback.mockReset().mockRejectedValue(Object.assign(new Error('not media'), { code: 'MEDIA_FORMAT_UNSUPPORTED' })); root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-anypath-')) })
afterEach(async () => { vi.restoreAllMocks(); await removeTemporaryDirectory(root) })

it('项目外真实媒体与目录联接可直接验证，拒绝信息不带全路径，修正后可重试', async () => {
  const project = path.join(root, 'project'); const outside = path.join(root, 'outside')
  await fs.mkdir(project); await fs.mkdir(outside)
  const file = path.join(outside, 'voice.mp3')
  await expect(validateLocalMediaSource(file)).rejects.toMatchObject({ code: 'MEDIA_NOT_FOUND' })
  await fs.writeFile(file, 'secret text')
  await expect(validateLocalMediaSource(file)).rejects.toMatchObject({ code: 'MEDIA_FORMAT_UNSUPPORTED' })
  await fs.writeFile(file, Buffer.from('ID3media'))
  const link = path.join(project, 'link')
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect(await validateLocalMediaSource(path.join(link, 'voice.mp3'), 'audio')).toMatchObject({ realPath: await fs.realpath(file), format: { kind: 'audio' } })
  await expect(validateLocalMediaSource(outside)).rejects.toMatchObject({ code: 'MEDIA_NOT_REGULAR_FILE' })
  const denied = vi.spyOn(fs, 'open').mockRejectedValueOnce(Object.assign(new Error(`EACCES ${file}`), { code: 'EACCES' }))
  const error = await validateLocalMediaSource(file).catch(value => value as Error)
  expect(error).toMatchObject({ code: 'MEDIA_PERMISSION_DENIED' }); expect(JSON.stringify(error)).not.toContain(root.replaceAll('\\', '\\\\'))
  denied.mockRestore()
  expect(await validateLocalMediaSource(file)).toMatchObject({ sizeBytes: 8 })
})

it('盘符、映射盘形式和 UNC 规范化不附加项目边界；相对位置与网络盘失败可自我修正', () => {
  if (process.platform === 'win32') {
    expect(normalizeMediaSourcePath('Z:/media/../voice.mp3')).toBe('Z:\\voice.mp3')
    expect(normalizeMediaSourcePath('\\\\server\\share\\media\\..\\voice.mp3')).toBe('\\\\server\\share\\voice.mp3')
    for (const value of ['C:voice.mp3', '\\voice.mp3']) expect(() => normalizeMediaSourcePath(value)).toThrow('MEDIA_PATH_NOT_ABSOLUTE')
  }
  expect(() => normalizeMediaSourcePath('relative.mp3')).toThrow('MEDIA_PATH_NOT_ABSOLUTE')
  expect(mediaSourceFailure({ code: 'ENETUNREACH' })).toMatchObject({ code: 'MEDIA_DRIVE_UNAVAILABLE', message: expect.stringContaining('UNC') })
})


it('Windows 设备命名空间在任何磁盘访问前拒绝，扩展前缀归一且拒绝易混淆名称', () => {
  expect(normalizeMediaImportPath(String.raw`\\?\C:\Media\voice.wav`, true)).toBe(String.raw`C:\Media\voice.wav`)
  expect(normalizeMediaImportPath(String.raw`\\?\UNC\server\share\voice.wav`, true)).toBe(String.raw`\\server\share\voice.wav`)
  for (const value of [String.raw`\\.\pipe\private`, String.raw`\\.\C:\media.wav`, String.raw`C:\NUL.mp3`, String.raw`C:\file.mp3:secret`]) expect(() => normalizeMediaImportPath(value, true)).toThrow('MEDIA_DEVICE_PATH')
  for (const value of ['/media/voice.wav', String.raw`\voice.wav`, 'C:voice.wav']) expect(() => normalizeMediaImportPath(value, true)).toThrow('MEDIA_PATH_NOT_ABSOLUTE')
  for (const value of [String.raw`C:\media.\voice.wav`, String.raw`C:\media\voice.wav `]) expect(() => normalizeMediaImportPath(value, true)).toThrow('MEDIA_PATH_TRAILING_CHARACTER')
})

it('界面可按原行为导入裸 PCM，助手严格验证拒绝；错误保留原类别和取消身份', async () => {
  const file = path.join(root, 'voice.pcm'); await fs.writeFile(file, Buffer.from([1, 2, 3]))
  expect(await validateLocalMediaSource(file, 'audio')).toMatchObject({ format: { kind: 'audio', mimeType: 'audio/pcm' } })
  await expect(validateLocalMediaSource(file, 'audio', false)).rejects.toMatchObject({ code: 'MEDIA_FORMAT_UNSUPPORTED' })
  const error = Object.assign(new Error(`解码失败 '${file}'：缺少音轨`), { name: 'DecoderError', code: 'DECODE_TRACK_MISSING' })
  expect(mediaErrorDetails(error, [file])).toEqual({ name: 'DecoderError', code: 'DECODE_TRACK_MISSING', message: "解码失败 '[本地路径]'：缺少音轨" })
  expect(mediaSourceFailure(error)).toMatchObject({ name: 'DecoderError', code: 'DECODE_TRACK_MISSING', message: expect.stringContaining('缺少音轨') })
  const cancelled = Object.assign(new Error(`已取消 '${file}'`), { name: 'AbortError', code: 'ABORT_ERR' })
  expect(mediaSourceFailure(cancelled)).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
  expect(mediaSourceFailure(cancelled).message).not.toContain(root)
})

it.each([{ name: 'legacy.mov', bytes: '0000wide0000mdat', video: true }, { name: 'voice.wav', bytes: 'RF64xxxxWAVE', video: false }, { name: 'clip.ts', bytes: Buffer.concat(Array.from({ length: 3 }, () => Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187)]))), video: true }])('签名表之外的 $name 交给实际容器探测', async ({ name, bytes, video }) => {
  const file = path.join(root, name); await fs.writeFile(file, bytes)
  fallback.mockResolvedValue({ hasAudio: true, width: video ? 1920 : 0, height: video ? 1080 : 0, durationSeconds: 2 })
  expect(await validateLocalMediaSource(file)).toMatchObject({ format: { kind: video ? 'video' : 'audio' } })
  expect(fallback).toHaveBeenCalledOnce()
})
it('TIFF 由实际图片元数据识别，不要求有限签名表覆盖', async () => {
  const sharp = (await import('sharp')).default; const file = path.join(root, 'picture.tif')
  await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).tiff().toFile(file)
  expect(await validateLocalMediaSource(file)).toMatchObject({ format: { kind: 'image', mimeType: 'image/tiff' } })
})

it('已识别为其他媒体类型时不把伪装扩展名交给宽松回退探测', async () => {
  const file = path.join(root, 'renamed.mp4'); await fs.writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 1]))
  fallback.mockResolvedValue({ hasAudio: false, width: 2, height: 2, durationSeconds: 1 })
  await expect(validateLocalMediaSource(file)).rejects.toMatchObject({ code: 'MEDIA_FORMAT_UNSUPPORTED' })
  expect(fallback).not.toHaveBeenCalled()
})

it.each([{ name: 'audio-only.mov', bytes: '0000wide0000mdat', width: 0, kind: 'video' }, { name: 'cover.wma', bytes: 'ASF audio with cover', width: 100, kind: 'audio' }])('回退探测保留 $name 的容器类型，不拒绝仅音轨容器或音频封面', async ({ name, bytes, width, kind }) => {
  const file = path.join(root, name); await fs.writeFile(file, bytes)
  fallback.mockResolvedValue({ hasAudio: true, width, height: width, durationSeconds: 2 })
  expect(await validateLocalMediaSource(file, kind as 'video' | 'audio')).toMatchObject({ format: { kind } })
})

it('回退探测的临时失败与取消不变成格式拒绝，恢复后同一文件可以重试', async () => {
  const file = path.join(root, 'professional.ts'); await fs.writeFile(file, Buffer.concat(Array.from({ length: 3 }, () => Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187)]))))
  fallback.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'ETIMEDOUT' }))
  await expect(validateLocalMediaSource(file)).rejects.toMatchObject({ code: 'MEDIA_DRIVE_UNAVAILABLE' })
  fallback.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORT_ERR' }))
  await expect(validateLocalMediaSource(file)).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
  fallback.mockResolvedValue({ hasAudio: true, width: 0, height: 0, durationSeconds: 2 })
  expect(await validateLocalMediaSource(file)).toMatchObject({ format: { kind: 'video' } })
})

it.each([{ name: 'clip.3gp', brand: '3gp4', kind: 'video' }])('助手扩展格式 $name 按容器品牌识别，保持界面格式表独立', async ({ name, brand, kind }) => {
  const file = path.join(root, name)
  await fs.writeFile(file, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp' + brand), Buffer.alloc(12)]))
  expect(await validateLocalMediaSource(file)).toMatchObject({ format: { kind } })
  expect(fallback).not.toHaveBeenCalled()
})

it.each(['192.168.1.10', 'nas.local'])('UNC 主机 %s 支持点、扩展 UNC 前缀和正斜杠', host => {
  const expected = String.raw`\\HOST\share\a.mp4`.replace('HOST', host)
  for (const value of [expected, String.raw`\\?\UNC\HOST\share\a.mp4`.replace('HOST', host), `//${host}/share/a.mp4`]) {
    expect(normalizeMediaImportPath(value, true)).toBe(expected)
    if (process.platform === 'win32') expect(normalizeMediaSourcePath(value)).toBe(expected)
  }
  for (const value of [String.raw`\\.\share\a.mp4`, String.raw`\\?\share\a.mp4`, String.raw`\\?\UNC\.\share\a.mp4`]) expect(() => normalizeMediaImportPath(value, true)).toThrow()
})

it('错误脱敏保留 URL、选项与数字，并保留脱敏后的原始堆栈', () => {
  const error = Object.assign(new Error('https://example.com/a 1 3 -y -i json D:/private/media.mp4'), { code: 'EIO' })
  error.stack = 'Error: failed\n    at originalWriter (D:/private/source.ts:42:3)'
  expect(mediaErrorDetails(error).message).toBe('https://example.com/a 1 3 -y -i json [本地路径]')
  expect(mediaErrorDetails(new Error('D:/cache/clip.mov: Invalid data found when processing input')).message).toBe('[本地路径]: Invalid data found when processing input')
  expect(mediaErrorDetails(new Error(String.raw`\\nas.local\share\clip.mov: Invalid data`)).message).toBe('[本地路径]: Invalid data')
  const safe = mediaSourceFailure(error)
  expect(safe.stack).toContain('originalWriter'); expect(safe.stack).not.toContain('D:/private')
})

it('代码 .ts 和只有一个同步字节的伪装文件按格式不支持拒绝，不启动 ffprobe', async () => {
  const file = path.join(root, 'source.ts')
  for (const content of ['export const value = 1', Buffer.concat([Buffer.from([0x47]), Buffer.alloc(563)])]) {
    await fs.writeFile(file, content)
    await expect(validateLocalMediaSource(file)).rejects.toMatchObject({ code: 'MEDIA_FORMAT_UNSUPPORTED', message: expect.stringContaining('MPEG-TS') })
  }
  expect(fallback).not.toHaveBeenCalled()
})

it.each(['.heic', '.heif'])('HEIF %s 必须实际可解码，失败时提示转成 JPEG/PNG', async extension => {
  const file = path.join(root, `picture${extension}`)
  await fs.writeFile(file, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(12)]))
  await expect(validateLocalMediaSource(file)).rejects.toMatchObject({ code: 'MEDIA_FORMAT_UNSUPPORTED', message: expect.stringContaining('当前不支持 HEIC，请转成 JPEG/PNG') })
  const sharp = (await import('sharp')).default
  await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).heif({ compression: 'av1' }).toFile(file)
  expect(await validateLocalMediaSource(file)).toMatchObject({ format: { kind: 'image' } })
})

it.each(['EISDIR', 'UNKNOWN'])('云盘路径解析 %s 失败有可修正提示，恢复后可重试', async code => {
  const file = path.join(root, 'voice.mp3'); await fs.writeFile(file, 'ID3media')
  vi.spyOn(fs, 'realpath').mockRejectedValueOnce(Object.assign(new Error(`failed ${file}`), { code }))
  await expect(validateLocalMediaSource(file)).rejects.toMatchObject({ code: 'MEDIA_DRIVE_UNAVAILABLE', message: expect.stringContaining('下载到本机') })
  expect(await validateLocalMediaSource(file)).toMatchObject({ format: { kind: 'audio' } })
})
