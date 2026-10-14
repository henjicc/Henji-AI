import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { RECORDING_ZOOM_EFFECT } from './recordingZoom'

export const RECORDING_ZOOM_DEFINITION: VideoEditBuiltinEffectDefinition = {
  id: RECORDING_ZOOM_EFFECT, name: '自动缩放', group: 'frame',
  tooltip: '在缩放区间内放大屏幕画面，可跟随鼠标或对准固定位置',
  description: '录屏片段的缩放区间（效果的 regions 属性）：区间内放大并保持，区间前平滑放大、区间后平滑缩小，画面在片段自身范围内放大，输出尺寸不变。'
    + '每个区间 {id,startUs,endUs,depth,focus,origin}：startUs/endUs 是片段素材的源时间微秒（修剪、拆分、移动、变速、倒放后自动跟着内容走）；'
    + 'depth 缩放档位 1–6 = 1.25/1.5/1.8/2.2/3.5/5 倍，默认 3（1.8 倍），讲解操作常用 3–4，看清小字用 5；'
    + 'focus 为 "cursor" 时镜头跟随鼠标（重度平滑，鼠标靠近视野边缘才平移），为 {x,y}（相对源画面 0–1）时对准固定位置；origin 为 auto（自动生成）或 manual（用户调整）。'
    + '区间不能重叠、数量不限。只能加到绑定操作日志的屏幕视频片段；放在录制光标之后，重绘的光标会一起放大。',
  params: [
    { key: 'connect', name: '衔接相邻缩放', type: 'boolean', default: true, tooltip: '相邻缩放直接平移过去，不先缩小再放大', description: 'true 时间隔不超过1.5秒的相邻区间直接平移衔接；false 每个区间都先缩小回原画面再放大（紧挨着的区间总是平移）。' },
    { key: 'transition', name: '过渡速度', type: 'enum', default: 'smooth', options: [{ value: 'smooth', label: '平缓' }, { value: 'quick', label: '快速' }], tooltip: '放大和缩小的过渡快慢', description: 'smooth 放大约1.2秒、缩小约0.9秒，适合讲解；quick 放大约0.5秒、缩小约0.4秒，节奏紧凑。过渡在区间之外进行：区间开始时已放大到位。' },
  ],
}
