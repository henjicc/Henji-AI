import { assertRetouchPixels } from './brush';
import type { RetouchPixels } from './contracts';

/** Applies one original-resolution displacement to a streamed target tile. The host provides
 * matching grids; donors are immutable and the entire original selection remains excluded.
 * resolved makes successive donor attempts exclusive, so coverage/opacity is applied once. */
export function applyRetouchTextureDonor(target: RetouchPixels, coverage: Float32Array, donor: RetouchPixels,
  donorCoverage: Float32Array, output: Float32Array, resolved: Uint8Array): number {
  assertRetouchPixels(target); assertRetouchPixels(donor);
  const count = target.width * target.height;
  if (donor.width !== target.width || donor.height !== target.height || coverage.length !== count
    || donorCoverage.length !== count || resolved.length !== count || output.length !== count * 4) throw new Error('纹理供体网格不匹配');
  let remaining = 0;
  for (let i = 0; i < count; i++) {
    if (coverage[i] <= 0 || resolved[i]) continue;
    const alpha = target.data[i * 4 + 3], sourceAlpha = donor.data[i * 4 + 3];
    if (donorCoverage[i] > 0 || sourceAlpha <= 0) { remaining++; continue; }
    for (let c = 0; c < 3; c++) output[i * 4 + c] = Math.fround(target.data[i * 4 + c] + (donor.data[i * 4 + c] / sourceAlpha * alpha - target.data[i * 4 + c]) * coverage[i]);
    resolved[i] = 1;
  }
  return remaining;
}
