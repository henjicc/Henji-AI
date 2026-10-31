import { layerEffectBleed } from './layerEffectGeometry'
import { VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX } from '../theme/colorTokens'
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { videoEditStrengthParam as strength, videoEditPercentParam as percent } from './effectParams'

export const BASIC_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [
  { stage: 'point', space: 'layer', author: { factory: 'blackWhite' }, bleed: (p, r) => layerEffectBleed('black_white', p, r), id: 'black_white', name: '黑白', group: 'color', aliases: ['去色', '灰度', 'grayscale', 'black and white'], description: '按人眼对明暗的感受把画面变成黑白，适合回忆、纪实感。只想降低鲜艳度时把效果强度调到 30%–70%，或用调色里的饱和度。', params: [] },
  { stage: 'point', id: 'invert', name: '反相', group: 'color', tooltip: '把颜色变成互补色（底片效果）', description: '反转颜色成互补色（底片效果），用于闪回、惊悚、故障风；保留透明度。部分反相可降低效果强度。', params: [] },
  { stage: 'point', id: 'crop', name: '裁剪', group: 'frame', tooltip: '从四边裁掉画面，裁掉的部分透出下层', description: '按画面百分比从四边裁掉，裁掉部分变透明（可透出下层轨道）。做宽银幕黑边时把上下各裁 12% 左右。',
    params: [
      percent('left', '左侧', 0, '从左边裁掉的比例', '从左边裁掉的画面宽度百分比。'),
      percent('top', '顶部', 0, '从顶部裁掉的比例', '从上边裁掉的画面高度百分比；宽银幕效果约 12。'),
      percent('right', '右侧', 0, '从右边裁掉的比例', '从右边裁掉的画面宽度百分比。'),
      percent('bottom', '底部', 0, '从底部裁掉的比例', '从下边裁掉的画面高度百分比；宽银幕效果约 12。'),
      strength('feather', '羽化边缘', 0, '裁剪边缘的柔和程度', '0 硬边；100 边缘有约为画面高度 5% 的渐隐。'),
    ] },
  { id: 'flip', name: '翻转', group: 'frame', tooltip: '水平或垂直镜像画面', description: '镜像翻转画面：修正前置摄像头的左右镜像、调转人物朝向或做对称构图。',
    params: [{ key: 'axis', name: '翻转方向', type: 'enum', default: 'horizontal', options: [{ value: 'horizontal', label: '水平翻转' }, { value: 'vertical', label: '垂直翻转' }, { value: 'both', label: '水平和垂直' }], tooltip: '水平翻转左右互换，垂直翻转上下颠倒', description: 'horizontal 左右镜像；vertical 上下颠倒；both 两者都做（等于旋转 180°）。' }] },
  { stage: 'point', id: 'chroma_key', name: '色度抠像', group: 'keying', tooltip: '去掉绿幕或蓝幕背景', description: '把接近“抠像颜色”的区域变透明（绿幕、蓝幕），并压掉主体边缘的反溢色。',
    params: [
      { key: 'key_color', name: '抠像颜色', type: 'color', default: VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX, tooltip: '要去掉的背景颜色', description: '要变透明的背景色，写 #rrggbb；默认纯绿。最好取画面里背景的实际颜色（绿幕通常是偏暗的绿，蓝幕是偏暗的蓝）。' },
      strength('tolerance', '容差', 30, '多接近抠像颜色的区域会被去掉', '数值越大去掉的颜色范围越宽：20 只去纯净背景，30 默认，60 背景光照不均时使用（可能吃掉主体）。'),
      strength('softness', '边缘柔化', 10, '透明边缘的过渡宽度', '0 硬边；10 默认；50 很柔的半透明边缘（适合头发）。'),
      strength('spill', '溢色抑制', 50, '去掉主体边缘反射的背景色', '0 不处理；50 默认；100 强力去除主体上的绿色/蓝色反光。'),
    ] },
]
