/** 渲染计划的宿主字段不能进入共享算法的严格参数 schema。 */
const HOST_FIELDS = new Set([
  'opacity', 'blendMode', 'transform', 'referenceWidth', 'referenceHeight', 'effectQuality',
  'deformation', 'deformationTransform', 'maskDeformation', 'maskTransform', 'maskLinked', 'maskLocalTransform', 'maskDensity', 'filterId', 'clipping',
]);

export function imageEditOperationParametersV3(parameters: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => !HOST_FIELDS.has(key)));
}
