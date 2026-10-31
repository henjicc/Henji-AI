/**
 * 胶片模拟：封装 `shaders` 的 FilmStock 组件（实测胶片调色表、高光红橙光晕），着色器不重写。
 * 参数按一份说明改写，数值 0–100 按组件属性的范围线性换算；只上片段，出口是着色器图的 8 位。
 * 组件的片门晃动按每份合成各自累加的时钟走，换胶片、光晕跨过 0 或几段片段共用会话时相位跟渲染历史有关，
 * 预览与导出会对不上，所以固定为 0、不开放。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import type { ShaderGraphWrappedEffect } from './shaderGraph/effects'
import { requireShaderComponent, shaderPropValue } from './shaderGraph/spec'
import { effectParam } from './effectIncludes'

const COMPONENT = 'FilmStock'
const component = requireShaderComponent(COMPONENT, '胶片模拟')

/** 组件的选项值不变，名称按胶片的观感译成中文。 */
const STOCKS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'portrait400', label: '人像 400' },
  { value: 'vivid100', label: '鲜艳 100' },
  { value: 'chrome64', label: '复古反转 64' },
  { value: 'slide100', label: '反转片 100' },
  { value: 'velvet50', label: '浓郁 50' },
  { value: 'everyday400', label: '日常 400' },
  { value: 'pastel400', label: '淡彩 400' },
  { value: 'warm200', label: '暖调 200' },
  { value: 'instant', label: '拍立得' },
  { value: 'mono400', label: '黑白 400' },
]

const { amount, choice } = effectParam
const DESCRIPTION = '套用十种经典胶片的颜色，带高光周围的红橙色光晕。适合给实拍素材调出胶片味；在 8 位里计算，暗部大面积渐变上可能出现色带。'

export const FILM_LOOK_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  id: 'film_look', name: '胶片模拟', group: 'color', description: DESCRIPTION,
  aliases: ['胶片', '胶片调色', '胶片色彩', 'film look', 'film stock', 'film emulation'],
  params: [
    choice('stock', 'portrait400', [...STOCKS], { name: '胶片', text: '套用哪一卷胶片的颜色。人像 400（默认）肤色柔和、反差低；鲜艳 100、浓郁 50 色彩饱满；暖调 200 偏黄偏暖；黑白 400 是反差柔和的黑白。' }),
    amount('strength', 100, { name: '强度', text: '胶片颜色套用多少。100（默认）完全是这卷胶片的颜色；50 原色和胶片色各一半；0 不改颜色。只管颜色，光晕不受它影响。' }),
    amount('halation', 30, { group: '光晕', name: '光晕', text: '高光周围泛出的红橙色光有多强。0 没有光晕；30（默认）灯光和亮边旁一圈淡淡的暖光；70 以上像老胶片那样明显泛红。' }),
    amount('halation_radius', 40, { group: '光晕', name: '光晕半径', text: '光晕散开多远。10 紧贴亮处；40（默认）约为画面长边的 4%；100 柔柔地铺开一大片。光晕为 0 时不起作用。' }),
  ],
}

const scale = (key: string, value: number): number => shaderPropValue(component, key, value / 100)

export const FILM_LOOK_SHADER_GRAPH: ShaderGraphWrappedEffect = {
  id: FILM_LOOK_EFFECT_DEFINITION.id, component: COMPONENT,
  props: (values: Readonly<VideoEditBuiltinParams>) => ({
    stock: values.stock,
    strength: scale('strength', Number(values.strength)),
    halation: scale('halation', Number(values.halation)),
    halationRadius: scale('halationRadius', Number(values.halation_radius)),
    weave: 0,
  }),
}
