/**
 * 颗粒：逐帧变化的平滑值噪声，中间调最明显、暗部与高光收敛。种子只与帧号有关，同一帧预览与导出一致。
 * 颗粒大小按画面高度换算；回放降分辨率时颗粒小于像素，强度按覆盖的颗粒数收小（见剪辑内置效果工序）。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { effectParam } from './effectIncludes'

const DESCRIPTION = '给画面叠上逐帧变化的颗粒，像胶片或高感光度拍出的质感。中间调最明显，暗部和高光收敛。'

export const FILM_GRAIN_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'frame', frameSeed: (_params, frame) => frame, author: { factory: 'grain' },
  stage: 'point',
  id: 'film_grain', name: '颗粒', group: 'texture', description: DESCRIPTION,
  aliases: ['胶片颗粒', '噪点', '杂色', 'film grain', 'grain', 'noise'],
  params: [
    effectParam.amount('amount', 30, { name: '强度', text: '颗粒有多明显。0 没有颗粒；15 隐约的质感；30（默认）明显的胶片感；60 以上很粗糙。' }),
    effectParam.amount('size', 30, { name: '大小', text: '颗粒的粗细。0 最细，约一个像素；30（默认）；100 粗颗粒，约为画面高度的 0.4%。' }),
    effectParam.toggle('monochrome', true, { name: '单色', text: '颗粒只改变明暗、不带颜色（默认打开），像黑白胶片；关闭后每种颜色各自起伏，像彩色胶片或高感光度的数码噪点。' }),
  ],
}
