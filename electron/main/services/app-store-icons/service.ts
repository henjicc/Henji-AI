/** 高清图获取方法参考 YuKongA/HQ-ICON（MIT）。数据来自苹果 Search API；直接请求透明 PNG，不重画苹果遮罩。 */
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { normalizeEntryName } from '../../../../src/core/documents/naming'
import { searchAppStoreIconsSchema, saveAppStoreIconSchema, type AppStoreIconSearchResult, type SavedAppStoreIcon, type SaveAppStoreIconInput } from '../../../../src/core/appStoreIcons'
import type { ImportFileRequest, ImportFileResult } from '../../../../src/core/documents/types'
import type { CreateAssetRequest, AssetDto } from '../asset-library/types'
import type { MainLogger } from '../logging/main-logger'
import { APP_STORE_ENTITIES, filterAppStoreResults, iconArtworkUrl, parseAppStoreInput, type AppStoreRecord } from './lookup'

export interface AppStoreIconDependencies {
  logger: MainLogger
  tempRoot: string
  fetch?: typeof fetch
  requireProject(id: string): Promise<void>
  importFile(input: ImportFileRequest): Promise<ImportFileResult>
  createAsset(input: CreateAssetRequest): AssetDto | Promise<AssetDto>
  inspectAsset(id: string): Promise<AssetDto>
  deleteAsset(id: string): void
}

const TIMEOUT_MS = 25_000
const MAX_BYTES = 16 * 1024 * 1024

export class AppStoreIconService {
  constructor(private readonly dependencies: AppStoreIconDependencies) {}

  private async logged<T>(action: string, facts: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    const logger = this.dependencies.logger
    logger.info('开始获取 App Store 图标', { event: `app_store_icons.${action}.start`, context: facts })
    try {
      const result = await run()
      logger.info('App Store 图标操作完成', { event: `app_store_icons.${action}.completed`, context: facts })
      return result
    } catch (error) {
      // 不记录响应体、用户搜索词或文件路径。
      logger.error('App Store 图标操作失败', { event: `app_store_icons.${action}.failed`, context: { ...facts, errorName: error instanceof Error ? error.name : 'Error' } })
      throw error
    }
  }

