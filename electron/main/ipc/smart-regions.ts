import fs from 'node:fs/promises'
import path from 'node:path'
import { SMART_REGIONS_IPC_CHANNELS, type SmartRegionRequest } from '../../../src/platform/contracts/smartRegions'
import { SMART_REGION_ANALYSIS_KINDS, type SmartRegionAnalysisKind } from '../../../src/core/videoEdit/smartRegions'
import { isPathWithinAllowedMediaRoots } from '../protocol'
import { normalizeLocalSource } from '../services/image/source'
import { getSmartRegionService } from '../services/smart-regions/runtime'
import { parseRecord, registerIpcHandler } from './registry'

/*
 * 智能区域 IPC（任务 4.7d）：渲染层经 preload `henjiNative.smartRegions` → PAL → `src/commands/smartRegions.ts` 调用。
 * 素材路径必须在已授权目录内（与缩略帧、解码同一规则）；分析进度经 `smartRegions:progress` 推给所有窗口。
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

async function authorized(request: SmartRegionRequest): Promise<SmartRegionRequest> {
  const normalized = normalizeLocalSource(request.source)
  if (!path.isAbsolute(normalized) || !isPathWithinAllowedMediaRoots(normalized)) throw new Error('素材尚未获得读取权限，请从素材库导入。')
  const canonical = await fs.realpath(normalized)
  if (!isPathWithinAllowedMediaRoots(canonical)) throw new Error('素材的实际路径不在已授权目录内。')
  // 保留调用方的路径写法：进度事件按原请求匹配，内容身份由服务按真实路径计算。
  return { ...request, source: normalized }
}

export function registerSmartRegionsIpc(): void {
  const c = SMART_REGIONS_IPC_CHANNELS
  registerIpcHandler(c.ensure, parseSmartRegionRequest, async request => getSmartRegionService().ensure(await authorized(request)))
  registerIpcHandler(c.cancel, parseSmartRegionRequest, async request => getSmartRegionService().cancel(await authorized(request)))
}
