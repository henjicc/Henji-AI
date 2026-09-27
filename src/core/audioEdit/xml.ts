import { buildProjectAudioEditTimeline, splitAudioEditMutedSpans } from './timeline'
import type { AudioEditFrameRate, AudioEditProjectDocument, AudioEditTimelineSpan } from './types'

export interface AudioEditXmlClip {
  muted?: boolean
  sourceIn: number
  sourceOut: number
  start: number
  end: number
}
export interface AudioEditXmlTimeline {
  rate: AudioEditFrameRate
  clips: AudioEditXmlClip[]
  spans: AudioEditTimelineSpan[]
  duration: number
  timebase: number
  ntsc: boolean
}

const SUPPORTED_RATES: AudioEditFrameRate[] = [
  { numerator: 24, denominator: 1 }, { numerator: 25, denominator: 1 }, { numerator: 30, denominator: 1 },
  { numerator: 50, denominator: 1 }, { numerator: 60, denominator: 1 },
  { numerator: 24000, denominator: 1001 }, { numerator: 30000, denominator: 1001 }, { numerator: 60000, denominator: 1001 },
]

export function compileAudioEditXmlTimeline(project: AudioEditProjectDocument, requestedRate?: AudioEditFrameRate): AudioEditXmlTimeline {
  const video = project.source.video
  if (project.source.mediaType === 'video' && !video) throw new Error('请重新定位原视频，读取视频时间信息后再导出 XML。')
  if (video?.variableFrameRate) throw new Error('该视频的帧率或时间戳不稳定，无法准确导出联动画面的 XML；仍可导出 WAV。')
  const selectedRate = video?.frameRate ?? requestedRate ?? project.xmlFrameRate ?? { numerator: 25, denominator: 1 }
  const rate = SUPPORTED_RATES.find((item) => item.numerator * selectedRate.denominator === selectedRate.numerator * item.denominator)
  if (!rate) {
    throw new Error('XML 暂不支持该帧率，请选择 24、25、30、50、60 或对应的 NTSC 帧率。')
  }
  const fps = rate.numerator / rate.denominator
  const sampleRate = project.source.sampleRate
  const offset = video ? (project.source.audioStartSeconds ?? 0) - video.startSeconds : 0
  const ranges: Array<{ start: number; end: number }> = []
  for (const span of buildProjectAudioEditTimeline(project)) {
    const start = Math.max(0, Math.floor((span.sourceStartFrame / sampleRate + offset) * fps + 1e-7))
    const end = Math.ceil((span.sourceEndFrame / sampleRate + offset) * fps - 1e-7)
    if (video && (span.sourceStartFrame / sampleRate + offset < -1e-7 || end > Math.ceil(video.durationSeconds * fps))) {
      throw new Error('保留的音频超出视频画面范围，请调整选区后导出 XML。')
    }
    if (end <= start) continue
    const previous = ranges.at(-1)
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
    else ranges.push({ start, end })
  }
  const muted = buildProjectAudioEditTimeline(project).filter((span) => span.muted).map((span) => ({
    startFrame: Math.ceil((span.sourceStartFrame / sampleRate + offset) * fps - 1e-7),
    endFrame: Math.floor((span.sourceEndFrame / sampleRate + offset) * fps + 1e-7),
  })).filter((range) => range.endFrame > range.startFrame)
  const aligned = splitAudioEditMutedSpans(ranges.map((range) => ({ sourceStartFrame: range.start, sourceEndFrame: range.end, outputStartFrame: 0, outputEndFrame: range.end - range.start })), muted)
  let cursor = 0
  const clips = aligned.map((range) => {
    const clip = { sourceIn: range.sourceStartFrame, sourceOut: range.sourceEndFrame, start: cursor, end: cursor + range.sourceEndFrame - range.sourceStartFrame, ...(range.muted ? { muted: true } : {}) }
    cursor = clip.end
    return clip
  })
  const spans = clips.map((clip) => ({
    ...(clip.muted ? { muted: true } : {}),
    sourceStartFrame: Math.round((clip.sourceIn / fps - offset) * sampleRate),
    sourceEndFrame: Math.round((clip.sourceOut / fps - offset) * sampleRate),
    outputStartFrame: Math.round(clip.start / fps * sampleRate),
    outputEndFrame: Math.round(clip.end / fps * sampleRate),
  }))
  return { rate, clips, spans, duration: cursor, timebase: Math.round(fps), ntsc: rate.denominator !== 1 }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!)
}

