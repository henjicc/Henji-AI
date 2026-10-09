import { createTiledRegionSource, type RegionGrid, type RegionSource } from '@/core/imaging/regions';
import type { ImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes';
import type { Float32MaskTile } from '@/core/imageEdit/v3/effects/contracts';

/** Resource loading remains a host-owned port; this adapter creates neither a repository nor a second mask. */
export function imageEditLayerMaskRegionSource(
  mask: ImageEditSparseMaskReferenceV3,
  grid: RegionGrid,
  loadTile: (resourceId: string, signal?: AbortSignal) => Promise<Float32MaskTile>,
): RegionSource {
  const references = { ...mask.tiles };
  return createTiledRegionSource({
    grid: { ...grid }, tileSize: mask.tileSize, defaultValue: mask.defaultValue, inverted: mask.inverted,
    readTile: async (x, y, signal) => {
      const resourceId = references[`0/${x}/${y}`];
      if (!resourceId) return null;
      const tile = await loadTile(resourceId, signal);
      return { x: x * mask.tileSize, y: y * mask.tileSize, width: tile.width, height: tile.height, data: tile.data };
    },
  });
}
