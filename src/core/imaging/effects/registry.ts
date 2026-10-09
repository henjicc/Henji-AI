import { GAUSSIAN_EFFECT } from './gaussian'
import type { EffectDescriptor } from './descriptor'

/** 语义登记包含未迁移的独立模型；未声明 executor 的项不能假称跨宿主可执行。 */
export const DISTINCT_BLUR_MODELS = [
  { id: 'fast-blur', name: '快速模糊', colorDomain: 'linear-light', alpha: 'premultiplied', temporal: 'none', hosts: ['image'], backend: { kind: 'wgsl', module: 'image-host/fastBlur' }, implementation: 'three-box', status: 'host-owned' },
  { id: 'scatter-blur', name: '散射模糊', colorDomain: 'linear-light', alpha: 'premultiplied', temporal: 'none', hosts: ['video'], backend: { kind: 'wgsl', module: 'video-host/scatterPyramid' }, implementation: 'scatter-pyramid', status: 'host-owned' },
  { id: 'shaders.Blur', name: '模糊（着色器）', colorDomain: 'backend-defined', alpha: 'backend-defined', temporal: 'none', hosts: ['video'], backend: { kind: 'shaders-component', module: 'shaders/core/Blur' }, implementation: 'upstream-component', status: 'host-owned' },
] as const
export type RegisteredImagingEffect = Omit<EffectDescriptor<unknown, unknown>, 'resolve'>
const descriptors = new Map<string, RegisteredImagingEffect>([[GAUSSIAN_EFFECT.id, GAUSSIAN_EFFECT]])
export function listImagingEffects(): readonly RegisteredImagingEffect[] { return [...descriptors.values()] }
/** 登记返回作用域释放函数，测试/可选效果卸载不会留下可创建操作。 */
export function registerImagingEffect<Parameters, Plan>(descriptor: EffectDescriptor<Parameters, Plan>): () => void {
  if (descriptors.has(descriptor.id)) throw new Error(`共享效果重复登记：${descriptor.id}`)
  descriptors.set(descriptor.id, descriptor as RegisteredImagingEffect)
  return () => { descriptors.delete(descriptor.id) }
}

export function requireImagingEffect(id: string): RegisteredImagingEffect {
  const descriptor = descriptors.get(id)
  if (!descriptor) throw new Error(`没有共享效果“${id}”；可用：${[...descriptors.keys()].join('、')}`)
  return descriptor
}