  private async request(url: URL): Promise<Buffer> {
    let status: number | undefined
    try {
      const response = await (this.dependencies.fetch ?? fetch)(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
      status = response.status
      if (!response.ok) throw new Error(`HTTP ${status}`)
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('响应超过 16 MiB 限制')
      const chunks: Uint8Array[] = []
      let size = 0
      if (!response.body) throw new Error('响应没有内容')
      const reader = response.body.getReader()
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.length
          if (size > MAX_BYTES) { await reader.cancel(); throw new Error('响应超过 16 MiB 限制') }
          chunks.push(next.value)
        }
      } finally { reader.releaseLock() }
      return Buffer.concat(chunks)
    } catch (error) {
      const reason = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? `超过 ${TIMEOUT_MS / 1000} 秒超时`
        : status !== undefined ? `HTTP ${status}${error instanceof Error && error.message.includes('16 MiB') ? '，响应超过 16 MiB 限制' : '，响应读取失败'}` : '连接未完成，未收到 HTTP 状态'
      throw new Error(`App Store 请求失败（${url.hostname}，${reason}）。请检查网络后重试。`)
    }
  }

  private async records(query: string | { appId: string }, country: string, platform: SaveAppStoreIconInput['platform'], limit: number): Promise<{ country: string; records: AppStoreRecord[] }> {
    const term = typeof query === 'string' ? query : query.appId
    const parsed = typeof query === 'string' ? parseAppStoreInput(query) : { id: query.appId, country: null }
    const region = parsed?.country ?? country.toLowerCase()
    const url = new URL(`https://itunes.apple.com/${parsed ? 'lookup' : 'search'}`)
    url.search = new URLSearchParams(parsed ? { id: parsed.id, country: region } : { term, country: region, entity: APP_STORE_ENTITIES[platform], limit: String(limit) }).toString()
    let data: unknown
    try { data = JSON.parse((await this.request(url)).toString('utf8')) } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`苹果 Search API 返回的不是有效 JSON（地区 ${region}，平台 ${platform}）。请稍后重试。`)
      throw error
    }
    const records = filterAppStoreResults(data, platform).filter(r => !parsed || r.appId === parsed.id).slice(0, limit)
    if (!records.length) throw new Error(`没有找到带高清图标的应用（地区 ${region}，平台 ${platform}${parsed ? `，编号 ${parsed.id}` : ''}）。可以换地区、换平台或粘贴 App Store 链接。`)
    return { country: region, records }
  }

  async search(raw: unknown): Promise<AppStoreIconSearchResult> {
    const input = searchAppStoreIconsSchema.parse(raw)
    return this.logged('search', { country: input.country, platform: input.platform }, async () => {
      const result = await this.records(input.query, input.country, input.platform, input.limit)
      return { country: result.country, candidates: result.records.map(({ artworkUrl512: _url, ...candidate }) => candidate) }
    })
  }

  async save(raw: unknown): Promise<SavedAppStoreIcon> {
    const input = saveAppStoreIconSchema.parse(raw)
    return this.logged('save', { appId: input.appId, country: input.country, platform: input.platform, projectId: input.projectId }, async () => {
      let published: string | undefined
      let assetId: string | undefined
      let temporary: string | undefined
      try {
        if (!input.projectId) throw new Error('没有当前项目。请用 list_projects 取得项目标识并传入 projectId。')
        await this.dependencies.requireProject(input.projectId)
        const { records } = await this.records({ appId: input.appId }, input.country, input.platform, 1)
        const app = records[0]
        const bytes = await this.request(new URL(iconArtworkUrl(app.artworkUrl512, input.resolution, input.shape)))
        await this.verifyImage(bytes, input)
        await fs.mkdir(this.dependencies.tempRoot, { recursive: true })
        temporary = await fs.mkdtemp(path.join(this.dependencies.tempRoot, 'app-icon-'))
        const stem = [...app.name].map(character => character.charCodeAt(0) < 32 ? '_' : character).join('').replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '').slice(0, 110).trim() || 'App'
        const safeStem = normalizeEntryName(stem).ok ? stem : `_${stem}`
        const sourcePath = path.join(temporary, `${safeStem}.png`)
        await fs.writeFile(sourcePath, bytes, { flag: 'wx' })
        const imported = await this.dependencies.importFile({ container: { kind: 'project', projectId: input.projectId }, sourcePath, folder: 'materials', subfolder: '图标', reuseIdentical: false })
        if (!imported.copied) throw new Error('图标未创建独立副本，未登记素材。')
        published = imported.path
        const verified = await this.verifyImage(await fs.readFile(published), input)
        const asset = await this.dependencies.createAsset({ filePath: published, mediaType: 'image', displayName: app.name, source: 'imported' })
        assetId = asset.id
        const readback = await this.dependencies.inspectAsset(asset.id)
        if (readback.inspectionStatus !== 'ready' || readback.width !== input.resolution || readback.height !== input.resolution) throw new Error('素材库回读未确认图标尺寸与可用状态。')
        return { assetRef: { kind: 'asset', id: asset.id }, projectId: input.projectId, name: app.name,
          width: input.resolution, height: input.resolution, transparentCorners: verified,
          verification: { verified: true, condition: 'PNG 文件已回读解码，尺寸及透明角已检查，素材库已回读确认。' } }
      } catch (error) {
        try {
          if (assetId) this.dependencies.deleteAsset(assetId)
          if (published) await fs.unlink(published)
        } catch {
          throw new Error(`图标保存未完成，且清理未确认（应用 ${input.appId}，项目 ${input.projectId}${assetId ? `，素材 ${assetId}` : ''}）。请先检查项目素材，勿重复保存。`)
        }
        // IPC 保留错误 name；只在未写入或补偿成功后标记可安全重试。
        const failure = new Error(`图标未保存（应用 ${input.appId}，地区 ${input.country}，平台 ${input.platform}）。${error instanceof Error && !published ? error.message.replace(/(?:[A-Z]:\\|\/)[^\n]*$/i, '文件操作失败，请检查项目是否可写。') : '文件或素材登记失败，已清理本次写入，请检查项目是否可写后重试。'}`)
        failure.name = 'DocumentLocationError'
        throw failure
      } finally {
        if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {
          this.dependencies.logger.warn('图标临时文件清理失败', { event: 'app_store_icons.cleanup.failed', context: { appId: input.appId } })
        })
      }
    })
  }

  private async verifyImage(bytes: Buffer, input: SaveAppStoreIconInput): Promise<boolean> {
    const image = sharp(bytes, { limitInputPixels: 1024 * 1024 })
    const metadata = await image.metadata()
    if (metadata.format !== 'png' || metadata.width !== input.resolution || metadata.height !== input.resolution) {
      throw new Error(`苹果图标不是请求的 ${input.resolution}×${input.resolution} PNG（实际 ${metadata.format} ${metadata.width}×${metadata.height}）。`)
    }
    const { data, info } = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const transparent = [3, info.width * 4 - 1, (info.height - 1) * info.width * 4 + 3, data.length - 1].every(i => data[i] === 0)
    if (input.shape === 'official' && !transparent) throw new Error('苹果官方遮罩 PNG 的四角不透明，未保存为透明图标。可改用 square 获取方形原图。')
    return transparent
  }
}
