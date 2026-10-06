import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalModelDownloadSource, LocalModelProgressEvent } from '../../../../src/platform/contracts/localModels'
import type { DownloadSourceSelector } from '../download/sourceSelector'
import type { DownloadFetch } from '../download/verifiedDownload'
import { LOCAL_MODEL_MANIFEST, type LocalModelSpec } from './manifest'
import { LocalModelError, LocalModelService } from './service'

const bytes = Buffer.from(Array.from({ length: 3000 }, (_, index) => (index * 7) % 256))
const sha256 = createHash('sha256').update(bytes).digest('hex')

const yunet: LocalModelSpec = {
  id: 'face_detection_yunet',
  title: { zh: '人脸检测 YuNet', en: 'Face Detection' },
  purpose: { zh: '找人脸', en: 'faces' },
  folderName: { zh: '人脸检测 YuNet', en: 'Face Detection YuNet' },
  homepage: 'https://example.com/yunet',
  license: { spdx: 'MIT', url: 'https://example.com/license' },
  availability: 'available',
  files: [{
    name: 'yunet.onnx', role: 'model', sizeBytes: bytes.length, sha256,
    sources: [
      { region: 'domestic', label: 'own', url: 'https://ms/own/yunet.onnx' },
      { region: 'domestic', label: 'mirror', url: 'https://ms/mirror/yunet.onnx' },
      { region: 'global', label: 'official', url: 'https://hf/yunet.onnx' },
    ],
  }],
}
const pending: LocalModelSpec = { ...yunet, id: 'object_tracking_efficienttam', folderName: { zh: '跟踪', en: 'Tracking' }, availability: 'pending', files: [] }

const logger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

let root = ''
let preference: LocalModelDownloadSource = 'auto'
let events: LocalModelProgressEvent[] = []
let responses: Record<string, () => Response>
let requested: string[] = []
const selector: DownloadSourceSelector & { failures: string[] } = {
  failures: [],
  order: async (pref) => (pref === 'global' ? ['global', 'domestic'] : ['domestic', 'global']),
  reportFailure(region) { this.failures.push(region) },
  remembered: () => null,
}

const fetch: DownloadFetch = async (url) => {
  requested.push(url)
  const respond = responses[url]
  if (!respond) throw new TypeError('fetch failed')
  return respond()
}

function service(): LocalModelService {
  return new LocalModelService({
    manifest: [yunet, pending],
    modelsLocation: () => ({ dir: path.join(root, '模型'), locale: 'zh' }),
    selector, fetch,
    readPreference: () => preference,
    writePreference: (value) => { preference = value },
    emit: (event) => events.push(event),
    openPath: async () => '',
    logger,
    progressIntervalMs: 0,
  })
}

