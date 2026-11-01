import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { videoEditFadeOpacity } from '@/core/videoEdit/fades'
import { createLogger } from '@/core/logging'
import { spatialClipMatrix } from '@/core/videoEdit/spatialEvaluation'
import { spatialInverse, spatialMultiply, spatialScale, spatialTranslation } from '@/core/videoEdit/spatialMatrices'
import type { SpatialCardGeometry, SpatialFrame } from '@/core/videoEdit/spatialTypes'
import type { PreparedSpatialFrame, SpatialAccumulator, SpatialCodeSources, SpatialCompositeHost, SpatialDrawItem, SpatialExposurePlan, SpatialExposurePicture, SpatialFrameRequest, SpatialGroupPlan, SpatialMaterialPlan, SpatialPictureLease, SpatialSample, SpatialTargetSpec } from './videoEditSpatialContracts'
import { planSpatialExposure, type SpatialCompositionAt } from './videoEditSpatialExposurePlan'
import { VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES } from './videoEditGpuBudget'
export { planSpatialExposure } from './videoEditSpatialExposurePlan'
const logger = createLogger('features.videoEdit.effects')
/** 每条序列上次报告的升档受限情况；推近播放时只在受限的材料或档位变化时再报。 */
const reportedRasterLimits = new Map<string, string>()
function reportRasterLimits(request: SpatialFrameRequest, plan: SpatialExposurePlan): void {
  const key = JSON.stringify(plan.rasterLimits ?? [])
  if (reportedRasterLimits.get(request.composition.id) === key) return
  reportedRasterLimits.set(request.composition.id, key)
  if (!plan.rasterLimits?.length) return
  logger.info('空间推近栅格受工作集预算限制', { event: 'video_edit.spatial.raster.limited', context: { sequenceId: request.composition.id, requestId: request.requestId, frame: request.sequenceFrame,
    materials: plan.rasterLimits, workingSetBytes: plan.workingSetBytes, budgetBytes: VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES } })
}

