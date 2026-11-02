/** Same blend math for CPU hosts and WGSL adapters; values are straight RGB. */
export type CompositingBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
export function blendChannel(backdrop: number, source: number, mode: CompositingBlendMode): number {
  if (mode === 'multiply') return backdrop * source;
  if (mode === 'screen') return backdrop + source - backdrop * source;
  if (mode === 'overlay') return backdrop <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
  if (mode === 'soft-light') {
    if (source <= 0.5) return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
    const curve = backdrop <= 0.25 ? ((16 * backdrop - 12) * backdrop + 4) * backdrop : Math.sqrt(Math.max(0, backdrop));
    return backdrop + (2 * source - 1) * (curve - backdrop);
  }
  return source;
}

/** Allocation-free channel kernel for tiled/streamed hosts. */
export function compositeChannel(backdrop: number, source: number, ba: number, sa: number,
  mode: CompositingBlendMode, clipping: boolean): number {
  return (1 - sa) * backdrop + ba * sa * blendChannel(ba > 0 ? backdrop / ba : 0, sa > 0 ? source / sa : 0, mode)
    + (clipping ? 0 : (1 - ba) * source);
}

export function maskDensity(coverage: number, density: number): number {
  return 1 - density * (1 - coverage);
}