const ok = (): Response => new Response(bytes, { status: 200 })
const modelPath = (): string => path.join(root, '模型', '人脸检测 YuNet', 'yunet.onnx')

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-local-models-'))
  preference = 'auto'
  events = []
  requested = []
  selector.failures = []
  responses = {}
  vi.clearAllMocks()
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('本地模型服务', () => {
  it('我们的仓库还不存在（404）时自动换到镜像，下载后就绪并写说明文件', async () => {
    responses['https://ms/own/yunet.onnx'] = () => new Response('not found', { status: 404 })
    responses['https://ms/mirror/yunet.onnx'] = ok
    const models = service()
    expect((await models.info('face_detection_yunet')).status).toBe('not_downloaded')

    const result = await models.ensure('face_detection_yunet')
    expect(result.files[0]!.path).toBe(modelPath())
    expect(fs.readFileSync(modelPath()).equals(bytes)).toBe(true)
    expect(requested).toEqual(['https://ms/own/yunet.onnx', 'https://ms/mirror/yunet.onnx'])
    const description = fs.readFileSync(path.join(root, '模型', '人脸检测 YuNet', '说明.txt'), 'utf8')
    expect(description).toContain('许可证：MIT')
    expect(description).toContain(sha256)
    expect(description).toContain('https://ms/mirror/yunet.onnx')
    expect((await models.info('face_detection_yunet')).status).toBe('ready')
    expect(events.map((event) => event.status)).toEqual(expect.arrayContaining(['downloading', 'ready']))
    expect(events.at(-1)).toMatchObject({ status: 'ready', lastFailure: null })
  })

  it('国内全部失败时换国外源，并告知选择器首选区域失败', async () => {
    responses['https://hf/yunet.onnx'] = ok
    await service().ensure('face_detection_yunet')
    expect(requested.at(-1)).toBe('https://hf/yunet.onnx')
    expect(selector.failures).toContain('domestic')
  })

  it('选择国外时先试国外源', async () => {
    preference = 'global'
    responses['https://hf/yunet.onnx'] = ok
    await service().ensure('face_detection_yunet')
    expect(requested).toEqual(['https://hf/yunet.onnx'])
  })

  it('镜像文件被替换（哈希不符）时拒绝并换源；全部不符报 checksum', async () => {
    const tampered = Buffer.from(bytes)
    tampered[0] = 1
    responses['https://ms/own/yunet.onnx'] = () => new Response(tampered, { status: 200 })
    responses['https://ms/mirror/yunet.onnx'] = ok
    await service().ensure('face_detection_yunet')
    expect(fs.readFileSync(modelPath()).equals(bytes)).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'local_models.source.checksum_mismatch' }))

    fs.rmSync(path.join(root, '模型'), { recursive: true })
    for (const url of ['https://ms/own/yunet.onnx', 'https://ms/mirror/yunet.onnx', 'https://hf/yunet.onnx']) {
      responses[url] = () => new Response(tampered, { status: 200 })
    }
    const models = service()
    await expect(models.ensure('face_detection_yunet')).rejects.toThrow(/^checksum:/)
    expect(await models.info('face_detection_yunet')).toMatchObject({ status: 'not_downloaded', lastFailure: 'checksum' })
  })

  it('全部源连不上报 network，状态保持未下载并记下失败原因', async () => {
    const models = service()
    const error = await models.ensure('face_detection_yunet').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LocalModelError)
    expect((error as Error).message).toMatch(/^network:/)
    expect(await models.info('face_detection_yunet')).toMatchObject({ status: 'not_downloaded', lastFailure: 'network' })
  })

  it('同一模型并发 ensure 只下载一次', async () => {
    responses['https://ms/own/yunet.onnx'] = ok
    const models = service()
    const [a, b] = await Promise.all([models.ensure('face_detection_yunet'), models.ensure('face_detection_yunet')])
    expect(a.directory).toBe(b.directory)
    expect(requested).toEqual(['https://ms/own/yunet.onnx'])
  })

  it('文件被改动后状态为校验失败，ensure 会重新下载', async () => {
    responses['https://ms/own/yunet.onnx'] = ok
    const models = service()
    await models.ensure('face_detection_yunet')
    fs.writeFileSync(modelPath(), Buffer.alloc(bytes.length, 9))
    expect((await models.info('face_detection_yunet')).status).toBe('corrupt')
    await models.ensure('face_detection_yunet')
    expect((await models.info('face_detection_yunet')).status).toBe('ready')
    expect(requested).toHaveLength(2)
  })

  it('取消下载报 cancelled；删除后状态回到未下载', async () => {
    responses['https://ms/own/yunet.onnx'] = () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(bytes.subarray(0, 100))) },
    }), { status: 200 })
    const models = service()
    const running = models.ensure('face_detection_yunet')
    await vi.waitFor(() => expect(events.some((event) => (event.progress?.receivedBytes ?? 0) > 0)).toBe(true))
    expect(models.hasActiveDownloads()).toBe(true)
    expect(models.cancel('face_detection_yunet')).toBe(true)
    await expect(running).rejects.toThrow(/^cancelled:/)
    expect(models.hasActiveDownloads()).toBe(false)

    responses['https://ms/own/yunet.onnx'] = ok
    await models.ensure('face_detection_yunet')
    await models.remove('face_detection_yunet')
    expect(fs.existsSync(path.join(root, '模型', '人脸检测 YuNet'))).toBe(false)
    expect((await models.info('face_detection_yunet')).status).toBe('not_downloaded')
  })

  it('待提供的模型显示为不可下载，ensure 报 unavailable', async () => {
    const models = service()
    expect((await models.info('object_tracking_efficienttam')).status).toBe('unavailable')
    await expect(models.ensure('object_tracking_efficienttam')).rejects.toThrow(/^unavailable:/)
  })
})

describe('本地模型清单', () => {
  it('每个可下载文件都有国内与国外源、64 位小写 SHA-256 与正数大小', () => {
    for (const spec of LOCAL_MODEL_MANIFEST.filter((item) => item.availability === 'available')) {
      expect(spec.files.length).toBeGreaterThan(0)
      for (const file of spec.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(file.sizeBytes).toBeGreaterThan(0)
        expect(file.sources.some((source) => source.region === 'domestic')).toBe(true)
        expect(file.sources.some((source) => source.region === 'global')).toBe(true)
        expect(file.sources[0]!.label).toBe('own-modelscope')
      }
    }
  })
})
