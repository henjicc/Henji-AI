import type { AudioEditTimelineSpan } from './types'

/** 拼接两侧各约 5 ms，按整数采样帧计算；不重叠片段、不改变时间线。 */
export const AUDIO_EDIT_SPLICE_FADE_SECONDS = 0.005
export const AUDIO_EDIT_SPLICE_FADE_CURVE = 'tri'

export interface AudioEditSpliceFade {
  lengthFrames: number
  fadeInFrames: number
  fadeOutFrames: number
}

/** 只有源时间不连续或静音状态切换才淡变，整个文件的首尾不处理。 */
export function buildAudioEditSpliceFades(spans: readonly AudioEditTimelineSpan[], sampleRate: number): AudioEditSpliceFade[] {
  const isSplice = (left: AudioEditTimelineSpan, right: AudioEditTimelineSpan): boolean =>
    left.sourceEndFrame !== right.sourceStartFrame || Boolean(left.muted) !== Boolean(right.muted)
  const requestedFrames = Math.round(sampleRate * AUDIO_EDIT_SPLICE_FADE_SECONDS)
  return spans.map((span, index) => {
    const lengthFrames = span.sourceEndFrame - span.sourceStartFrame
    // 单帧片段无法容纳两侧淡变；禁用零长度 afade，避免非法参数。
    const frames = Math.max(0, Math.min(requestedFrames, Math.floor(lengthFrames / 2)))
    return {
      lengthFrames,
      fadeInFrames: index > 0 && isSplice(spans[index - 1], span) ? frames : 0,
      fadeOutFrames: index + 1 < spans.length && isSplice(span, spans[index + 1]) ? frames : 0,
    }
  })
}

/** 对齐 FFmpeg afade 的 tri：淡出末样本保留 1/N，零点位于片段右开边界。 */
export function audioEditSpliceGain(frame: number, fade: AudioEditSpliceFade): number {
  const fadeIn = fade.fadeInFrames ? Math.max(0, Math.min(1, frame / fade.fadeInFrames)) : 1
  const fadeOut = fade.fadeOutFrames ? Math.max(0, Math.min(1, (fade.lengthFrames - frame) / fade.fadeOutFrames)) : 1
  return fadeIn * fadeOut
}

/** 返回处理后的交错 PCM 副本；offset 是相对完整片段的位置，分块或跳播不会重启淡变。 */
export function applyAudioEditSpliceFade(pcm: Float32Array, channels: number, offset: number, fade: AudioEditSpliceFade): Float32Array {
  const output = pcm.slice()
  const frames = output.length / channels
  const apply = (start: number, end: number): void => {
    for (let frame = Math.max(0, start); frame < Math.min(frames, end); frame++) {
      const gain = audioEditSpliceGain(offset + frame, fade)
      for (let channel = 0; channel < channels; channel++) output[frame * channels + channel] *= gain
    }
  }
  // 只遍历淡变范围，长片段的中间部分直接复制，不做逐样本乘法。
  if (fade.fadeInFrames) apply(0, fade.fadeInFrames - offset)
  if (fade.fadeOutFrames) apply(fade.lengthFrames - fade.fadeOutFrames - offset, frames)
  return output
}
