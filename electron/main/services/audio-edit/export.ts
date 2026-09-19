import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { buildAudioEditTimeline, editedDurationFrames } from '../../../../src/core/audioEdit/timeline'
import { buildAudioEditSrt } from '../../../../src/core/audioEdit/subtitles'
import type { AudioEditExportRequest, AudioEditExportResult } from '../../../../src/core/audioEdit/types'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { createMainLogger } from '../logging'
import { requireAudioEditProject } from './project-store'
import { processAudioEditVstChain } from './processors'

const logger = createMainLogger('main.audio_edit.export')

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${path.basename(binary)} failed: ${error.message}\n${stderr}`))
      else resolve()
    })
  })
}

export async function exportAudioEditProject(request: AudioEditExportRequest): Promise<AudioEditExportResult> {
  const project = requireAudioEditProject(request.projectId)
  const spans = buildAudioEditTimeline(project.source.durationFrames, project.transcript)
  if (spans.length === 0) throw new Error('EXPORT_EMPTY：当前编辑计划没有可导出的声音。')
  const ffmpeg = await loadFfmpegPath()
  const exportRunId = randomUUID()
  const filterPath = path.join(path.dirname(project.source.audioPath), `export-filter-${exportRunId}.txt`)
  const rawOutputPath = project.vstEnabled
    ? path.join(path.dirname(project.source.audioPath), `export-vst-input-${exportRunId}.wav`)
    : request.audioTargetPath
  const temporaryPaths = project.vstEnabled ? [filterPath, rawOutputPath] : [filterPath]
  const chains = spans.map((span, index) => {
    const duration = (span.sourceEndFrame - span.sourceStartFrame) / project.source.sampleRate
    const fade = Math.min(0.01, duration / 4)
    return `[0:a]atrim=start_sample=${span.sourceStartFrame}:end_sample=${span.sourceEndFrame},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fade},afade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}[a${index}]`
  })
  chains.push(`${spans.map((_span, index) => `[a${index}]`).join('')}concat=n=${spans.length}:v=0:a=1[out]`)
  await fs.writeFile(filterPath, chains.join(';\n'), 'utf8')
  logger.info('口播成片导出开始', {
    event: 'audio_edit.export.start', context: { projectId: project.id, spanCount: spans.length },
  })
  try {
    await fs.mkdir(path.dirname(request.audioTargetPath), { recursive: true })
    await run(ffmpeg, [
      '-y', '-i', project.source.audioPath,
      '-filter_complex_script', filterPath,
      '-map', '[out]', rawOutputPath,
    ])
    if (project.vstEnabled) {
      const processed = await processAudioEditVstChain(rawOutputPath, path.dirname(project.source.audioPath))
      temporaryPaths.push(...processed.temporaryPaths)
      await fs.copyFile(processed.outputPath, request.audioTargetPath)
    }
    if (request.subtitleTargetPath) {
      const srt = buildAudioEditSrt(project.transcript, spans, project.source.sampleRate)
      await fs.writeFile(request.subtitleTargetPath, srt, 'utf8')
    }
    logger.info('口播成片导出完成', {
      event: 'audio_edit.export.completed',
      context: { projectId: project.id, outputDurationFrames: editedDurationFrames(spans) },
    })
    return {
      audioPath: request.audioTargetPath,
      ...(request.subtitleTargetPath ? { subtitlePath: request.subtitleTargetPath } : {}),
      durationFrames: editedDurationFrames(spans),
    }
  } catch (error) {
    logger.error('口播成片导出失败', {
      event: 'audio_edit.export.failed', context: { projectId: project.id }, error,
    })
    throw error
  } finally {
    await Promise.all(temporaryPaths.map((temporaryPath) => fs.rm(temporaryPath, { force: true }).catch(() => undefined)))
  }
}
