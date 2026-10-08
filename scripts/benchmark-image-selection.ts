/** 显式 CPU 栅格基准；不启动 Electron、不包含 IPC/磁盘/呈现延迟。 */
import { cpus } from 'node:os'
import { appendImageEditSelectionV3, type ImageEditSelectionIntentShapeV3 } from '../src/core/imageEdit/v3/selection/session'
import { rasterizeSelectionRequestV3 } from '../src/features/imageEdit/v3/execution/selectionRaster.worker'

const points = Array.from({ length: 256 }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos(i * Math.PI / 128), y: 0.5 + 0.3 * Math.sin(i * Math.PI / 128) }))
const shapes: ImageEditSelectionIntentShapeV3[] = [
  { type: 'rectangle', x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
  { type: 'ellipse', x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
  { type: 'lasso', points },
  { type: 'brush', points: points.slice(0, 128), radius: 0.01 },
]
process.stdout.write(`${JSON.stringify({ cpu: cpus()[0]?.model, runtime: process.version, tileSize: 512, repetitions: 3 })}\n`)
for (const edge of [4096, 8192]) for (const shape of shapes) for (const feather of [0, 0.01]) {
  const size = { width: edge, height: edge }, selection = { ...appendImageEditSelectionV3(null, shape, 'replace'), feather }
  rasterizeSelectionRequestV3({ selection, size, region: { x: 0, y: 0, width: 512, height: 512 }, matrix: [1, 0, 0, 1, 0, 0] })
  const totals: number[] = [], tiles: number[] = []
  for (let repeat = 0; repeat < 3; repeat++) {
    const started = performance.now()
    for (let y = 0; y < edge; y += 512) for (let x = 0; x < edge; x += 512) {
      const tileStart = performance.now()
      rasterizeSelectionRequestV3({ selection, size, region: { x, y, width: 512, height: 512 }, matrix: [1, 0, 0, 1, 0, 0] })
      tiles.push(performance.now() - tileStart)
    }
    totals.push(performance.now() - started)
  }
  totals.sort((a, b) => a - b); tiles.sort((a, b) => a - b)
  process.stdout.write(`${JSON.stringify({ edge, shape: shape.type, feather, medianMs: +totals[1].toFixed(2), tileP95Ms: +tiles[Math.ceil(tiles.length * 0.95) - 1].toFixed(2) })}\n`)
}
