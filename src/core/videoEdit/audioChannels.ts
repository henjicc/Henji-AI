import { z } from 'zod'

/**
 * Audio channels of edit media, project items and clips (task 2.6), after Premiere Pro:
 *
 * - A media file lists its sound streams (`media.audioStreams`, in file order; the n-th entry is sound stream n, the
 *   number both decoders open). Media imported before 2.6 has no list and keeps playing its first stream.
 * - "Use File" (no `item.audioChannels`): every mono stream becomes one mono clip, every other stream one stereo clip
 *   taking its first two channels (front left/right).
 * - "Modify > Audio Channels" on a project item stores a layout: one entry per audio clip it places, each a clip
 *   channel format (mono or stereo) and, for every clip channel, the source channel it reads. A changed layout only
 *   affects clips placed afterwards; clips already in sequences keep their own `clip.audioMapping`.
 * - A mono clip plays centred in a stereo sequence (the same signal in both channels); a stereo clip in a mono
 *   sequence is the average of its two channels.
 */

/** Layout count is dynamic; retain only the JS safe-integer bound used by NumberInput and index arithmetic. */
export const VIDEO_EDIT_MAX_AUDIO_CLIPS = Number.MAX_SAFE_INTEGER
export const videoEditAudioStreamSchema = z.object({ channels: z.number().int().min(1).max(64), sampleRate: z.number().int().min(1).max(768_000).optional() }).strict()
export type VideoEditAudioStream = z.infer<typeof videoEditAudioStreamSchema>
export const videoEditAudioStreamsSchema = z.array(videoEditAudioStreamSchema).min(1)
export const videoEditAudioSourceSchema = z.object({ stream: z.number().int().nonnegative(), channel: z.number().int().min(0).max(63) }).strict()
export type VideoEditAudioSource = z.infer<typeof videoEditAudioSourceSchema>
export type VideoEditAudioFormat = 'mono' | 'stereo'
export const videoEditAudioMappingSchema = z.object({ format: z.enum(['mono', 'stereo']), sources: z.array(videoEditAudioSourceSchema).min(1).max(2) }).strict()
  .refine(mapping => mapping.sources.length === videoEditAudioWidth(mapping.format), '单声道片段读取 1 个源声道，立体声片段读取 2 个源声道。')
export type VideoEditAudioMapping = z.infer<typeof videoEditAudioMappingSchema>
export const videoEditAudioLayoutSchema = z.array(videoEditAudioMappingSchema).min(1)
  .refine(layout => layout.every(mapping => mapping.format === layout[0].format), '同一素材放入的音频片段使用同一种声道格式。')
export type VideoEditAudioLayout = z.infer<typeof videoEditAudioLayoutSchema>
export type VideoEditAudioPreset = 'file' | 'mono' | 'stereo'

export function videoEditAudioWidth(format: VideoEditAudioFormat): 1 | 2 { return format === 'mono' ? 1 : 2 }
/** Every source channel of the file, stream by stream (Premiere's "Media Source Channels"). */
export function videoEditSourceChannels(streams: readonly VideoEditAudioStream[]): VideoEditAudioSource[] {
  return streams.flatMap((stream, index) => Array.from({ length: stream.channels }, (_, channel) => ({ stream: index, channel })))
}
/** "Use File": one mono clip per mono stream, one stereo clip (front left/right) per other stream. */
export function videoEditFileAudioLayout(streams: readonly VideoEditAudioStream[]): VideoEditAudioMapping[] {
  return streams.slice(0, VIDEO_EDIT_MAX_AUDIO_CLIPS).map((stream, index) => stream.channels === 1
    ? { format: 'mono', sources: [{ stream: index, channel: 0 }] }
    : { format: 'stereo', sources: [{ stream: index, channel: 0 }, { stream: index, channel: 1 }] })
}
/**
 * A layout of `count` clips in `format` reading the file's source channels in order (Premiere fills its matrix the
 * same way when the format or the number of clips changes). Clips past the last source channel (an odd last stereo
 * clip's right channel, more clips than channels) read the last source channel.
 */
export function videoEditSequentialAudioLayout(streams: readonly VideoEditAudioStream[], format: VideoEditAudioFormat, count: number): VideoEditAudioMapping[] {
  const sources = videoEditSourceChannels(streams)
  if (!sources.length) throw new Error('此素材没有可映射的源声道。')
  const width = videoEditAudioWidth(format)
  const clips = Math.max(1, Math.min(VIDEO_EDIT_MAX_AUDIO_CLIPS, Math.floor(count)))
  return Array.from({ length: clips }, (_, clip) => ({ format, sources: Array.from({ length: width }, (_, channel) => ({ ...sources[Math.min(clip * width + channel, sources.length - 1)] })) }))
}
/** Premiere's presets: Use File, Mono (one clip per source channel) and Stereo (consecutive channel pairs). */
export function videoEditAudioPresetLayout(streams: readonly VideoEditAudioStream[], preset: VideoEditAudioPreset): VideoEditAudioMapping[] {
  if (preset === 'file') return videoEditFileAudioLayout(streams)
  const channels = videoEditSourceChannels(streams).length
  return videoEditSequentialAudioLayout(streams, preset, preset === 'mono' ? channels : Math.ceil(channels / 2))
}
export function videoEditAudioMappingsEqual(left: VideoEditAudioMapping | undefined, right: VideoEditAudioMapping | undefined): boolean {
  return left === right || Boolean(left && right && left.format === right.format && left.sources.length === right.sources.length && left.sources.every((source, index) => source.stream === right.sources[index].stream && source.channel === right.sources[index].channel))
}
/**
 * The mapping a clip without `audioMapping` already plays: the first stream with its own channels (a clip of media
 * imported before task 2.6, or a clip whose layout entry is exactly that). Such clips keep no mapping.
 */
