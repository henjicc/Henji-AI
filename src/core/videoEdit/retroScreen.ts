/**
 * 老式画面：把 `shaders` 框架的录像带（VHS）与显像管（CRTScreen）合成“一个名字 + 方式”，着色器不重写。
 * 只上片段；框架的出口是 8 位，暗部大面积渐变上可能有色带。显像管自带的暗角、亮度、对比度固定为中性（另有暗角与调色效果）；
 * 它最后一步把画面填成不透明，宿主按原画透明度裁回，透明底片段不会多出黑底。
 * “强度”让效果按比例变弱，0 时与原画相同：录像带的晃动、扫描噪声、拖影乘强度；显像管的荧光条纹没有强弱属性，
 * 整个滤镜按强度与原画混合。像素大小、扫描线密度、速度是尺寸与节奏，不随强度变。数值按组件属性的范围换算。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import type { ShaderGraphWrappedEffect } from './shaderGraph/effects'
import { requireShaderComponent, shaderPropRange, shaderPropValue } from './shaderGraph/spec'
import { effectParam } from './effectIncludes'

const VHS = requireShaderComponent('VHS', '老式画面'), CRT = requireShaderComponent('CRTScreen', '老式画面')
const [SPEED_MIN, SPEED_MAX] = shaderPropRange(VHS, 'speed')

const DESCRIPTION = '把画面变成录像带或显像管电视的样子。适合回忆、复古和“屏幕里的画面”；只能加在片段上。在 8 位里计算，暗部大面积渐变上可能出现色带。'
const { amount, signed, choice } = effectParam
const ON_VHS = { visibleWhen: { param: 'mode', equals: 'vhs' } }
const ON_CRT = { visibleWhen: { param: 'mode', equals: 'crt' } }
const n = (params: Readonly<VideoEditBuiltinParams>, key: string, fallback: number): number => typeof params[key] === 'number' ? params[key] as number : fallback

export const RETRO_SCREEN_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'clip', id: 'retro_screen', name: '老式画面', group: 'texture', description: DESCRIPTION,
  aliases: ['录像带', '老电视', '显像管', '复古屏幕', 'VHS', 'CRT', 'retro'],
  params: [
    choice('mode', 'vhs', [{ value: 'vhs', label: '录像带' }, { value: 'crt', label: '显像管' }], { name: '方式', text: '录像带（默认）像翻录的 VHS：画面一阵阵晃动、横向噪声和颜色拖影；显像管像老电视屏幕：红绿蓝荧光条纹和扫描线。' }),
    amount('amount', 60, { name: '强度', text: '整体有多明显，按比例减弱下面各项。0 与原画相同；60（默认）一眼能认出的老画面；100 各项用足设定值。' }),
    { ...amount('wobble', 20, { group: '录像带', name: '晃动', text: '磁带损伤有多少：一阵阵的波纹、折痕和画面底部的换头噪声。20（默认）偶尔晃一下；60 以上频繁晃动。' }), ...ON_VHS },
    { ...amount('scanline_noise', 60, { group: '录像带', name: '扫描噪声', text: '每条扫描线上细碎的横向抖动和杂色。60（默认）；100 横纹明显；0 没有。' }), ...ON_VHS },
    { ...signed('smear', 10, { group: '录像带', name: '拖影', text: '颜色往一边拖出的残影。10（默认）轻轻往右拖；往负调往左拖；100 拖得很长。' }), ...ON_VHS },
    { key: 'speed', type: 'number', unit: 'multiplier', min: SPEED_MIN, max: SPEED_MAX, step: 0.1, default: 1, animatable: false, group: '录像带', name: '速度', description: '晃动和噪声变化得多快。1 倍（默认）；0.5 倍慢慢地晃；2 倍以上像快进。', ...ON_VHS },
    { ...amount('pixel_size', 0, { group: '显像管', name: '像素大小', text: '红绿蓝荧光条纹有多粗。0（默认）最细，一行约 64 组；100 很粗，一行约 4 组。' }), ...ON_CRT },
    { ...amount('scanline_intensity', 30, { group: '显像管', name: '扫描线强度', text: '横向扫描线有多深。30（默认）淡淡的横纹；100 黑白相间很明显；0 没有扫描线。' }), ...ON_CRT },
    { ...amount('scanline_density', 33, { group: '显像管', name: '扫描线密度', text: '画面上下有多少条扫描线。33（默认）约 200 条；0 约 100 条，粗；100 约 800 条，细。' }), ...ON_CRT },
    { ...amount('color_shift', 10, { group: '显像管', name: '色偏', text: '红、蓝向两边错开多少，像没调好的老电视。10（默认）轻微；100 明显的彩边。' }), ...ON_CRT },
  ],
}

export const RETRO_SCREEN_SHADER_GRAPH: ShaderGraphWrappedEffect = {
  id: RETRO_SCREEN_EFFECT_DEFINITION.id,
  component: values => values.mode === 'crt' ? CRT.name : VHS.name,
  keepsSourceAlpha: values => values.mode === 'crt',
  props: values => {
    const strength = n(values, 'amount', 60) / 100
    if (values.mode === 'crt') return {
      pixelSize: shaderPropValue(CRT, 'pixelSize', n(values, 'pixel_size', 0) / 100, 'log_reverse'), scanlineFrequency: shaderPropValue(CRT, 'scanlineFrequency', n(values, 'scanline_density', 33) / 100, 'log'),
      scanlineIntensity: shaderPropValue(CRT, 'scanlineIntensity', n(values, 'scanline_intensity', 30) / 100), colorShift: shaderPropValue(CRT, 'colorShift', n(values, 'color_shift', 10) / 100),
      brightness: 1, contrast: 1, vignetteIntensity: 0, opacity: strength,
    }
    return {
      wobble: shaderPropValue(VHS, 'wobble', n(values, 'wobble', 20) / 100) * strength, scanlineNoise: shaderPropValue(VHS, 'scanlineNoise', n(values, 'scanline_noise', 60) / 100) * strength,
      smear: n(values, 'smear', 10) / 100 * shaderPropRange(VHS, 'smear')[1] * strength, speed: n(values, 'speed', 1),
    }
  },
}
