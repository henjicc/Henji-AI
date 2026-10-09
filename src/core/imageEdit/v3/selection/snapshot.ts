import type { RegionSnapshot, RegionTransform, RegionGrid } from '../../../imaging/regions/contracts';
import { createRegionSnapshot } from '../../../imaging/regions/snapshot';
import type { ImageEditSelectionMaskShapeV3 } from '../subjectSelection';

/** Encodes rows directly from sparse float32 tiles, without a full-frame allocation or byte conversion. */
export function encodeImageEditRegionSnapshotV3(input: RegionSnapshot, sourceToDocument: RegionTransform, documentGrid: RegionGrid): ImageEditSelectionMaskShapeV3 {
  const snapshot = createRegionSnapshot(input), { width, height } = snapshot.grid;
  const runs: ImageEditSelectionMaskShapeV3['runs'] = [];
  const push = (start: number, length: number, value: number): void => {
    const coverage = Math.fround(snapshot.inverted ? 1 - value : value);
    if (!coverage) return;
    const last = runs.at(-1);
    if (last && last[0] + last[1] === start && last[2] === coverage) last[1] += length;
    else runs.push([start, length, coverage]);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += snapshot.tileSize) {
    const tile = snapshot.tiles.get(`${x / snapshot.tileSize}/${Math.floor(y / snapshot.tileSize)}`);
    const length = Math.min(snapshot.tileSize, width - x);
    if (!tile) { push(y * width + x, length, snapshot.defaultValue); continue; }
    const offset = (y - tile.y) * tile.width;
    for (let i = 0; i < length;) {
      const start = i, value = tile.data[offset + i++];
      while (i < length && tile.data[offset + i] === value) i++;
      push(y * width + x + start, i - start, value);
    }
  }
  const [a, b, c, d, e, f] = sourceToDocument;
  return { type: 'mask', width, height, runs, matrix: [a * width / documentGrid.width, b * width / documentGrid.height,
    c * height / documentGrid.width, d * height / documentGrid.height, e / documentGrid.width, f / documentGrid.height] };
}
