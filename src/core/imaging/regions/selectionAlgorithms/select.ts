import type { Coverage, RegionSnapshot } from '../contracts';
import type { SelectionAlgorithm, SelectionAlgorithmOptions, SelectionPixelSource } from './contracts';
import { colorDistance, pixelPoint, validateTolerance } from './color';
import { checkOptions, emptySnapshot, pixelReader, regions, validatePixels, writeCoverage } from './tiles';
import { focusSelection } from './focus';

export async function solveSelection(source: SelectionPixelSource, algorithm: SelectionAlgorithm, options: SelectionAlgorithmOptions): Promise<RegionSnapshot> {
  const tileSize = checkOptions(source.grid, options);
  if (algorithm.kind === 'focus') return focusSelection(source, algorithm, options);
  validateTolerance(algorithm.tolerance);
  const read = pixelReader(source, options, tileSize);
  const points = (algorithm.kind === 'wand' ? [algorithm.seed] : algorithm.samples).map(point => pixelPoint(point, source.grid));
  if (!points.length) throw new Error('请至少提供一个颜色取样点');
  const colors: (readonly [number, number, number, number])[] = [];
  for (const point of points) colors.push(await read(point.x, point.y));
  const snapshot = emptySnapshot(source.grid, tileSize), tiles = snapshot.tiles as Map<string, Coverage>;
  const total = Math.ceil(source.grid.width / tileSize) * Math.ceil(source.grid.height / tileSize);
  options.onProgress?.(0, total);
  if (algorithm.kind === 'wand' && algorithm.contiguous) {
    // Scanline flood fill crosses storage blocks. Sparse bits record rejected pixels too.
    const visited = new Map<string, Uint8Array>();
    const mark = (x: number, y: number): boolean => {
      const key = `${Math.floor(x / tileSize)}/${Math.floor(y / tileSize)}`;
      let bits = visited.get(key);
      if (!bits) { bits = new Uint8Array(Math.ceil(tileSize * tileSize / 8)); visited.set(key, bits); }
      const index = (y % tileSize) * tileSize + x % tileSize, byte = index >> 3, bit = 1 << (index & 7);
      if (bits[byte] & bit) return false;
      bits[byte] |= bit; return true;
    };
    const matches = async (x: number, y: number): Promise<boolean> => {
      if (x < 0 || y < 0 || x >= source.grid.width || y >= source.grid.height || !mark(x, y)) return false;
      const pixel = await read(x, y);
      // Hidden RGB in fully transparent pixels is ignored; alpha still participates.
      const a = pixel[3] === 0 ? [0, 0, 0, 0] : pixel;
      const b = colors[0][3] === 0 ? [0, 0, 0, 0] : colors[0];
      return colorDistance(a, b, true) <= algorithm.tolerance;
    };
    const queue = [{ left: points[0].x, right: points[0].x, y: points[0].y }];
    while (queue.length) {
      options.context.signal?.throwIfAborted();
      const span = queue.pop()!, y = span.y;
      for (let x = span.left; x <= span.right; x++) {
        if (!await matches(x, y)) continue;
        let left = x, right = x;
        while (await matches(left - 1, y)) left--;
        while (await matches(right + 1, y)) right++;
        for (let xx = left; xx <= right; xx++) writeCoverage(tiles, source.grid, tileSize, xx, y, 1);
        // Enqueue spans, not one object per neighbouring pixel.
        if (y > 0) queue.push({ left, right, y: y - 1 });
        if (y + 1 < source.grid.height) queue.push({ left, right, y: y + 1 });
        x = right;
      }
      options.onProgress?.(visited.size, total);
    }
  } else {
    let completed = 0;
    for (const region of regions(source.grid, tileSize)) {
      options.context.signal?.throwIfAborted();
      const tile = await source.read(region, options.context);
      options.context.signal?.throwIfAborted(); validatePixels(tile, region);
      const data = new Float32Array(region.width * region.height);
      for (let i = 0; i < data.length; i++) {
        const offset = i * 4, alpha = tile.data[offset + 3];
        if (algorithm.kind === 'color-range') {
          if (alpha > 0) {
            let best = 0;
            for (const color of colors) {
              const distance = Math.max(Math.abs(tile.data[offset] - color[0]), Math.abs(tile.data[offset + 1] - color[1]), Math.abs(tile.data[offset + 2] - color[2]));
              best = Math.max(best, 1 - distance / Math.max(algorithm.tolerance, Number.EPSILON));
            }
            data[i] = Math.max(0, best);
          }
        } else {
          const target = colors[0], transparent = target[3] === 0;
          const distance = Math.max(Math.abs((alpha === 0 ? 0 : tile.data[offset]) - (transparent ? 0 : target[0])), Math.abs((alpha === 0 ? 0 : tile.data[offset + 1]) - (transparent ? 0 : target[1])), Math.abs((alpha === 0 ? 0 : tile.data[offset + 2]) - (transparent ? 0 : target[2])), Math.abs(alpha - target[3]));
          data[i] = distance <= algorithm.tolerance ? 1 : 0;
        }
      }
      if (data.some(value => value > 0)) tiles.set(`${region.x / tileSize}/${region.y / tileSize}`, { ...region, data });
      options.onProgress?.(++completed, total);
    }
  }
  options.context.signal?.throwIfAborted(); options.onProgress?.(total, total);
  return snapshot;
}
