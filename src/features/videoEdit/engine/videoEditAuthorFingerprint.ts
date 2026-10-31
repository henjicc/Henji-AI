import { CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { assertCodeElementOverrideAllowed } from '@/core/videoEdit/codeElementOverrides'
import { resolveAuthorEffects, authorEffectsFingerprint, type AuthorEffectEnvironment } from '@/core/videoEdit/authorEffects'
import { renderFingerprintHash, type VideoEditFrameFingerprint } from '@/core/videoEdit/renderFingerprint'
import { authorFrameExposure, authorLayerSamples } from './videoEditAuthorLayers'
import { codeMaterialFilesKey, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { AUTHOR_WHOLE_EFFECT_ID, authorLayerId, type AuthorElementOverrides } from './videoEditAuthorElements'
import { AuthorCanvasAsset, AuthorCanvasUnrecordable, recordAuthorCanvas } from './videoEditAuthorCanvasRecorder'
import type { AuthorAssets, AuthorFrameInfo, AuthorLayer, AuthorModule, AuthorParameters } from './videoEditAuthorModule'
import { isAuthorAdjustment } from './videoEditAuthorModule'

function adjustmentFingerprint(layer: AuthorLayer, index: number, info: AuthorFrameInfo, environment: AuthorEffectEnvironment, overrides?: AuthorElementOverrides): unknown[] {
  const id = authorLayerId(layer, index), override = overrides?.[id]
  assertCodeElementOverrideAllowed('adjust', override)
  const effects = resolveAuthorEffects(layer.adjust!(info.time), environment, info.clip.time / info.frameDuration, id, 'frame')
  const pose = layer.pose ? layer.pose(info.time) : {}
  return ['adjust', id, layer.clip, pose ? pose.opacity ?? 1 : 0, override?.opacity, override?.hidden,
    authorEffectsFingerprint(effects, environment, Math.round(info.time / info.frameDuration))]
}

export interface AuthorFingerprintInput { width: number; height: number; identity: string; dimensionsKnown?: boolean }

function fingerprintAsset(key: string, input: AuthorFingerprintInput): AuthorCanvasAsset {
  const asset = new AuthorCanvasAsset(key, input.width, input.height)
  // 解码尺寸只能由实际画面提供；代理、旋转及缩小解码的尺寸不能从素材登记值推断。
  if (input.dimensionsKnown === false) for (const property of ['width', 'height']) Object.defineProperty(asset, property, {
    get: () => { throw new AuthorCanvasUnrecordable('decoded-asset-size-required') },
  })
  return asset
}

/** 使用版本的完整原始文件表，不能用打包结果：打包结果已把片子数据内联进了绘制代码。 */
export function authorFrameCodeIdentity(files: CodeMaterialFiles, effect: AuthorModule, pinned: string): string {
  const excluded = new Set(typeof effect.frameKey === 'function' ? effect.dataFiles?.filter(path => path !== files.entry) ?? [] : [])
  return renderFingerprintHash(JSON.stringify([codeMaterialFilesKey({ ...files, files: Object.fromEntries(Object.entries(files.files).filter(([path]) => !excluded.has(path))) }), pinned]))
}

/** JSON.stringify 会悄悄丢掉函数、undefined，或把非有限数写成 null，作者键不能接受这种碰撞。 */
function frameKeyJson(value: unknown, active = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (typeof value !== 'object' || !value || active.has(value)) throw new Error('frameKey 返回值不是有限、无循环的 JSON 数据')
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error('frameKey 返回值需要 JSON 对象或数组')
  active.add(value)
  try {
    if (Object.getOwnPropertySymbols(value).length) throw new Error('frameKey 返回值不能包含 symbol')
    if (Array.isArray(value)) return `[${Array.from(value, item => frameKeyJson(item, active)).join(',')}]`
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${frameKeyJson(record[key], active)}`).join(',')}}`
  } finally { active.delete(value) }
}

/** 作者声明路径不运行任何绘制入口，也不需要文字测量画布。 */
export function fingerprintAuthorFrameKey(effect: AuthorModule, size: { width: number; height: number }, params: AuthorParameters,
  info: AuthorFrameInfo, inputs: Readonly<Record<string, AuthorFingerprintInput>>, codeIdentity: string,
  pictureParameters: unknown, overrides?: AuthorElementOverrides, motionBlur = true, environment: AuthorEffectEnvironment = {}, apiVersion = 6): VideoEditFrameFingerprint {
  try {
    const frameInfo = Object.defineProperties({} as AuthorFrameInfo, Object.getOwnPropertyDescriptors(info))
    frameInfo.exposure = authorFrameExposure(effect, info, motionBlur)
    const key = frameKeyJson(effect.frameKey!(params, size.width, size.height, frameInfo))
    const effects = apiVersion >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION && effect.layers ? fingerprintLayerEffects(effect, size, params, info, inputs, environment, overrides, motionBlur, apiVersion) : undefined
    return { method: 'frameKey', digest: renderFingerprintHash(JSON.stringify([codeIdentity, size.width, size.height, key,
      Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)), pictureParameters, overrides, motionBlur, ...(apiVersion >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION ? [effects] : [])])) }
  } catch (error) { return { fallback: `frame-key-error:${error instanceof Error ? error.message : String(error)}` } }
}

