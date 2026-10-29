import fs from 'node:fs/promises'
import { z } from 'zod'
import { ocrPrivacyRequestSchema } from '../../../src/platform/contracts/ocrPrivacy'
import { getOcrPrivacyService } from '../services/smart-regions/runtime'
import path from 'node:path'
import { SMART_REGIONS_IPC_CHANNELS, type SmartRegionRequest } from '../../../src/platform/contracts/smartRegions'
import { SMART_REGION_ANALYSIS_KINDS, type SmartRegionAnalysisKind } from '../../../src/core/videoEdit/smartRegions'
import { normalizeLocalSource } from '../services/image/source'
import { getSmartRegionService } from '../services/smart-regions/runtime'
import { parseRecord, registerIpcHandler } from './registry'

/*
 * 智能区域 IPC：渲染层经 preload `henjiNative.smartRegions` → PAL → `src/commands/smartRegions.ts` 调用。
 * 素材使用本地文件路径；分析进度经 `smartRegions:progress` 推给所有窗口。
 */

/** 素材时间上限：24 小时（微秒）。 */
const MAX_TIME_US = 24 * 3600 * 1e6

export function parseSmartRegionRequest(input: unknown): SmartRegionRequest {
  const record = parseRecord(input)
  const { source, kind, startUs, endUs, still } = record
  if (Object.keys(record).some(key => !['source', 'kind', 'startUs', 'endUs', 'still'].includes(key))) throw new Error('智能区域请求含未知字段。')
  if (typeof source !== 'string' || !source.trim()) throw new Error('智能区域请求缺少素材。')
  if (typeof kind !== 'string' || !(SMART_REGION_ANALYSIS_KINDS as readonly string[]).includes(kind)) throw new Error('无效的智能区域种类。')
  if (typeof still !== 'boolean') throw new Error('智能区域请求缺少 still。')
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME_US
  if (!valid(startUs) || !valid(endUs) || (!still && endUs <= startUs)) throw new Error('无效的智能区域时间范围。')
  return { source, kind: kind as SmartRegionAnalysisKind, startUs, endUs, still }
}

async function resolveRequest(request: SmartRegionRequest): Promise<SmartRegionRequest> {
  const normalized = normalizeLocalSource(request.source)
  if (!path.isAbsolute(normalized)) throw new Error('请使用本地文件的绝对路径。')
  await fs.realpath(normalized)
  // 保留调用方的路径写法：进度事件按原请求匹配，内容身份由服务按真实路径计算。
  return { ...request, source: normalized }
}

export function registerSmartRegionsIpc(): void {
  const c = SMART_REGIONS_IPC_CHANNELS
  const owners = new Map<string, { senderId: number; cancelled: boolean }>()
  registerIpcHandler(c.detectSensitiveText, raw => ocrPrivacyRequestSchema.parse(raw), async (request, event) => {
    if (owners.has(request.requestId)) throw new Error('敏感信息识别请求重复。')
    const owner = { senderId: event.sender.id, cancelled: false }; owners.set(request.requestId, owner)
    const closed = (): void => { owner.cancelled = true; getOcrPrivacyService().cancel(request.requestId) }
    event.sender.once('destroyed', closed)
    try { const checked = await resolveRequest({ source: request.source, kind: 'text', startUs: request.startUs, endUs: request.endUs, still: false }); if (owner.cancelled || event.sender.isDestroyed()) throw new Error('敏感信息识别已取消。'); return await getOcrPrivacyService().detect({ ...request, source: checked.source }) }
    finally { owners.delete(request.requestId); event.sender.removeListener('destroyed', closed) }
  })
  registerIpcHandler(c.cancelSensitiveText, raw => z.object({ requestId: z.string().uuid() }).strict().parse(raw), (request, event) => {
    const owner = owners.get(request.requestId)
    if (owner && owner.senderId !== event.sender.id) throw new Error('不能取消其他窗口的识别任务。')
    if (owner) owner.cancelled = true
    getOcrPrivacyService().cancel(request.requestId)
  })
  registerIpcHandler(c.ensure, parseSmartRegionRequest, async request => getSmartRegionService().ensure(await resolveRequest(request)))
  registerIpcHandler(c.cancel, parseSmartRegionRequest, async request => getSmartRegionService().cancel(await resolveRequest(request)))
}
