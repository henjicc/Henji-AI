import { app, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { MUSIC_ANALYSIS_CHANNELS, type MusicAnalysisProgress } from '../../../src/platform/contracts/musicAnalysis'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { isPathWithinAllowedMediaRoots } from '../protocol'
import { normalizeLocalSource } from '../services/image/source'
import { createMainLogger } from '../services/logging'
import { getMusicAnalysisService } from '../services/music-analysis/runtime'

const logger = createMainLogger('main.music_analysis')
const tasks = new Map<number, Map<string, AbortController>>()
const watched = new WeakSet<WebContents>()
const requestSchema = z.object({ requestId: z.string().min(1).max(100), source: z.string().min(1).max(32768) }).strict()

function release(senderId: number): void { for (const controller of tasks.get(senderId)?.values() ?? []) controller.abort(new Error('音乐分析已取消。')); tasks.delete(senderId) }

async function authorizedSource(source: string): Promise<string> {
  const local = normalizeLocalSource(source)
  if (!path.isAbsolute(local) || !isPathWithinAllowedMediaRoots(local)) throw new Error('音频尚未获得读取权限，请从素材面板导入。')
  const canonical = await fs.realpath(local)
  if (!isPathWithinAllowedMediaRoots(canonical)) throw new Error('音频实际位置不在已授权目录内，请重新导入。')
  return canonical
}

export function registerMusicAnalysisHandlers(): void {
  registerIpcHandler(MUSIC_ANALYSIS_CHANNELS.analyze, value => requestSchema.parse(value), async (request, event) => {
    const sender = event.sender; const senderId = sender.id
    if (!watched.has(sender)) {
      watched.add(sender); sender.once('destroyed', () => release(senderId))
      sender.on('did-start-navigation', (_event, _url, _inPlace, main) => { if (main) release(senderId) })
    }
    let owned = tasks.get(senderId)
    if (!owned) { owned = new Map(); tasks.set(senderId, owned) }
    if (owned.has(request.requestId) || owned.size >= 2) throw new Error('音乐分析正在进行，请等待或取消。')
    const controller = new AbortController(); owned.set(request.requestId, controller)
    logger.info('开始音乐结构分析', { event: 'music_analysis.analyze.start', requestId: request.requestId })
    try {
      const canonical = await authorizedSource(request.source)
      const result = await getMusicAnalysisService().analyze(canonical, controller.signal, progress => {
        if (!sender.isDestroyed()) sender.send(MUSIC_ANALYSIS_CHANNELS.progress, { requestId: request.requestId, ...progress } satisfies MusicAnalysisProgress)
      })
      logger.info('音乐结构分析完成', { event: 'music_analysis.analyze.completed', requestId: request.requestId, context: { cached: result.cached, model: result.model, beatSource: result.analysis.beatSource, beats: result.analysis.beats.length, tempo: result.analysis.tempo, beatsPerBar: result.analysis.beatsPerBar, suitable: result.analysis.suitable, seconds: Math.round(result.analysis.durationSeconds), ...(result.timings ?? {}) } })
      return result
    } catch (error) { logger.error('音乐结构分析未完成', { event: controller.signal.aborted ? 'music_analysis.analyze.cancelled' : 'music_analysis.analyze.failed', requestId: request.requestId, error }); throw error }
    finally { owned.delete(request.requestId) }
  }, assertTrustedApplicationSender)
  registerIpcHandler(MUSIC_ANALYSIS_CHANNELS.cancel, value => z.string().min(1).max(100).parse(value), (id, event) => { tasks.get(event.sender.id)?.get(id)?.abort(new Error('音乐分析已取消。')) }, assertTrustedApplicationSender)
  app.once('before-quit', () => { for (const senderId of tasks.keys()) release(senderId) })
}
