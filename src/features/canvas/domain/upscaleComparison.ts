/** 只使用结果自带的不可变输入快照；旧结果缺少快照时不猜测当前连线。 */
export function resolveUpscaleComparisonSource(
  data: DynamicValueMap | undefined,
  displayedImage: string,
  toDisplayUrl: (source: string) => string,
): string | null {
  if (data?.sourceCapabilityId !== 'image.upscale'
    || typeof data.imageUrl !== 'string'
    || toDisplayUrl(data.imageUrl) !== displayedImage) return null;
  const inputs = data.generationInputImages;
  if (!Array.isArray(inputs) || inputs.length !== 1) return null;
  const original = inputs[0];
  return typeof original === 'string' && original.trim() ? toDisplayUrl(original) : null;
}
