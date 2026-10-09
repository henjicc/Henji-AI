import { GAUSSIAN_EFFECT } from './gaussian'

/** 语义登记包含未迁移的独立模型；未声明 executor 的项不能假称跨宿主可执行。 */
export const DISTINCT_BLUR_MODELS = [
  { id: 'fast-blur', name: '快速模糊', colorDomain: 'linear-light', alpha: 'premultiplied', temporal: 'none', hosts: ['image'], backend: { kind: 'wgsl', module: 'image-host/fastBlur' }, implementation: 'three-box', status: 'host-owned' },
  { id: 'scatter-blur', name: '散射模糊', colorDomain: 'linear-light', alpha: 'premultiplied', temporal: 'none', hosts: ['video'], backend: { kind: 'wgsl', module: 'video-host/scatterPyramid' }, implementation: 'scatter-pyramid', status: 'host-owned' },
  { id: 'shaders.Blur', name: '模糊（着色器）', colorDomain: 'backend-defined', alpha: 'backend-defined', temporal: 'none', hosts: ['video'], backend: { kind: 'shaders-component', module: 'shaders/core/Blur' }, implementation: 'upstream-component', status: 'host-owned' },
] as const
export const IMAGING_EFFECT_DESCRIPTORS = [GAUSSIAN_EFFECT] as const

export function requireImagingEffect(id: string): typeof GAUSSIAN_EFFECT {
  const descriptor = IMAGING_EFFECT_DESCRIPTORS.find(effect => effect.id === id)
  if (!descriptor) throw new Error(`没有共享效果“${id}”；可用：${IMAGING_EFFECT_DESCRIPTORS.map(effect => effect.id).join('、')}`)
  return descriptor
}
