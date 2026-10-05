import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import type { MediaInspectionResult } from './mediaInspection'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), stat: vi.fn(), realpath: vi.fn(), allowed: vi.fn(), probe: vi.fn(), thumbnail: vi.fn(), allowRoot: vi.fn(),
  info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ default: { stat: mocks.stat, realpath: mocks.realpath } }))
vi.mock('../db', () => ({ getDb: mocks.getDb }))
vi.mock('../db-locations', async () => ({ databaseLocations: (await import('../db-locations-identity.test-support')).identityDatabaseLocations }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => '/program/thumbnails' }))
vi.mock('../../protocol', () => ({ allowMediaRoot: mocks.allowRoot, isPathWithinAllowedMediaRoots: mocks.allowed }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: mocks.info, warn: mocks.warn, error: mocks.error }) }))
vi.mock('./mediaInspection', () => ({ inspectMedia: mocks.probe, normalizeAssetPath: (value: string) => value }))
vi.mock('./thumbnailService', () => ({ ensureAssetThumbnail: mocks.thumbnail }))

import { deleteAsset, inspectAsset, inspectAssetFileContent, relocateAsset, touchAsset, updateAsset } from './index'

interface TestAssetRow {
  id: string; media_type: string; display_name: string; file_path: string; source: string;
  mime_type: string | null; size_bytes: number | null; width: number | null; height: number | null;
  duration_seconds: number | null; thumbnail_name: string | null; inspection_status: string;
  inspection_error: string | null; file_modified_at: number | null; content_identity: string | null; last_used_at: number | null;
  created_at: number; updated_at: number;
}
function assetRow(): TestAssetRow {
  return { id: 'asset-1', media_type: 'video', display_name: '素材', file_path: 'D:/a.mp4', source: 'imported',
    mime_type: null, size_bytes: null, width: null, height: null, duration_seconds: null,
    thumbnail_name: null, inspection_status: 'pending', inspection_error: null,
    file_modified_at: null, content_identity: null, last_used_at: null, created_at: 1, updated_at: 1 }
}
class InspectionDb {
  readonly rows = new Map<string, TestAssetRow>([['asset-1', assetRow()]])
  readonly writes: string[] = []
  prepare(sql: string) {
    if (sql.startsWith('SELECT * FROM assets')) return { get: (id: string) => {
      const row = this.rows.get(id)
      return row ? { ...row } : undefined
    } }
    if (sql.startsWith('SELECT t.name') || sql.startsWith('SELECT library_id')) return { all: () => [] }
    if (sql.startsWith('DELETE FROM assets')) return { run: (id: string) => this.rows.delete(id) }
    if (sql.startsWith('UPDATE assets SET ')) return { run: (...values: unknown[]) => {
      const row = this.rows.get(String(values.at(-1)))
      if (!row) return { changes: 0 }
      const assignments = sql.slice('UPDATE assets SET '.length, sql.indexOf(' WHERE')).split(',')
      let offset = 0
      const patch: Record<string, unknown> = {}
      for (const assignment of assignments) {
        const [key, expression] = assignment.split('=')
        if (!key || !expression) throw new Error(`UNSUPPORTED_ASSIGNMENT:${assignment}`)
        patch[key.trim()] = expression === '?' ? values[offset++] : expression === 'NULL' ? null : expression.replace(/^'|'$/g, '')
      }
      Object.assign(row, patch)
      this.writes.push(sql)
      return { changes: 1 }
    } }
    throw new Error(`UNSUPPORTED_SQL:${sql}`)
  }
  asset(): TestAssetRow {
    const row = this.rows.get('asset-1')
    if (!row) throw new Error('Missing test asset')
    return row
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
interface FileStat { size: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number; isFile: () => boolean }
function fileStat(size = 100, mtimeMs = 42, ino = 1): FileStat {
  return { size, mtimeMs, ctimeMs: mtimeMs, dev: 1, ino, isFile: () => true }
}
function mediaInfo(width = 1920, stat = fileStat()): MediaInspectionResult {
  return { mimeType: 'video/mp4', sizeBytes: stat.size, width, height: 1080, durationSeconds: 3, fileModifiedAt: stat.mtimeMs }
}
function missingError(): NodeJS.ErrnoException { return Object.assign(new Error('源文件不存在'), { code: 'ENOENT' }) }

describe('资产检查与原文件内容归属', () => {
  it('固定原路径只读核验和正式资产检查同身份，删除资产记录不改变源文件核验', async () => {
    const original = await inspectAsset('asset-1')
    expect(await inspectAssetFileContent(original.filePath, original.mediaType)).toEqual({ sizeBytes: original.sizeBytes, fileModifiedAt: original.fileModifiedAt, contentIdentity: original.contentIdentity })
    deleteAsset('asset-1')
    expect((await inspectAssetFileContent(original.filePath, original.mediaType)).contentIdentity).toBe(original.contentIdentity)
    expect(mocks.probe).toHaveBeenCalledTimes(1)
  })
  it('固定原路径核验拒绝未授权和symlink越界，在授权内的链接保持原路径摘要', async () => {
    mocks.allowed.mockReturnValue(false)
    await expect(inspectAssetFileContent('D:/a.mp4', 'video')).rejects.toThrow('读取权限')
    expect(mocks.stat).not.toHaveBeenCalled()
    mocks.allowed.mockImplementation((filePath: string) => !filePath.includes('outside'))
    mocks.realpath.mockResolvedValueOnce('D:/outside/secret.mp4')
    await expect(inspectAssetFileContent('D:/a.mp4', 'video')).rejects.toThrow('实际路径')
    expect(mocks.stat).not.toHaveBeenCalled()
    const registered = await inspectAsset('asset-1')
    mocks.realpath.mockResolvedValue('D:/b.mp4'); mocks.stat.mockResolvedValue(fileStat())
    expect((await inspectAssetFileContent('D:/a.mp4', 'video')).contentIdentity).toBe(registered.contentIdentity)
  })
  it('原路径核验真实I/O最多两项，在真实stat完成前不释放许可，失败后队列可继续', async () => {
    const finish: Array<(value: FileStat) => void> = []
    mocks.stat.mockImplementation(() => new Promise(resolve => finish.push(resolve)))
    const checks = Array.from({ length: 3 }, () => inspectAssetFileContent('D:/a.mp4', 'video'))
    await vi.waitFor(() => expect(mocks.stat).toHaveBeenCalledTimes(2))
    finish[0](fileStat()); await vi.waitFor(() => expect(mocks.stat).toHaveBeenCalledTimes(3))
    finish[1](fileStat()); finish[2](fileStat()); expect(await Promise.all(checks)).toHaveLength(3)
    mocks.allowed.mockReturnValueOnce(false)
    await expect(inspectAssetFileContent('D:/a.mp4', 'video')).rejects.toThrow('读取权限')
    mocks.stat.mockResolvedValue(fileStat()); await expect(inspectAssetFileContent('D:/a.mp4', 'video')).resolves.toMatchObject({ sizeBytes: 100 })
  })
  let database: InspectionDb
  let files: Map<string, FileStat>
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.allowed.mockReturnValue(true); mocks.realpath.mockImplementation(async (filePath: string) => filePath)
    database = new InspectionDb()
    files = new Map([['D:/a.mp4', fileStat()], ['D:/b.mp4', fileStat(200, 84, 2)]])
    mocks.getDb.mockReturnValue(database)
    mocks.stat.mockImplementation(async (filePath: string) => {
      const stat = files.get(filePath)
      if (!stat) throw missingError()
      return { ...stat }
    })
    mocks.probe.mockImplementation(async (filePath: string) => mediaInfo(filePath === 'D:/a.mp4' ? 1920 : 3840, files.get(filePath)))
    mocks.thumbnail.mockImplementation(async (filePath: string) => `${filePath}.thumbnail.webp`)
  })

  it('正常检查发布当前媒体元数据与缩略图', async () => {
    const result = await inspectAsset('asset-1')
    expect(result).toMatchObject({ filePath: 'D:/a.mp4', inspectionStatus: 'ready', width: 1920, sizeBytes: 100, fileModifiedAt: 42, thumbnailPath: path.join('/program/thumbnails', 'a.mp4.thumbnail.webp') })
    expect(result.contentIdentity).toMatch(/^[a-f0-9]{64}$/)
    expect(result.contentIdentity).toBe(database.asset().content_identity)
    expect(mocks.probe).toHaveBeenCalledTimes(1)
    expect(mocks.thumbnail).toHaveBeenCalledWith('D:/a.mp4', 'video', 42, expect.any(AbortSignal))
    expect(mocks.stat).toHaveBeenCalledTimes(3)
  })

  it('ready同size/mtime直接复用；改名和touch不触发媒体解码并恢复读取权限', async () => {
    await inspectAsset('asset-1')
    updateAsset({ id: 'asset-1', displayName: '重命名素材' })
    touchAsset('asset-1')
    const updatedAt = database.asset().updated_at
    vi.clearAllMocks()
    const result = await inspectAsset('asset-1')
    expect(result).toMatchObject({ displayName: '重命名素材', inspectionStatus: 'ready', updatedAt })
    expect(mocks.stat).toHaveBeenCalledTimes(1)
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(mocks.thumbnail).not.toHaveBeenCalled()
    expect(mocks.allowRoot).toHaveBeenCalledWith(path.dirname('D:/a.mp4'))
    expect(mocks.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'asset.inspect.completed', context: { assetId: 'asset-1', reused: true } }))
  })

  it('同内容并发共用在途探测，回执读取当前DB名称与状态', async () => {
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise)
    const first = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    const second = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.stat).toHaveBeenCalledTimes(2))
    updateAsset({ id: 'asset-1', displayName: '检查期间重命名' })
    probe.resolve(mediaInfo())
    expect(await first).toMatchObject({ displayName: '检查期间重命名', inspectionStatus: 'ready' })
    expect(await second).toMatchObject({ displayName: '检查期间重命名', inspectionStatus: 'ready' })
    expect(mocks.probe).toHaveBeenCalledTimes(1)
    expect(mocks.thumbnail).toHaveBeenCalledTimes(1)
  })

  it('复用中的调用方也返回内容变化后的pending，不返回原检查的假ready', async () => {
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise)
    const first = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    const second = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.stat).toHaveBeenCalledTimes(2))
    files.set('D:/a.mp4', fileStat(300, 126, 3))
    probe.resolve(mediaInfo())
    expect(await first).toMatchObject({ inspectionStatus: 'pending', contentIdentity: null })
    expect(await second).toMatchObject({ inspectionStatus: 'pending', contentIdentity: null })
    expect(mocks.probe).toHaveBeenCalledTimes(1)
  })

  it('同内容复用后资产被删除，所有调用方拒绝而不是返回已删除记录', async () => {
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise)
    const first = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    const second = inspectAsset('asset-1')
    const rejectedFirst = expect(first).rejects.toThrow('资产不存在')
    const rejectedSecond = expect(second).rejects.toThrow('资产不存在')
    await vi.waitFor(() => expect(mocks.stat).toHaveBeenCalledTimes(2))
    deleteAsset('asset-1')
    probe.resolve(mediaInfo())
    await Promise.all([rejectedFirst, rejectedSecond])
    expect(database.rows.has('asset-1')).toBe(false)
  })

  it('旧成功晚到不能覆盖重新定位后的媒体', async () => {
    const oldProbe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(oldProbe.promise)
    const original = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    expect(await relocateAsset('asset-1', 'D:/b.mp4')).toMatchObject({ width: 3840, inspectionStatus: 'ready' })
    oldProbe.resolve(mediaInfo(720))
    expect(await original).toMatchObject({ filePath: 'D:/b.mp4', width: 3840, sizeBytes: 200 })
    expect(mocks.thumbnail).toHaveBeenCalledTimes(1)
    expect(mocks.info.mock.calls.filter(([, detail]) => detail.event === 'asset.inspect.completed')).toHaveLength(1)
  })

  it('旧失败晚到只记录stale/discarded，不污染新内容状态', async () => {
    const oldProbe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(oldProbe.promise)
    const original = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    await relocateAsset('asset-1', 'D:/b.mp4')
    oldProbe.reject(new Error('旧素材解码失败'))
    expect(await original).toMatchObject({ filePath: 'D:/b.mp4', inspectionStatus: 'ready', inspectionError: null })
    expect(mocks.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'asset.inspect.failed', context: expect.objectContaining({ stale: true, discarded: true }) }))
  })

  it('A→B→A仍以新owner为准，旧成功和旧失败都不能复用', async () => {
    const oldA = deferred<MediaInspectionResult>()
    const oldB = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(oldB.promise).mockResolvedValueOnce(mediaInfo(4096))
    const first = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    const second = relocateAsset('asset-1', 'D:/b.mp4')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(2))
    expect(await relocateAsset('asset-1', 'D:/a.mp4')).toMatchObject({ width: 4096 })
    oldA.resolve(mediaInfo(720)); oldB.reject(new Error('过期B失败'))
    expect(await first).toMatchObject({ filePath: 'D:/a.mp4', width: 4096 })
    expect(await second).toMatchObject({ filePath: 'D:/a.mp4', width: 4096 })
    expect(database.asset().inspection_error).toBeNull()
  })

  it('相同路径重新定位开启新检查，不复用或接受旧结果', async () => {
    const oldProbe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(oldProbe.promise).mockResolvedValueOnce(mediaInfo(2560))
    const original = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    expect(await relocateAsset('asset-1', 'D:/a.mp4')).toMatchObject({ width: 2560 })
    oldProbe.resolve(mediaInfo(720))
    expect(await original).toMatchObject({ width: 2560 })
    expect(mocks.probe).toHaveBeenCalledTimes(2)
  })

  it('旧任务finally不能删除仍在探测的新owner；后续同内容调用仍复用新job', async () => {
    const oldProbe = deferred<MediaInspectionResult>()
    const newProbe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(oldProbe.promise).mockReturnValueOnce(newProbe.promise)
    const old = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    const current = relocateAsset('asset-1', 'D:/b.mp4')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(2))
    oldProbe.resolve(mediaInfo())
    expect(await old).toMatchObject({ filePath: 'D:/b.mp4', inspectionStatus: 'pending' })
    const joined = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.stat).toHaveBeenCalledTimes(3))
    expect(mocks.probe).toHaveBeenCalledTimes(2)
    newProbe.resolve(mediaInfo(3840, fileStat(200, 84, 2)))
    expect(await current).toMatchObject({ width: 3840, inspectionStatus: 'ready' })
    expect(await joined).toMatchObject({ width: 3840, inspectionStatus: 'ready' })
  })

  it('同路径原文件更换启动新检查，原size/mtime回执不能覆盖新内容', async () => {
    const oldProbe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(oldProbe.promise)
    const old = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    files.set('D:/a.mp4', fileStat(300, 126, 3))
    expect(await inspectAsset('asset-1')).toMatchObject({ sizeBytes: 300, fileModifiedAt: 126 })
    oldProbe.resolve(mediaInfo(720))
    expect(await old).toMatchObject({ sizeBytes: 300, fileModifiedAt: 126, width: 1920 })
  })

  it('size/mtime相同但ino/ctime变化的在途文件仍不能被视为原内容', async () => {
    const oldProbe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(oldProbe.promise).mockResolvedValueOnce(mediaInfo(2560))
    const old = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    files.set('D:/a.mp4', { ...fileStat(), ino: 4, ctimeMs: 43 })
    expect(await inspectAsset('asset-1')).toMatchObject({ width: 2560 })
    oldProbe.resolve(mediaInfo(720))
    expect(await old).toMatchObject({ width: 2560 })
    expect(mocks.probe).toHaveBeenCalledTimes(2)
  })

  it('probe期间文件变化只保留可行动pending，下一次显式检查可恢复', async () => {
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise)
    const checking = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    files.set('D:/a.mp4', fileStat(300, 126, 3))
    probe.resolve(mediaInfo())
    expect(await checking).toMatchObject({ inspectionStatus: 'pending', inspectionError: expect.stringContaining('重新检查'), width: null })
    expect(mocks.thumbnail).not.toHaveBeenCalled()
    expect(await inspectAsset('asset-1')).toMatchObject({ inspectionStatus: 'ready', sizeBytes: 300, fileModifiedAt: 126 })
  })

  it('thumbnail期间文件变化不发布旧缩略图或媒体数据', async () => {
    const thumbnail = deferred<string>()
    mocks.thumbnail.mockReturnValueOnce(thumbnail.promise)
    const checking = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledTimes(1))
    files.set('D:/a.mp4', fileStat(300, 126, 3))
    thumbnail.resolve('D:/old-thumbnail.webp')
    expect(await checking).toMatchObject({ inspectionStatus: 'pending', thumbnailPath: null, inspectionError: expect.stringContaining('重新检查') })
    expect(database.asset().size_bytes).toBeNull()
  })

  it('旧缩略图取消/失败晚到不覆盖新内容，取消信号归属原job', async () => {
    const thumbnail = deferred<string>()
    mocks.thumbnail.mockReturnValueOnce(thumbnail.promise)
    const checking = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledTimes(1))
    const originalSignal = mocks.thumbnail.mock.calls[0]?.[3] as AbortSignal
    await relocateAsset('asset-1', 'D:/b.mp4')
    expect(originalSignal.aborted).toBe(true)
    thumbnail.reject(new Error('旧缩略图失败'))
    expect(await checking).toMatchObject({ filePath: 'D:/b.mp4', inspectionStatus: 'ready', thumbnailPath: path.join('/program/thumbnails', 'b.mp4.thumbnail.webp') })
    expect(mocks.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'asset.thumbnail.failed', context: { assetId: 'asset-1', stale: true } }))
  })

  it('实际失败标failed；源文件缺失标missing而不启动解码', async () => {
    mocks.probe.mockRejectedValueOnce(new Error('媒体不可解码'))
    expect(await inspectAsset('asset-1')).toMatchObject({ inspectionStatus: 'failed', inspectionError: '媒体不可解码' })
    files.delete('D:/a.mp4')
    mocks.probe.mockClear()
    expect(await inspectAsset('asset-1')).toMatchObject({ inspectionStatus: 'missing' })
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(mocks.thumbnail).not.toHaveBeenCalled()
  })

  it('旧内容解码失败时文件已经改变，保留pending而不是把失败归给新内容', async () => {
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise)
    const checking = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    files.set('D:/a.mp4', fileStat(300, 126, 3))
    probe.reject(new Error('旧文件解码失败'))
    expect(await checking).toMatchObject({ inspectionStatus: 'pending', inspectionError: expect.stringContaining('重新检查') })
    expect(mocks.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'asset.inspect.failed', context: expect.objectContaining({ stale: true, discarded: true }) }))
  })

  it('解码失败同时源文件消失，将当前检查标为missing', async () => {
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise)
    const checking = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    files.delete('D:/a.mp4')
    probe.reject(new Error('媒体读取失败'))
    expect(await checking).toMatchObject({ inspectionStatus: 'missing', inspectionError: '媒体读取失败' })
  })

  it('检查期间删除不复活记录，旧成功回执不返回假ready', async () => {
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise)
    const checking = inspectAsset('asset-1')
    const rejected = expect(checking).rejects.toThrow('资产不存在')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    deleteAsset('asset-1')
    probe.resolve(mediaInfo())
    await rejected
    expect(database.rows.has('asset-1')).toBe(false)
    expect(mocks.thumbnail).not.toHaveBeenCalled()
  })

  it('删除后即使同id/路径/创建时间重建，也不接受旧owner回执', async () => {
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise).mockResolvedValueOnce(mediaInfo(2560))
    const old = inspectAsset('asset-1')
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1))
    deleteAsset('asset-1')
    database.rows.set('asset-1', assetRow())
    expect(await inspectAsset('asset-1')).toMatchObject({ width: 2560 })
    probe.resolve(mediaInfo(720))
    expect(await old).toMatchObject({ width: 2560 })
  })

  it('首个stat尚未回执时同路径重新定位，旧stat不能启动probe', async () => {
    const oldStat = deferred<FileStat>()
    mocks.stat.mockReturnValueOnce(oldStat.promise)
    const old = inspectAsset('asset-1')
    expect(await relocateAsset('asset-1', 'D:/a.mp4')).toMatchObject({ inspectionStatus: 'ready' })
    oldStat.resolve(fileStat())
    expect(await old).toMatchObject({ inspectionStatus: 'ready', width: 1920 })
    expect(mocks.probe).toHaveBeenCalledTimes(1)
  })

  it('同mtime但size变化的ready资产仍重新探测并请求真实缩略图', async () => {
    await inspectAsset('asset-1')
    files.set('D:/a.mp4', fileStat(300, 42, 3))
    expect(await inspectAsset('asset-1')).toMatchObject({ inspectionStatus: 'ready', sizeBytes: 300, fileModifiedAt: 42 })
    expect(mocks.probe).toHaveBeenCalledTimes(2)
    expect(mocks.thumbnail).toHaveBeenCalledTimes(2)
  })

  it('ready资产保留size/mtime但替换文件身份时重新检查并发布不同持久摘要', async () => {
    const original = await inspectAsset('asset-1')
    files.set('D:/a.mp4', { ...fileStat(), ino: 4, ctimeMs: 43 })
    mocks.probe.mockResolvedValueOnce(mediaInfo(2560))
    const current = await inspectAsset('asset-1')
    expect(current).toMatchObject({ inspectionStatus: 'ready', sizeBytes: original.sizeBytes, fileModifiedAt: original.fileModifiedAt, width: 2560 })
    expect(current.contentIdentity).not.toBe(original.contentIdentity)
    expect(mocks.probe).toHaveBeenCalledTimes(2)
    expect(mocks.thumbnail).toHaveBeenCalledTimes(2)
    expect((await inspectAsset('asset-1')).contentIdentity).toBe(current.contentIdentity)
    expect(mocks.probe).toHaveBeenCalledTimes(2)
  })

  it('旧ready记录无摘要时首次重查；同路径relink期间清空摘要而非复用旧ready', async () => {
    Object.assign(database.asset(), { inspection_status: 'ready', size_bytes: 100, file_modified_at: 42, width: 720 })
    const current = await inspectAsset('asset-1')
    expect(current).toMatchObject({ width: 1920, contentIdentity: expect.any(String) })
    expect(mocks.probe).toHaveBeenCalledTimes(1)
    const probe = deferred<MediaInspectionResult>()
    mocks.probe.mockReturnValueOnce(probe.promise)
    const relocated = relocateAsset('asset-1', 'D:/a.mp4')
    expect(database.asset()).toMatchObject({ inspection_status: 'pending', content_identity: null })
    await vi.waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(2))
    probe.resolve(mediaInfo())
    expect((await relocated).contentIdentity).toBe(current.contentIdentity)
  })
})
