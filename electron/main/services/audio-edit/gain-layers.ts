import { applyAudioEditGainRegions, type AudioEditGainRegion } from '../../../../src/core/audioEdit/regions'

/*
 * 增益层：末尾连续的呼吸处理与区间音量，读声音时按处理顺序逐层逐区域乘上，不为它们单独渲染整条声音。
 * 每层的区域已按起点稳定排序；读任意一段时只取与这段相交的区域、保持原顺序，
 * 所以每一帧经历的乘法与单精度舍入，与从头整段乘一遍完全相同（试听、导出、按块重算都用这一个函数）。
 */

export type AudioEditGainLayers = readonly (readonly AudioEditGainRegion[])[]

export function applyAudioEditGainLayers(pcm: Float32Array, startFrame: number, channels: number, layers: AudioEditGainLayers): void {
  if (!layers.length) return
  const end = startFrame + Math.floor(pcm.length / channels)
  for (const layer of layers) {
    const overlapping = layer.filter(region => region.startFrame < end && region.endFrame > startFrame)
    if (overlapping.length) applyAudioEditGainRegions(pcm, startFrame, channels, overlapping)
  }
}
