import type { Coverage, RegionEvaluationContext, RegionFeatherPort, RegionGrid, RegionProgram, RegionSource } from './contracts';
import { assertCoverage, assertRegionRect, combineRegionCoverage, throwIfRegionAborted } from './coverage';
import { evaluateRegionProgram } from './evaluate';

export function createProgramRegionSource(
  resolve: (context: RegionEvaluationContext) => RegionProgram,
  feather?: RegionFeatherPort,
): RegionSource {
  return { defaultValue: context => {
    const program = resolve(context);
    let value = 0;
    for (const operation of program.operations) value = combineRegionCoverage(operation.invertBefore ? 1 - value : value, 0, operation.combine);
    return program.inverted ? 1 - value : value;
  }, read: (region, context) => ({ ...region,
    data: evaluateRegionProgram(resolve(context), context.referenceGrid, region, feather, context.signal),
  }) };
}

export interface TiledRegionOptions {
  grid: RegionGrid;
  tileSize: number;
  defaultValue: number;
  inverted: boolean;
  readTile(x: number, y: number, signal?: AbortSignal): Coverage | null | Promise<Coverage | null>;
}

/** Streams only intersecting tiles. Missing tiles and inversion follow the same contract in every host. */
export function createTiledRegionSource(options: TiledRegionOptions): RegionSource {
  const { grid, tileSize, defaultValue, inverted } = options;
  if (![grid.width, grid.height, tileSize].every(Number.isSafeInteger)
    || grid.width < 1 || grid.height < 1 || tileSize < 1
    || !Number.isFinite(defaultValue) || defaultValue < 0 || defaultValue > 1) throw new Error('区域网格或默认覆盖无效');
  return {
    defaultValue: inverted ? 1 - defaultValue : defaultValue,
    read: async (region, context) => {
      assertRegionRect(region);
      throwIfRegionAborted(context.signal);
      if (context.referenceGrid.width !== grid.width || context.referenceGrid.height !== grid.height) throw new Error('区域来源与参考网格不一致');
      const data = new Float32Array(region.width * region.height);
      const left = Math.max(0, region.x), top = Math.max(0, region.y);
      const right = Math.min(grid.width, region.x + region.width), bottom = Math.min(grid.height, region.y + region.height);
      for (let ty = Math.floor(top / tileSize); ty * tileSize < bottom; ty++) {
        for (let tx = Math.floor(left / tileSize); tx * tileSize < right; tx++) {
          throwIfRegionAborted(context.signal);
          const tile = await options.readTile(tx, ty, context.signal);
          throwIfRegionAborted(context.signal);
          const x0 = tx * tileSize, y0 = ty * tileSize;
          if (tile) {
            assertCoverage(tile);
            if (tile.x !== x0 || tile.y !== y0 || tile.width !== Math.min(tileSize, grid.width - x0)
              || tile.height !== Math.min(tileSize, grid.height - y0)) throw new Error('区域瓦片不符合参考网格');
          }
          for (let y = Math.max(top, y0); y < Math.min(bottom, y0 + tileSize); y++) {
            for (let x = Math.max(left, x0); x < Math.min(right, x0 + tileSize); x++) {
              const value = tile ? tile.data[(y - y0) * tile.width + x - x0] : defaultValue;
              data[(y - region.y) * region.width + x - region.x] = inverted ? 1 - value : value;
            }
          }
        }
      }
      return { ...region, data };
    },
  };
}