/** 只运行作者函数和文字测量；不创建纹理、不解码、不重放绘制指令。 */
export function fingerprintAuthorFrame(effect: AuthorModule, size: { width: number; height: number }, params: AuthorParameters,
  info: AuthorFrameInfo, inputs: Readonly<Record<string, AuthorFingerprintInput>>, measure: OffscreenCanvasRenderingContext2D,
  overrides?: AuthorElementOverrides, motionBlur = true, environment: AuthorEffectEnvironment = {}, apiVersion = 6): VideoEditFrameFingerprint {
  try {
    if (effect.createWebGL || effect.createWebGPU) return { fallback: 'native-gpu' }
    let recording = false
    const used = new Set<string>(), assets: Record<string, CanvasImageSource> = {}
    for (const [key, input] of Object.entries(inputs)) {
      const asset = fingerprintAsset(key, input)
      Object.defineProperty(assets, key, { enumerable: true, get: () => {
        // layers/pose 拿到真实位图时可以读像素或按对象类型分支，不能用替身证明相同。
        if (!recording) throw new AuthorCanvasUnrecordable('asset-outside-recording')
        used.add(key)
        return asset
      } })
    }
    const list: AuthorLayer[] = effect.layers ? effect.layers(params, size.width, size.height, assets as AuthorAssets, info)
      : [{ id: AUTHOR_WHOLE_EFFECT_ID, draw: (ctx, time) => effect.draw!(ctx, time, params, size.width, size.height, assets, info) }]
    if (!Array.isArray(list)) throw new Error('layers() 必须返回图层数组')
    const layers: unknown[] = []
    for (const [index, layer] of list.entries()) {
      if (isAuthorAdjustment(layer, apiVersion)) { layers.push(adjustmentFingerprint(layer, index, info, environment, overrides)); continue }
      const id = authorLayerId(layer, index), override = overrides?.[id]
      const [x, y, right, bottom] = layer.bounds ?? [0, 0, size.width, size.height]
      if (layer.pose && !layer.bounds || ![x, y, right, bottom].every(Number.isFinite) || right <= x || bottom <= y) throw new Error('图层范围无效')
      const samples = authorLayerSamples(layer, effect, info, { x, y, width: right - x, height: bottom - y }, override, motionBlur)
      // 元数据（源码行号、名称、作者缓存提示）不参与画面；未知字段保守计入，函数等无法散列则回退。
      const { draw: _draw, pose: _pose, sourceSpan: _span, factory: _factory, name: _name, data: _data, cacheKey: _cache, effects: _effects, ...properties } = layer
      const poses = samples.map(sample => [sample, layer.pose?.(info.time + sample.offset.numerator / sample.offset.denominator * info.frameDuration) ?? null])
      const center = layer.pose?.(info.time) ?? null
      if (layer.pose && !samples.some(sample => sample.pose)) { layers.push([id, !!layer.pose, properties, poses, center]); continue }
      recording = true
      let commands
      try {
        commands = recordAuthorCanvas(size, measure, [1, 0, 0, 1, 0, 0], ctx => {
          ctx.save()
          if (!layer.pose && layer.clip) { const [x0, y0, x1, y1] = layer.clip; ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip() }
          layer.draw!(ctx, info.time)
          ctx.restore()
        }, true)
      } finally { recording = false }
      if (!commands.comparable || !commands.balanced) return { fallback: 'unrecordable-layer' }
      const effects = apiVersion >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION && layer.effects ? authorEffectsFingerprint(resolveAuthorEffects(layer.effects(info.time), environment, info.clip.time / info.frameDuration, id, 'layer', apiVersion), environment) : undefined
      layers.push([id, !!layer.pose, properties, poses, center, commands.ops, ...(apiVersion >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION ? [effects] : [])])
    }
    const value = [{ width: size.width, height: size.height }, layers, [...used].sort().map(key => [key, inputs[key]])]
    const json = JSON.stringify(value, (_key, value: unknown) => {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || typeof value === 'number' && !Number.isFinite(value)) throw new AuthorCanvasUnrecordable('unstable-value')
      return value
    })
    return { digest: renderFingerprintHash(json), method: 'recording' }
  } catch (error) {
    return { fallback: error instanceof AuthorCanvasUnrecordable ? `unrecordable:${error.message}` : `author-error:${error instanceof Error ? error.message : String(error)}` }
  }
}

