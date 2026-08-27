import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { CapabilityDescriptor } from './types'

export function normalizeCapabilityStableId(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new AiRuntimeError(code, `${label} must be a non-empty canonical string without surrounding whitespace`)
  }
  if (!/^[A-Za-z0-9@][A-Za-z0-9._:@/-]*$/.test(value)) {
    throw new AiRuntimeError(code, `${label} contains unsupported characters: ${value}`)
  }
  return value
}

/** 在注册或建立发现索引前校验稳定坐标；不会静默 trim 或去重。 */
export function validateCapabilityDescriptor(descriptor: CapabilityDescriptor): void {
  normalizeCapabilityStableId(descriptor.id, 'invalid_capability_id', 'Capability module id')
  normalizeCapabilityStableId(descriptor.kind, 'invalid_capability_kind', 'Capability kind')
  normalizeCapabilityStableId(descriptor.source?.kind, 'invalid_capability_source', 'Capability source kind')
  normalizeCapabilityStableId(
    descriptor.source?.namespace,
    'invalid_capability_source',
    'Capability source namespace'
  )
  if (!Array.isArray(descriptor.contract?.input) || !Array.isArray(descriptor.contract?.output)) {
    throw new AiRuntimeError('invalid_capability_contract', 'Capability contract requires input/output arrays')
  }
  validateUniqueStableIds(descriptor.providerIds, 'provider id')
  validateUniqueStableIds(descriptor.operations, 'operation id')
  validateUniqueStableIds(descriptor.features, 'feature id')
  validateUniqueStableIds(descriptor.tags, 'tag')
  if (descriptor.modelId !== undefined) {
    normalizeCapabilityStableId(
      descriptor.modelId,
      'invalid_capability_model_id',
      'Capability model id'
    )
    if (!descriptor.providerIds?.length) {
      throw new AiRuntimeError(
        'invalid_capability_model_id',
        `Capability module "${descriptor.id}" declares modelId without providerIds`
      )
    }
  }
}

export function capabilityModelCoordinates(descriptor: CapabilityDescriptor): string[] {
  if (!descriptor.modelId) return []
  return (descriptor.providerIds ?? []).map((providerId) => (
    `${providerId}/${descriptor.kind}/${descriptor.modelId}`
  ))
}

export function describeCapabilitySource(descriptor: CapabilityDescriptor): string {
  return `${descriptor.source.kind} source "${descriptor.source.namespace}"`
}

/** 防止插件注册后修改原对象，导致注销时残留旧坐标或绕过冲突检测。 */
export function snapshotCapabilityDescriptor(descriptor: CapabilityDescriptor): CapabilityDescriptor {
  const freezeStrings = (values: readonly string[] | undefined): readonly string[] | undefined => (
    values ? Object.freeze([...values]) : undefined
  )
  const snapshot: CapabilityDescriptor = {
    ...descriptor,
    source: Object.freeze({ ...descriptor.source }),
    contract: Object.freeze({
      input: Object.freeze(descriptor.contract.input.map((value) => Object.freeze({
        ...value,
        mediaTypes: freezeStrings(value.mediaTypes),
      }))),
      output: Object.freeze(descriptor.contract.output.map((value) => Object.freeze({
        ...value,
        mediaTypes: freezeStrings(value.mediaTypes),
      }))),
    }),
    providerIds: freezeStrings(descriptor.providerIds),
    operations: freezeStrings(descriptor.operations),
    features: freezeStrings(descriptor.features),
    tags: freezeStrings(descriptor.tags),
    executionModes: descriptor.executionModes
      ? Object.freeze([...descriptor.executionModes])
      : undefined,
  }
  return Object.freeze(snapshot)
}

function validateUniqueStableIds(values: readonly string[] | undefined, label: string): void {
  const seen = new Set<string>()
  for (const value of values ?? []) {
    const normalized = normalizeCapabilityStableId(
      value,
      'invalid_capability_descriptor',
      `Capability ${label}`
    )
    if (seen.has(normalized)) {
      throw new AiRuntimeError(
        'invalid_capability_descriptor',
        `Capability ${label} is duplicated: ${normalized}`
      )
    }
    seen.add(normalized)
  }
}
