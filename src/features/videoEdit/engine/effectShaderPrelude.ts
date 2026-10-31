import { BASIC_EFFECT_ENTRIES, BASIC_EFFECT_WGSL } from './basicEffectShaders'
import { COLOR_MATH_WGSL, EFFECT_SHADER_MATH_WGSL } from './effectShaderMath'
import type { EffectShaderBlock } from './effectPlanner'

/**
 * 剪辑内置效果 ABI：输入与输出均为预乘 sRGB；全屏三角形入口 vs。
 * group 0：binding 0 source，1 filtering sampler，2 uniform，3 original，4 三维 LUT，5 调色蒙版。
 * uniform 前 16 个 float：size=(目标宽高,源宽高)，a/b/c 各四项。
 * layer=(内容原点,内容宽高)、grid=(效果专用取样网格或过渡标志) 扩展到 24 项，未使用的扩展填零。
 * 过渡的 source 是前段、original 是后段；c 是各过渡专用参数，含方向、背景或闪光颜色。
 * 效果只声明自己的 WGSL，共享函数通过 shared 引用以下具名块，不内嵌其文本。
 */
export const COLOR_MATH_BLOCK: EffectShaderBlock = { name: 'color-math', wgsl: COLOR_MATH_WGSL }
export const EFFECT_MATH_BLOCK: EffectShaderBlock = { name: 'effect-math', wgsl: EFFECT_SHADER_MATH_WGSL }
export const BASIC_EFFECT_BLOCK: EffectShaderBlock = { name: 'builtin-abi', wgsl: BASIC_EFFECT_WGSL }
export const EFFECT_SHADER_PRELUDE = [COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK, BASIC_EFFECT_BLOCK] as const
export const EFFECT_SHARED_ENTRIES = BASIC_EFFECT_ENTRIES
export const EFFECT_UNFILTERED_SHARED_ENTRIES = ['gaussian_copy', 'gaussian_linear', 'gaussian_encoded', 'gaussian_blur', 'gaussian_resample'] as const

/** 块名是模块身份，同名只装配一次；内容冲突立即报错，避免整段文本去重的隐式约定。 */
export function assembleEffectShader(blocks: readonly EffectShaderBlock[]): string {
  const unique = new Map<string, string>()
  for (const block of blocks) {
    if (unique.has(block.name) && unique.get(block.name) !== block.wgsl) throw new Error(`共享着色器块 ${block.name} 内容冲突。`)
    unique.set(block.name, block.wgsl)
  }
  return [...unique.values()].join('\n')
}
