/**
 * 暗角：画面四周按椭圆渐变混向所选颜色（黑色是普通暗角，白色是四周提亮）。
 * 平滑渐变在暗底上容易出一圈圈色带，着色器在暗角改动过的像素上加半级亮度的抖动（按叠到底色后的画面算，不随透明度缩小）。
 */
import type { VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { BLACK_HEX } from '../theme/colorTokens'

const DESCRIPTION = '让画面四周变暗或换成别的颜色，把视线引向中心，增加电影感。颜色选白色就是四周提亮的白边。'

export const VIGNETTE_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  stage: 'point',
  precision: params => Number(params.amount) !== 0,
  id: 'vignette', name: '暗角', group: 'lens', description: DESCRIPTION,
  aliases: ['晕影', '暗边', 'vignette'],
  params: [
    effectParam.amount('amount', 30, { name: '数量', text: '四周变化多少。0 没有暗角；30（默认）柔和的电影暗角；70 浓重；100 四周完全变成所选颜色。' }),
    effectParam.percent('midpoint', 50, 0, { name: '大小', text: '中间不受影响的区域有多大。50%（默认）；调小暗角往里收，100% 只压最角落。' }),
    effectParam.percent('feather', 50, 0, { name: '羽化', text: '暗角边缘过渡得多柔和。0% 边缘很硬，像一个圈；50%（默认）柔和；100% 从中心起就慢慢过渡。' }),
    effectParam.color('color', BLACK_HEX, { name: '颜色', text: '四周变成什么颜色。黑色（默认）是普通暗角；白色是四周提亮，适合梦境、回忆。' }),
  ],
}