/** File URLs are resolved by the host, never from preview/cache URLs. */
export function buildAudioEditXml(project: AudioEditProjectDocument, timeline: AudioEditXmlTimeline, sourceUrl: string, processedAudioUrl?: string): string {
  if (!sourceUrl.startsWith('file:///') || (processedAudioUrl && !processedAudioUrl.startsWith('file:///'))) throw new Error('XML 需要本地文件地址。')
  if (!timeline.clips.length) throw new Error('当前没有可导出的片段。')
  const video = project.source.video
  const name = escapeXml(project.name)
  const rate = `<rate><timebase>${timeline.timebase}</timebase><ntsc>${timeline.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`
  const fps = timeline.rate.numerator / timeline.rate.denominator
  const channels = project.source.channels
  const offsetFrames = video ? ((project.source.audioStartSeconds ?? 0) - video.startSeconds) * fps : 0
  if (processedAudioUrl && Math.abs(offsetFrames - Math.round(offsetFrames)) > 1e-5) throw new Error('该素材的音画偏移不在视频帧网格上；请导出原声 XML，再在剪辑软件中处理声音。')
  const sourceDuration = Math.ceil((video?.durationSeconds ?? project.source.durationFrames / project.source.sampleRate) * fps)
  const audioCharacteristics = `<samplecharacteristics><depth>16</depth><samplerate>${project.source.sampleRate}</samplerate></samplecharacteristics><channelcount>${channels}</channelcount>`
  const videoCharacteristics = video ? `<samplecharacteristics>${rate}<width>${video.width}</width><height>${video.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics>` : ''
  const emittedFiles = new Set<string>()
  const file = (processed: boolean): string => {
    const key = processed ? 'processed-audio' : 'source-media'
    if (emittedFiles.has(key)) return `<file id="${key}"/>`
    emittedFiles.add(key)
    return `<file id="${processed ? 'processed-audio' : 'source-media'}"><name>${name}${processed ? '-RX.wav' : ''}</name><pathurl>${escapeXml(processed ? processedAudioUrl! : sourceUrl)}</pathurl>${rate}<duration>${processed ? Math.ceil(project.source.durationFrames / project.source.sampleRate * fps) : sourceDuration}</duration><media>${!processed && video ? `<video>${videoCharacteristics}</video>` : ''}<audio>${audioCharacteristics}</audio></media></file>`
  }
  const id = (index: number, track: number): string => `clip-${index}-${track}`
  const links = (index: number): string => Array.from({ length: channels + (video ? 1 : 0) }, (_, channel) => {
    const isVideo = Boolean(video) && channel === 0
    const track = isVideo ? 0 : channel + (video ? 0 : 1)
    return `<link><linkclipref>${id(index, track)}</linkclipref><mediatype>${isVideo ? 'video' : 'audio'}</mediatype><trackindex>${isVideo ? 1 : track}</trackindex><clipindex>${index + 1}</clipindex>${isVideo ? '' : '<groupindex>1</groupindex>'}</link>`
  }).join('')
  const clips = (track: number): string => timeline.clips.map((clip, index) => {
    const processed = track > 0 && Boolean(processedAudioUrl)
    const shift = processed && video ? Math.round(((project.source.audioStartSeconds ?? 0) - video.startSeconds) * fps) : 0
    return `<clipitem id="${id(index, track)}"><name>${name}</name><enabled>${track > 0 && clip.muted ? 'FALSE' : 'TRUE'}</enabled><duration>${sourceDuration}</duration>${rate}<start>${clip.start}</start><end>${clip.end}</end><in>${clip.sourceIn - shift}</in><out>${clip.sourceOut - shift}</out>${file(processed)}<sourcetrack><mediatype>${track === 0 ? 'video' : 'audio'}</mediatype><trackindex>${track || 1}</trackindex></sourcetrack>${links(index)}</clipitem>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="henji-audio-edit"><name>${name}</name><duration>${timeline.duration}</duration>${rate}<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode><media>${video ? `<video><format>${videoCharacteristics}</format><track>${clips(0)}</track></video>` : ''}<audio><format>${audioCharacteristics}</format>${Array.from({ length: channels }, (_, channel) => `<track>${clips(channel + 1)}</track>`).join('')}</audio></media></sequence></xmeml>\n`
}
