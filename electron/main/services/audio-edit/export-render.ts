import type { AudioEditTimelineSpan } from '../../../../src/core/audioEdit/types'
import { ffmpegFilterComplexFileArgs } from '../video/ffmpeg-loader'

/** 按样本裁出每个保留片段后顺序拼接；静音片段保留时长、音量置零。 */
export function buildAudioEditConcatFilter(spans: readonly AudioEditTimelineSpan[], inputStream: string): string {
  const chains = spans.map((span, index) => `[${inputStream}]atrim=start_sample=${span.sourceStartFrame}:end_sample=${span.sourceEndFrame},asetpts=PTS-STARTPTS${span.muted ? ',volume=0' : ''}[a${index}]`)
  chains.push(`${spans.map((_span, index) => `[a${index}]`).join('')}concat=n=${spans.length}:v=0:a=1[out]`)
  return chains.join(';\n')
}

/** 口播剪辑音频导出的 FFmpeg 参数；滤镜图从文件读取（片段多时远超命令行长度上限）。 */
export async function buildAudioEditRenderArgs(ffmpeg: string, input: string, filterScriptPath: string, output: string): Promise<string[]> {
  return ['-v', 'error', '-y', '-i', input, ...await ffmpegFilterComplexFileArgs(ffmpeg, filterScriptPath), '-map', '[out]', '-c:a', 'pcm_s24le', output]
}
