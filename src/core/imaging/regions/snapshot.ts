import type { Coverage, RegionEvaluationContext, RegionGrid, RegionRect, RegionSnapshot, RegionSource } from './contracts';
import { assertCoverage, assertRegionRect, throwIfRegionAborted } from './coverage';
import { createTiledRegionSource } from './source';

/** Detached snapshot: no writable pixel buffer or map is shared with the caller. */
export function createRegionSnapshot(input: RegionSnapshot): RegionSnapshot {
  const { grid, tileSize, defaultValue } = input;
  if (![grid.width, grid.height, tileSize].every(Number.isSafeInteger)
    || grid.width < 1 || grid.height < 1 || tileSize < 1
    || !Number.isFinite(defaultValue) || defaultValue < 0 || defaultValue > 1) throw new Error('区域快照网格或默认覆盖无效');
  const tiles = new Map<string, Coverage>();
  for (const [key, tile] of input.tiles) {
    assertCoverage(tile);
    if (tile.x < 0 || tile.y < 0 || tile.x % tileSize !== 0 || tile.y % tileSize !== 0
      || tile.width !== Math.min(tileSize, grid.width - tile.x) || tile.height !== Math.min(tileSize, grid.height - tile.y)
      || key !== `${tile.x / tileSize}/${tile.y / tileSize}`) throw new Error('区域快照瓦片不符合参考网格');
    tiles.set(key, { ...tile, data: new Float32Array(tile.data) });
  }
  return { ...input, grid: { ...grid }, tiles };
}

/** Owns a second detached snapshot so edits to returned snapshots cannot alter an active source. */
export function createSnapshotRegionSource(input: RegionSnapshot): RegionSource {
  const snapshot = createRegionSnapshot(input);
  return createTiledRegionSource({
    ...snapshot,
    readTile: (x, y) => snapshot.tiles.get(`${x}/${y}`) ?? null,
  });
}

/** Time-specific providers share the same ROI validation and cancellation boundary. */
export async function readRegionSource(source: RegionSource, region: RegionRect, context: RegionEvaluationContext): Promise<Coverage> {
  assertRegionRect(region);
  throwIfRegionAborted(context.signal);
  const result = await source.read(region, context);
  throwIfRegionAborted(context.signal);
  assertCoverage(result);
  if (result.x !== region.x || result.y !== region.y || result.width !== region.width || result.height !== region.height) {
    throw new Error('区域来源返回了错误的求值范围');
  }
  return result;
}

export function staticRegionContext(grid: RegionGrid, sourceVersion: string, signal?: AbortSignal): RegionEvaluationContext {
  return { referenceGrid: { ...grid }, sourceVersion, time: { kind: 'static' }, quality: 'final', signal };
}