/** 调度器独占曝光时钟和借用寿命；作者端只接收一次准备及流式样本请求。 */
export async function renderSpatialExposure(request: SpatialFrameRequest, initial: SpatialExposurePlan, sources: SpatialCodeSources, host: SpatialCompositeHost, compositionAt?: SpatialCompositionAt): Promise<SpatialExposurePicture> {
  const started = performance.now()
  const context = { sequenceId: request.composition.id, requestId: request.requestId, frame: request.sequenceFrame, samples: initial.samples.length, groups: initial.groups.length, workingSetBytes: initial.workingSetBytes }
  logger.debug('空间曝光开始', { event: 'video_edit.spatial.exposure.started', context })
  const leases = new Map<SpatialPictureLease, Promise<void>[]>()
  const accumulators = new Set<SpatialAccumulator>()
  let prepared: PreparedSpatialFrame | undefined
  let reserved = false
  let failure: unknown
  let failed = false
  let output: SpatialPictureLease | undefined
  let delivered = false
  const retired: Array<Promise<PromiseSettledResult<void>>> = []
  const current = (): void => { request.signal.throwIfAborted(); request.assertCurrent() }
  const own = (picture: SpatialPictureLease): SpatialPictureLease => { leases.set(picture, []); return picture }
  const use = (picture: SpatialPictureLease, completion: Promise<void>): void => { leases.get(picture)!.push(completion) }
  const release = async (picture: SpatialPictureLease): Promise<void> => {
    const pending = leases.get(picture)
    if (!pending) return
    leases.delete(picture)
    const releasing = picture.release(Promise.all(pending).then(() => undefined))
    retired.push(releasing.then(value => ({ status: 'fulfilled', value } as const), reason => ({ status: 'rejected', reason } as const)))
  }
  const target = (key: string, plan: SpatialExposurePlan): SpatialTargetSpec => ({ key, width: request.output.width, height: request.output.height,
    format: plan.materials.some(material => material.highPrecision || material.carriesLight) ? 'rgba16float' : 'rgba8unorm', usage: 1 | 2 | 4 | 16 })
  const begin = async (spec: SpatialTargetSpec): Promise<SpatialAccumulator> => {
    current(); const accumulator = await host.beginAccumulation(spec); accumulators.add(accumulator); return accumulator
  }
  const closeAccumulator = async (accumulator: SpatialAccumulator): Promise<void> => {
    await host.releaseAccumulation(accumulator)
    accumulators.delete(accumulator)
  }
  const transfer = async (picture: SpatialPictureLease, spec: SpatialTargetSpec): Promise<SpatialPictureLease> => {
    own(picture)
    const copied = own(await host.consumePicture(picture, spec))
    use(picture, copied.completion); await release(picture)
    return copied
  }
  const defocus = async (picture: SpatialPictureLease, material: SpatialMaterialPlan, geometry: SpatialCardGeometry): Promise<SpatialPictureLease> => {
    if (material.defocus.bypass) return picture
    const support = material.kind === 'worldScene' ? {
      x: geometry.screenBounds.x * request.output.width, y: geometry.screenBounds.y * request.output.height,
      width: geometry.screenBounds.width * request.output.width, height: geometry.screenBounds.height * request.output.height,
    } : material.supportBoundsPx
    const filtered = own(await host.applyCenterDefocus(picture, material, support))
    use(picture, filtered.completion); await release(picture)
    return filtered
  }
  try {
    current()
    if (request.sources.length) prepared = await sources.prepareSpatialFrame({ frame: request, plan: initial })
    current()
    const scenes = prepared ? await sources.inspectSpatialSceneSamples(prepared) : undefined
    current()
    const plan = planSpatialExposure(request, scenes, compositionAt)
    reportRasterLimits(request, plan)
    if (plan.samples.length !== initial.samples.length || plan.samples.some((sample, index) => sample.sequenceFrame !== initial.samples[index].sequenceFrame)) throw new Error('场景探测改变了已准备的曝光时刻，请按完整采样包络重新准备。')
    for (const material of plan.materials) if (request.sources.some(source => source.clipId === material.clipId) && host.generatorTargetCapacity(material.target.width, material.target.height, material.target.format) < 1) throw new Error('空间材料面超过当前设备可容纳的目标容量。')
    reserved = true
    await host.reserveWorkingSet(plan, request.signal)
    current()
    const centerSample: SpatialSample = { index: -1, sequenceFrame: request.sequenceFrame, weight: 1, frame: plan.centerFrame,
      clips: plan.samples[0].clips.map(clip => ({ ...clip, sequenceFrame: request.sequenceFrame, sourceTime: clip.centerSourceTime })) }
    const materials = new Map(plan.materials.map(material => [material.clipId, material]))
    const sourceIds = new Set(request.sources.map(source => source.clipId))
    const centers = new Map<string, SpatialPictureLease>()
    const frameFor = (clipId: string, sample: SpatialSample): SpatialFrame => sample.clips.find(clip => clip.clipId === clipId)?.motionBlur === false ? plan.centerFrame : sample.frame
    const geometryFor = (clipId: string, sample: SpatialSample): SpatialCardGeometry => {
      const geometry = frameFor(clipId, sample).cards.find(card => card.clipId === clipId)
      if (!geometry) throw new Error(`空间曝光缺少片段 ${clipId} 的同帧几何。`)
      return geometry
    }
    const renderScene = async (material: SpatialMaterialPlan, sample: SpatialSample): Promise<SpatialPictureLease> => {
      current()
      const clock = sample.clips.find(clip => clip.clipId === material.clipId)!
      const frozen = !clock.motionBlur
      return transfer(await sources.renderSpatialSample({ prepared: prepared!, clipId: material.clipId,
        sampleIndex: frozen ? -1 : sample.index, sequenceFrame: frozen ? request.sequenceFrame : sample.sequenceFrame,
        sourceTime: frozen ? clock.centerSourceTime : clock.sourceTime, centerSourceTime: clock.centerSourceTime,
        spatialFrame: frameFor(material.clipId, sample), target: material.target, materialPlan: material }), material.target)
    }
    const center = async (material: SpatialMaterialPlan): Promise<SpatialPictureLease> => {
      const existing = centers.get(material.clipId)
      if (existing) return existing
      current()
      const raw = sourceIds.has(material.clipId) ? await renderScene(material, centerSample)
        : await transfer(await host.prepareCardMaterial(request, material), material.target)
      const picture = await defocus(raw, material, geometryFor(material.clipId, centerSample))
      centers.set(material.clipId, picture)
      return picture
    }
    const item = (group: SpatialGroupPlan, clipId: string, picture: SpatialPictureLease, sample: SpatialSample, accumulated = false): SpatialDrawItem => {
      const geometry = geometryFor(clipId, sample)
      const material = materials.get(clipId)!
      const source = request.composition.clips.find(clip => clip.id === clipId)!
      const frame = frameFor(clipId, sample).sequenceFrame
      const projection = accumulated || material.kind === 'worldScene' ? 'screen' : 'material'
      const base = evaluateVideoEditClip(compositionAt?.(request.sequenceFrame).clips.find(clip => clip.id === clipId) ?? source, request.sequenceFrame)
      const materialToOriginal = projection === 'material' ? spatialMultiply(
        spatialInverse(spatialClipMatrix(request.composition, { ...base, spatial: { enabled: false } }, request.output)),
        spatialTranslation(-request.output.displayWidth / request.output.displayHeight / 2, .5, 0),
        spatialScale(1 / request.output.displayHeight, -1 / request.output.displayHeight, 1), material.uvToReference,
      ) : undefined
      const drawGeometry = materialToOriginal ? { ...geometry, clipFromUv: spatialMultiply(geometry.clipFromUv, materialToOriginal), uvToWorld: spatialMultiply(geometry.uvToWorld, materialToOriginal) } : geometry
      return { itemId: geometry.compoundGroup ?? clipId, sourceKey: clipId, clipId, kind: geometry.compoundGroup ? 'transition' : material.kind,
        picture, geometry: drawGeometry, opacity: accumulated ? 1 : evaluateVideoEditClip(source, frame).opacity * videoEditFadeOpacity(source, frame), groupId: group.id,
        ordinal: geometry.ordinal, projection }
    }
    const composite = async (group: SpatialGroupPlan, sample: SpatialSample, items: SpatialDrawItem[]): Promise<SpatialPictureLease> => {
      const order = group.orderBySample[sample.index < 0 ? 0 : sample.index]
      const ordinals = new Map(order.map((id, index) => [id, index]))
      items.sort((a, b) => ordinals.get(a.itemId)! - ordinals.get(b.itemId)!)
      current()
      const picture = own(await host.compositeGroup(group, sample, items))
      for (const entry of items) use(entry.picture, picture.completion)
      return picture
    }
    const completed: Array<{ groupId: string; picture: SpatialPictureLease }> = []
    for (const group of plan.groups) {
      current()
      if (group.mode === 'single') {
        const items: SpatialDrawItem[] = []
        for (const clipId of group.clipIds) items.push(item(group, clipId, await center(materials.get(clipId)!), centerSample))
        completed.push({ groupId: group.id, picture: await composite(group, centerSample, items) })
      } else if (group.mode === 'transform') {
        const layers: SpatialDrawItem[] = []
        for (const itemId of group.itemIds) {
          const ids = group.clipIds.filter(id => (geometryFor(id, centerSample).compoundGroup ?? id) === itemId)
          const clipId = ids[0]
          const material = materials.get(clipId)!
          const accumulator = await begin(target(`${group.id}:${clipId}:layer`, plan))
          if (geometryFor(clipId, centerSample).compoundGroup) {
            const compound = { ...group, clipIds: ids, itemIds: [itemId], orderBySample: plan.samples.map(() => [itemId]) }
            for (const sample of plan.samples) {
              const items: SpatialDrawItem[] = [], temporary: SpatialPictureLease[] = []
              for (const id of ids) {
                const endpoint = materials.get(id)!
                const dynamic = endpoint.kind === 'worldScene' && sample.clips.find(clip => clip.clipId === id)!.motionBlur
                const picture = dynamic ? await defocus(await renderScene(endpoint, sample), endpoint, geometryFor(id, sample)) : await center(endpoint)
                if (dynamic) temporary.push(picture)
                items.push(item(compound, id, picture, sample))
              }
              const picture = await composite(compound, sample, items)
              use(picture, (await host.accumulate(accumulator, picture, sample.weight)).completion)
              await release(picture)
              for (const picture of temporary) await release(picture)
            }
            const picture = own(await host.finishLayer(accumulator))
            await closeAccumulator(accumulator)
            layers.push({ ...item(group, clipId, picture, centerSample, true), kind: 'card' })
            continue
          }
          for (const sample of plan.samples) {
            current()
            const dynamic = material.kind === 'worldScene' && sample.clips.find(clip => clip.clipId === clipId)!.motionBlur
            const picture = dynamic ? await renderScene(material, sample) : await center(material)
            const submission = await host.accumulateLayerSample(accumulator, item(group, clipId, picture, sample), sample.weight)
            use(picture, submission.completion)
            if (dynamic) await release(picture)
          }
          let picture = own(await host.finishLayer(accumulator))
          await closeAccumulator(accumulator)
          if (material.kind === 'worldScene' && plan.samples.some(sample => sample.clips.find(clip => clip.clipId === clipId)!.motionBlur)) picture = await defocus(picture, material, geometryFor(clipId, centerSample))
          layers.push(item(group, clipId, picture, centerSample, true))
        }
        const picture = await composite(group, centerSample, layers)
        for (const layer of layers) await release(layer.picture)
        completed.push({ groupId: group.id, picture })
      } else {
        const accumulator = await begin(target(`${group.id}:exposure`, plan))
        for (const sample of plan.samples) {
          const temporary: SpatialPictureLease[] = []
          const items: SpatialDrawItem[] = []
          for (const clipId of group.clipIds) {
            const material = materials.get(clipId)!
            const dynamic = material.kind === 'worldScene' && sample.clips.find(clip => clip.clipId === clipId)!.motionBlur
            const picture = dynamic ? await defocus(await renderScene(material, sample), material, geometryFor(clipId, sample)) : await center(material)
            if (dynamic) temporary.push(picture)
            items.push(item(group, clipId, picture, sample))
          }
          const picture = await composite(group, sample, items)
          const submission = await host.accumulate(accumulator, picture, sample.weight)
          use(picture, submission.completion)
          await release(picture)
          for (const lease of temporary) await release(lease)
        }
        completed.push({ groupId: group.id, picture: own(await host.finish(accumulator)) })
        await closeAccumulator(accumulator)
      }
    }
    current()
    output = own(await host.compositeFrame(request, completed))
    for (const group of completed) use(group.picture, output.completion)
    current()
    delivered = true
  } catch (error) { failed = true; failure = error }
  finally {
    const cleanup = await Promise.allSettled([...leases.keys()].filter(picture => !delivered || picture !== output).map(release))
    for (const accumulator of accumulators) cleanup.push(...await Promise.allSettled([host.releaseAccumulation(accumulator)]))
    if (prepared) cleanup.push(...await Promise.allSettled([sources.releaseSpatialFrame(prepared)]))
    if (reserved) cleanup.push(...await Promise.allSettled([host.releaseWorkingSet()]))
    cleanup.push(...await Promise.all(retired))
    const errors = cleanup.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length) {
      if (delivered && output) {
        try { await output.release(output.completion) } catch (error) { errors.push(error) }
      }
      failure = new AggregateError(failed ? [failure, ...errors] : errors, '空间曝光资源释放失败。')
      failed = true
    }
    if (output) leases.delete(output)
  }
  if (failed) {
    logger.debug('空间曝光失败', { event: 'video_edit.spatial.exposure.failed', error: failure, context: { ...context, durationMs: performance.now() - started } })
    throw failure
  }
  logger.debug('空间曝光完成', { event: 'video_edit.spatial.exposure.completed', context: { ...context, durationMs: performance.now() - started } })
  return output!
}
