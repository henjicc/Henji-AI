import type { AudioEditTimelineSpan } from '../../../../src/core/audioEdit/types'
import { AUDIO_EDIT_SPLICE_FADE_CURVE, buildAudioEditSpliceFades } from '../../../../src/core/audioEdit/spliceDeclick'
import { ffmpegFilterComplexFileArgs } from '../video/ffmpeg-loader'

/** 按样本裁出每个保留片段后顺序拼接；静音片段保留时长、采样写成 0（浮点渲染下 volume=0 会把负采样变成 -0.0，不是真零）。 */
export function buildAudioEditConcatFilter(spans: readonly AudioEditTimelineSpan[], inputStream: string, sampleRate: number): string {
  const fades = buildAudioEditSpliceFades(spans, sampleRate)
  const chains = spans.map((span, index) => {
    const fade = fades[index]
    const filters = [`[${inputStream}]atrim=start_sample=${span.sourceStartFrame}:end_sample=${span.sourceEndFrame}`, 'asetpts=PTS-STARTPTS']
    if (fade.fadeInFrames) filters.push(`afade=t=in:ss=0:ns=${fade.fadeInFrames}:curve=${AUDIO_EDIT_SPLICE_FADE_CURVE}`)
    if (fade.fadeOutFrames) filters.push(`afade=t=out:ss=${fade.lengthFrames - fade.fadeOutFrames}:ns=${fade.fadeOutFrames}:curve=${AUDIO_EDIT_SPLICE_FADE_CURVE}`)
    if (span.muted) filters.push('aeval=0:c=same')
    return `${filters.join(',')}[a${index}]`
  })
  chains.push(`${spans.map((_span, index) => `[a${index}]`).join('')}concat=n=${spans.length}:v=0:a=1[out]`)
  return chains.join(';\n')
}

/** 口播剪辑音频导出的 FFmpeg 参数；滤镜图从文件读取（片段多时远超命令行长度上限）。 */
export async function buildAudioEditRenderArgs(ffmpeg: string, input: string, filterScriptPath: string, output: string): Promise<string[]> {
  return ['-v', 'error', '-y', '-i', input, ...await ffmpegFilterComplexFileArgs(ffmpeg, filterScriptPath), '-map', '[out]', '-c:a', 'pcm_s24le', output]
}
