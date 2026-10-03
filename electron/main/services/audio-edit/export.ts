import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '../../../../src/core/audioEdit/timeline'
import { buildAudioEditSrt } from '../../../../src/core/audioEdit/subtitles'
import { buildAudioEditXml, compileAudioEditXmlTimeline } from '../../../../src/core/audioEdit/xml'
import type { AudioEditExportRequest, AudioEditExportResult } from '../../../../src/core/audioEdit/types'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { requireAudioEditProject } from './project-store'
import { prepareAudioEditProcessedAudio } from './processors'
import { verifyAudioEditSource, validateAudioEditAudio } from './media'
import { runAudioEditProcess } from './process'
import { buildAudioEditConcatFilter, buildAudioEditRenderArgs } from './export-render'
import { runAudioEditTask } from './task-store'

interface StagedOutput { temporary: string; target: string; backup?: string; published?: boolean }
async function publishOutputs(outputs: StagedOutput[]): Promise<void> {
  try {
    for (const output of outputs) {
      if (await fs.stat(output.target).then(() => true, () => false)) {
        output.backup = `${output.target}.${randomUUID()}.backup`
        await fs.rename(output.target, output.backup)
      }
      await fs.rename(output.temporary, output.target)
      output.published = true
    }
  } catch (error) {
    for (const output of [...outputs].reverse()) {
      if (output.published) await fs.rm(output.target, { force: true })
      if (output.backup) await fs.rename(output.backup, output.target)
    }
    throw error
  }
  await Promise.all(outputs.map((output) => output.backup ? fs.rm(output.backup, { force: true }) : Promise.resolve()))
}

export async function exportAudioEditProject(request: AudioEditExportRequest): Promise<AudioEditExportResult> {
  const project = requireAudioEditProject(request.projectId)
  await verifyAudioEditSource(project)
  const format = request.format ?? 'wav'
  const target = path.resolve(request.targetPath ?? request.audioTargetPath ?? '')
  if (!request.targetPath && !request.audioTargetPath) throw new Error('请选择导出位置。')
  const subtitleTarget = request.subtitleTargetPath ? path.resolve(request.subtitleTargetPath) : undefined
  const forbidden = new Set([project.source.sourcePath, project.source.audioPath].map((file) => path.resolve(file).toLowerCase()))
  for (const file of [target, subtitleTarget].filter((file): file is string => Boolean(file))) {
    if (forbidden.has(file.toLowerCase())) throw new Error('导出不能覆盖原素材。')
    const existing = await fs.stat(file).catch(() => null)
    const source = await fs.stat(project.source.sourcePath)
    if (existing && existing.dev === source.dev && existing.ino === source.ino) throw new Error('导出不能覆盖原素材的链接。')
  }
  if (subtitleTarget?.toLowerCase() === target.toLowerCase()) throw new Error('字幕和媒体必须使用不同文件名。')
  const timeline = format === 'xml' ? compileAudioEditXmlTimeline(project, request.frameRate) : undefined
  const spans = timeline?.spans ?? buildProjectAudioEditTimeline(project)
  if (!spans.length) throw new Error('当前没有可导出的声音。')
  return runAudioEditTask(project.id, 'export', async (signal, progress) => {
    const outputs: StagedOutput[] = []
    const temporaryPaths: string[] = []
    const stage = async (file: string): Promise<string> => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temporary = path.join(path.dirname(file), `.${randomUUID()}${path.extname(file)}`)
      outputs.push({ target: file, temporary })
      temporaryPaths.push(temporary)
      return temporary
    }
    try {
      const processing = request.includeProcessing ?? (format === 'wav' && project.vstEnabled)
      let processedPath: string | undefined
      if (processing) processedPath = await prepareAudioEditProcessedAudio(project, signal, (value) => progress(value * 0.8))
      let exportedAudioPath = ''
      if (format === 'xml' && processedPath) {
        exportedAudioPath = path.join(path.dirname(target), `${path.basename(target, path.extname(target))}-RX-${randomUUID().slice(0, 8)}.wav`)
        await fs.copyFile(processedPath, await stage(exportedAudioPath))
      }
      if (subtitleTarget) await fs.writeFile(await stage(subtitleTarget), buildAudioEditSrt(project.transcript, spans, project.source.sampleRate), 'utf8')
      // The XML is published last, after every referenced derivative is durable.
      const temporary = await stage(target)
      if (format === 'xml' && timeline) {
        await fs.writeFile(temporary, buildAudioEditXml(project, timeline, pathToFileURL(project.source.sourcePath).href, exportedAudioPath ? pathToFileURL(exportedAudioPath).href : undefined), 'utf8')
      } else {
        const filter = `${temporary}.filter`
        temporaryPaths.push(filter)
        const inputStream = processedPath || project.source.ownership !== 'external' ? '0:a:0' : `0:${project.source.audioStreamIndex ?? 0}`
        await fs.writeFile(filter, buildAudioEditConcatFilter(spans, inputStream), 'utf8')
        const ffmpeg = await loadFfmpegPath()
        await runAudioEditProcess(ffmpeg, await buildAudioEditRenderArgs(ffmpeg, processedPath ?? project.source.audioPath, filter, temporary), signal)
        await validateAudioEditAudio(temporary, project.source.sampleRate, project.source.channels, editedDurationFrames(spans), signal)
        exportedAudioPath = target
      }
      signal.throwIfAborted()
      await verifyAudioEditSource(project)
      for (const output of outputs) if (!(await fs.stat(output.temporary)).size && output.target !== subtitleTarget) throw new Error('生成的交付文件为空，未提交导出。')
      await publishOutputs(outputs)
      progress(1)
      return { audioPath: exportedAudioPath, ...(timeline ? { xmlPath: target } : {}), ...(subtitleTarget ? { subtitlePath: subtitleTarget } : {}), durationFrames: editedDurationFrames(spans) }
    } finally { await Promise.all(temporaryPaths.map((file) => fs.rm(file, { force: true }))) }
  }, request.requestId, JSON.stringify([project.revision, project.source.identity, request]))
}
