import type { CodeParameterDeclaration } from '../videoEdit/codeMaterial/contract'
import { validateCodeMaterialParameterValue } from '../videoEdit/codeMaterial/parameters'
import { codeParameterSupportsInterpolation, interpolateCodeMaterialParameter } from '../videoEdit/codeMaterial/parameterInterpolation'
import { prepareCodeMaterialParameters, type CodeMaterialKeyframe } from '../videoEdit/codeMaterialAnimation'
import type { CodeMaterialMetadata } from '../videoEdit/codeMaterialDocument'
import { videoEditClipSourceTimeAt, type VideoEditClipTiming } from '../videoEdit/clipSpeed'
import type { VideoEditRatio } from '../videoEdit/time'
import { checkCancelled, CreativeIntentError, type ComputationControl } from './sampling'
import { fitPropertySamples, orderedPropertySamples, type PropertySample } from './propertyAdapter'

function channels(parameter: CodeParameterDeclaration, value: unknown): { values: number[]; ranges: number[] } {
  if (parameter.type === 'custom') {
    const parts = Object.entries(parameter.fields).filter(([, field]) => codeParameterSupportsInterpolation(field)).map(([key, field]) => channels(field, (value as Record<string, unknown>)[key]))
    return { values: parts.flatMap(p => p.values), ranges: parts.flatMap(p => p.ranges) }
  }
  if (parameter.type === 'number' || parameter.type === 'angle') return { values: [value as number], ranges: [parameter.max - parameter.min] }
  if (parameter.type === 'color') return { values: value as number[], ranges: [1, 1, 1, 1] }
  if (parameter.type === 'range') return { values: value as number[], ranges: [parameter.max - parameter.min, parameter.max - parameter.min] }
  if (parameter.type === 'point') { const p = value as { x: number; y: number }; return { values: [p.x, p.y], ranges: [parameter.max.x - parameter.min.x, parameter.max.y - parameter.min.y] } }
  if (parameter.type === 'grade') { const p = value as { hue: number; strength: number; luminance: number }; return { values: [p.hue, p.strength, p.luminance], ranges: [360, 1, 2] } }
  throw new CreativeIntentError('parameter-type', [parameter.key], '此参数没有正式的连续插值通道')
}
function discreteSignature(parameter: CodeParameterDeclaration, value: unknown): string {
  if (parameter.type === 'custom') return JSON.stringify(Object.entries(parameter.fields).map(([key, field]) => discreteSignature(field, (value as Record<string, unknown>)[key])))
  return codeParameterSupportsInterpolation(parameter) ? '' : JSON.stringify(value)
}

/** Metadata only: never loads, generates or executes author source. Output uses existing source curves. */
export function compileCodeParameterTake(metadata: CodeMaterialMetadata, key: string, clip: VideoEditClipTiming, rate: VideoEditRatio, input: readonly PropertySample<unknown>[], control: ComputationControl = {}): CodeMaterialKeyframe[] {
  checkCancelled(control)
  const parameter = metadata.parameters.find(p => p.key === key)
  if (!parameter || parameter.type === 'image' || !parameter.animatable) throw new CreativeIntentError('parameter-target', [key], '只能整理正式声明的可动画参数')
  let samples = orderedPropertySamples(input).map(s => {
    if (s.frame < clip.start || s.frame >= clip.start + clip.duration) throw new CreativeIntentError('clip-time', [key], '示范帧必须位于目标片段内')
    return { ...s, value: validateCodeMaterialParameterValue(parameter, s.value) as CodeMaterialKeyframe['value'] }
  })
  const discrete = !codeParameterSupportsInterpolation(parameter)
  // Native hold uses the earlier source key's value. On reverse clips the
  // last frame before a timeline change must therefore be an explicit source key.
  if (clip.reverse) samples = samples.flatMap((s, i) => {
    const next = samples[i + 1]
    return next && next.frame - s.frame > 1 && discreteSignature(parameter, next.value) !== discreteSignature(parameter, s.value)
      ? [s, { ...s, frame: next.frame - 1, value: interpolateCodeMaterialParameter(parameter, s.value, next.value, (next.frame - 1 - s.frame) / (next.frame - s.frame), 'linear') as CodeMaterialKeyframe['value'], hard: true }] : [s]
  })
  // Fit in ascending source direction, including reverse frame sampling's +1 boundary.
  const sourceOrdered = clip.reverse ? [...samples].reverse() : samples
  const signatures = sourceOrdered.map(s => discreteSignature(parameter, s.value))
  const oriented = sourceOrdered.map((s, i) => ({ ...s, hard: s.hard || i > 0 && signatures[i] !== signatures[i - 1] || i + 1 < signatures.length && signatures[i] !== signatures[i + 1], frame: clip.reverse ? samples.at(-1)!.frame - s.frame : s.frame - samples[0].frame }))
  let kept: Set<number>
  if (discrete) kept = new Set(oriented.filter((s, i) => i === 0 || i === oriented.length - 1 || s.hard || JSON.stringify(s.value) !== JSON.stringify(oriented[i - 1].value)).map(s => s.frame))
  else {
    const ranges = channels(parameter, oriented[0].value).ranges
    kept = new Set(fitPropertySamples(oriented.map(s => ({ ...s, value: channels(parameter, s.value).values })), ranges.map(r => r * .001), control))
  }
  const points = oriented.flatMap((s, i): CodeMaterialKeyframe[] => kept.has(s.frame) ? [{ id: crypto.randomUUID(), ...videoEditClipSourceTimeAt(clip, sourceOrdered[i].frame - clip.start, rate), value: structuredClone(s.value), interpolation: discrete ? 'hold' : 'linear' }] : [])
  prepareCodeMaterialParameters(metadata, { parameters: {}, curves: { [key]: points } })
  return points
}
