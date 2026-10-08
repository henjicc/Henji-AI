/**
 * 辉光PRO：复用图片编辑的辉光配方（线性光亮通提取、多尺度散射、高光肩部），保留透明度。
 * 实现在剪辑内置效果着色器（`features/videoEdit/engine/glowPro.ts`），预览与导出同一路径。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam } from './builtinEffects'

const amount = (key: string, name: string, value: number, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: value, tooltip, description, animatable: true })
export const GLOW_PRO_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  id: 'glow_pro', name: '辉光PRO', group: 'stylize', tooltip: '高光向外散射成柔和光晕，亮部核心可偏白，像真实镜头的光晕',
  description: '与图片编辑“辉光PRO”同一配方：只让足够亮的部分发光，多尺度散射出自然光晕，高光肩部柔和压缩避免死白。适合霓虹、灯光、金属高光、梦幻氛围。strength 0 完全恢复原画。',
  params: [
    amount('strength', '强度', 40, '光晕整体强度，0 不发光', '0 完全恢复原画；40（默认）自然光晕；100 很强的辉光。'),
    amount('range', '光晕范围', 50, '光晕扩散多远', '0 紧贴光源，100 广阔光晕；按画面长边比例分配散射层。'),
    amount('threshold', '高光门槛', 50, '多亮的部分才发光', '越大只有更亮的光源发光；与图片编辑同一 EV 亮通配方。'),
    amount('exposure', '光晕亮度', 58, '光晕本身的亮度', '光晕亮度；58 对应图片编辑默认。'),
    amount('rolloff', '高光过渡', 62, '高光压缩得多柔和', '数值越大高光压缩越柔和，减少硬裁切死白。'),
    amount('core_white', '光核白热', 55, '彩色光源核心偏白的程度', '数值越大彩色光源核心越偏白，模拟过曝。'),
  ],
}