export function videoEditIsDefaultAudioMapping(mapping: VideoEditAudioMapping, streams: readonly VideoEditAudioStream[] | undefined): boolean {
  return Boolean(streams?.length) && videoEditAudioMappingsEqual(mapping, videoEditFileAudioLayout(streams!.slice(0, 1))[0])
}
/** The layout a project item places: its own (Modify > Audio Channels) or the file's; undefined for media without a stream list. */
export function videoEditItemAudioLayout(item: { audioChannels?: VideoEditAudioMapping[] }, media: { audioStreams?: VideoEditAudioStream[] } | undefined): VideoEditAudioMapping[] | undefined {
  return item.audioChannels ?? (media?.audioStreams?.length ? videoEditFileAudioLayout(media.audioStreams) : undefined)
}
export function videoEditAudioPresetOf(layout: VideoEditAudioMapping[] | undefined, streams: readonly VideoEditAudioStream[]): VideoEditAudioPreset | 'custom' {
  if (!layout) return 'file'
  const equal = (other: VideoEditAudioMapping[]): boolean => other.length === layout.length && other.every((mapping, index) => videoEditAudioMappingsEqual(mapping, layout[index]))
  return (['file', 'mono', 'stereo'] as const).find(preset => equal(videoEditAudioPresetLayout(streams, preset))) ?? 'custom'
}
/** User-facing name of a source channel, such as "声音流 2 · 左" (a single stream drops the stream part). */
export function videoEditAudioSourceLabel(source: VideoEditAudioSource, streams: readonly VideoEditAudioStream[] | undefined): string {
  const channels = streams?.[source.stream]?.channels
  const channel = channels === 1 ? '单声道' : channels === 2 ? source.channel === 0 ? '左' : '右' : `声道 ${source.channel + 1}`
  return streams && streams.length > 1 ? `声音流 ${source.stream + 1} · ${channel}` : channel
}
export function videoEditAudioFormatLabel(format: VideoEditAudioFormat): string { return format === 'mono' ? '单声道' : '立体声' }
/** Why a mapping does not fit the file's streams, or undefined. Media without a stream list accepts any mapping. */
export function videoEditAudioMappingIssue(mapping: VideoEditAudioMapping, streams: readonly VideoEditAudioStream[] | undefined): string | undefined {
  if (!streams) return undefined
  const missing = mapping.sources.find(source => source.stream >= streams.length || source.channel >= streams[source.stream].channels)
  return missing ? `源素材没有声音流 ${missing.stream + 1} 的第 ${missing.channel + 1} 个声道。` : undefined
}

/** One sound stream a clip reads, with the gain of each of its channels in each sequence channel (`gains[output][input]`). */
export interface VideoEditAudioRead { stream: number; gains: number[][] }
/**
 * How a mapped clip feeds a sequence of `outputs` channels: stereo clip channels go left and right, a mono clip goes to
 * both (centred), and a mono sequence takes the average of the clip's channels. Reads are grouped by stream so each
 * stream is decoded once per clip.
 */
export function videoEditAudioMixReads(mapping: VideoEditAudioMapping, outputs: number): VideoEditAudioRead[] {
  const reads = new Map<number, VideoEditAudioRead>()
  mapping.sources.forEach((source, clipChannel) => {
    let read = reads.get(source.stream)
    if (!read) { read = { stream: source.stream, gains: Array.from({ length: outputs }, () => []) }; reads.set(source.stream, read) }
    for (let output = 0; output < outputs; output++) {
      const gain = outputs === 1 ? 1 / mapping.sources.length : mapping.sources.length === 1 || output === clipChannel ? 1 : 0
      const row = read.gains[output]
      while (row.length <= source.channel) row.push(0)
      row[source.channel] += gain
    }
  })
  return [...reads.values()]
}
/** The channel gains of a clip without mapping (its file's first stream): a mono sequence averages all channels, otherwise channel c reads min(c, n - 1). */
export function videoEditDefaultAudioGains(inputs: number, outputs: number): number[][] {
  return Array.from({ length: outputs }, (_, output) => Array.from({ length: inputs }, (_, input) => outputs === 1 ? 1 / inputs : input === Math.min(output, inputs - 1) ? 1 : 0))
}
/** The channel type a clip plays (its mapping, else its file's first stream); undefined for silent clips or unknown files. */
export function videoEditClipAudioFormat(clip: { kind: string; sourceComponent?: 'video' | 'audio'; audioMapping?: VideoEditAudioMapping }, media: { kind: string; hasAudio?: boolean; audioStreams?: VideoEditAudioStream[] } | undefined): VideoEditAudioFormat | undefined {
  if (!media || !(clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video' && media.hasAudio === true)) return undefined
  if (clip.audioMapping) return clip.audioMapping.format
  const first = media.audioStreams?.[0]
  return first ? first.channels === 1 ? 'mono' : 'stereo' : undefined
}
