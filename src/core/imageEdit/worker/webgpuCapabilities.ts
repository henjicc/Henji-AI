const RELEVANT_LIMIT_NAMES = [
  'maxTextureDimension1D',
  'maxTextureDimension2D',
  'maxTextureDimension3D',
  'maxTextureArrayLayers',
  'maxBindGroups',
  'maxBindingsPerBindGroup',
  'maxBufferSize',
  'maxUniformBufferBindingSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
  'maxComputeWorkgroupSizeZ',
  'maxComputeWorkgroupsPerDimension',
] as const

export function collectRelevantGpuLimits(limits: unknown): Record<string, number> {
  if (!limits || typeof limits !== 'object') return {}
  const result: Record<string, number> = {}
  for (const name of RELEVANT_LIMIT_NAMES) {
    const value = Reflect.get(limits, name)
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[name] = value
    }
  }
  return result
}