function fingerprintLayerEffects(effect: AuthorModule, size: { width: number; height: number }, params: AuthorParameters, info: AuthorFrameInfo,
  inputs: Readonly<Record<string, AuthorFingerprintInput>>, environment: AuthorEffectEnvironment, overrides: AuthorElementOverrides | undefined, motionBlur: boolean, apiVersion: number): unknown[] {
  const assets: Record<string, CanvasImageSource> = {}
  const unavailable = (): never => { throw new AuthorCanvasUnrecordable('asset-outside-recording') }
  // 声明键已承担绘制内容的身份；效果与位姿仍须求值，可读取确定的素材尺寸，但不能把元数据当作像素。
  for (const [key, input] of Object.entries(inputs)) {
    const asset = new Proxy(fingerprintAsset(key, input), {
      get: (_target, property) => {
        if (property === 'width' || property === 'height') {
          if (input.dimensionsKnown === false) throw new AuthorCanvasUnrecordable('decoded-asset-size-required')
          return input[property]
        }
        return unavailable()
      },
      getPrototypeOf: unavailable, setPrototypeOf: unavailable, set: unavailable,
      has: unavailable, ownKeys: unavailable, getOwnPropertyDescriptor: unavailable,
      defineProperty: unavailable, deleteProperty: unavailable, isExtensible: unavailable, preventExtensions: unavailable,
    })
    Object.defineProperty(assets, key, { enumerable: true, get: () => asset })
  }
  const layers = effect.layers!(params, size.width, size.height, assets, info)
  if (!Array.isArray(layers)) throw new Error('layers() 必须返回图层数组')
  return layers.map((layer, index) => {
    if (isAuthorAdjustment(layer, apiVersion)) return adjustmentFingerprint(layer, index, info, environment, overrides)
    const [x, y, right, bottom] = layer.bounds ?? [0, 0, size.width, size.height]
    const samples = authorLayerSamples(layer, effect, info, { x, y, width: right - x, height: bottom - y }, overrides?.[authorLayerId(layer, index)], motionBlur)
    if (!samples.some(sample => sample.pose)) return null
    const center = layer.pose?.(info.time) ?? samples.map(sample => layer.pose?.(info.time + sample.offset.numerator / sample.offset.denominator * info.frameDuration)).find(Boolean)
    const effects = layer.effects ? resolveAuthorEffects(layer.effects(info.time), environment, info.clip.time / info.frameDuration, authorLayerId(layer, index), 'layer', apiVersion) : []
    return [authorEffectsFingerprint(effects, environment), center?.blur ?? 0, center?.scaleX ?? center?.scale ?? 1, center?.scaleY ?? center?.scale ?? 1, layer.blurShape]
  })
}
