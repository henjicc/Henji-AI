import type { GpuBuffer, GpuDevice, GpuRenderPipeline } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeMatrix, CodePaint } from '@/core/videoEdit/codeMaterial/contract'
import { codeLocalBounds } from '@/core/videoEdit/codeMaterial/geometry'
import { CodeVectorGeometry, vectorRadii, vectorStrokeWidth, type CodeVector } from './videoEditCodeVectorGeometry'
import source from './videoEditCodeVector.wgsl?raw'

export interface CodeVectorInstance { command: CodeVector; matrix: CodeMatrix; opacity: number }
type Pass = ReturnType<ReturnType<GpuDevice['createCommandEncoder']>['beginRenderPass']>
interface BatchBuffer { vertex: GpuBuffer; storage: GpuBuffer; vertices: Float32Array; values: Float32Array; bindGroups: unknown[] }
const transparent: CodePaint = [0, 0, 0, 0]
const stride = 32

/** Fragment-only storage works on compatibility devices with no vertex storage buffers. */
export class CodeVectorGpu {
  private readonly pipeline: GpuRenderPipeline
  private readonly fastPipeline: GpuRenderPipeline
  private readonly buffers: BatchBuffer[] = []
  private readonly geometry = new CodeVectorGeometry()
  private index = 0
  readonly counts = { draws: 0, bufferAllocations: 0 }
  constructor(private readonly device: GpuDevice) {
    const module = device.createShaderModule({ code: source })
    const pipeline = (entryPoint: string): GpuRenderPipeline => device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: stride * 4, stepMode: 'instance', attributes: Array.from({ length: 8 }, (_, index) => ({ shaderLocation: index, offset: index * 16, format: 'float32x4' })) }] }, fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm', blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } })
    this.pipeline = pipeline('fs'); this.fastPipeline = pipeline('fastFs')
  }
  beginFrame(): void { this.index = 0 }
  draw(pass: Pass, width: number, height: number, instances: CodeVectorInstance[]): void {
    const values: number[] = []; const vertices: number[] = []
    let fastBatch = true
    const paints = new Map<CodePaint, number>()
    const paint = (ink: CodePaint): number => {
      const old = paints.get(ink); if (old !== undefined) return old
      const index = values.length / 4; paints.set(ink, index)
      if (Array.isArray(ink)) values.push(0, 0, 0, 0, ...ink)
      else {
        values.push(ink.kind === 'linearGradient' ? 1 : ink.kind === 'radialGradient' ? 2 : 3, ink.stops.length, 0, 0)
        values.push(...(ink.kind === 'linearGradient' ? [ink.x1!, ink.y1!, ink.x2!, ink.y2!] : [ink.cx!, ink.cy!, ink.kind === 'radialGradient' ? ink.r! : (ink.angle ?? 0) / 360, 0]))
        for (const [at, color] of ink.stops) values.push(at, 0, 0, 0, ...color)
      }
      return index
    }
    for (const { command, matrix, opacity } of instances) {
      const radii = command.kind === 'rect' ? vectorRadii(command) : [0, 0, 0, 0]
      const simple = (command.kind === 'rect' || command.kind === 'ellipse') && !command.shadow && !command.glow && !command.blur && (!command.paint || Array.isArray(command.paint)) && !(command.stroke && command.strokeWidth) && !(command.kind === 'rect' && command.radii)
      const fast = simple || command.kind === 'line' && !command.dash?.some(n => n > 0) || command.kind === 'rect' && !(command.stroke && command.strokeWidth) && radii.every(radius => radius === 0)
      if (vertices.length && fast !== fastBatch) { this.upload(pass, vertices, values, fastBatch); values.length = 0; vertices.length = 0; paints.clear() }
      fastBatch = fast
      const fill = paint(command.kind === 'line' ? transparent : command.paint ?? command.fill)
      const stroke = paint(command.stroke ?? (command.kind === 'line' ? command.color : transparent))
      const half = vectorStrokeWidth(command) / 2
      const cap = command.lineCap === 'round' ? 1 : command.lineCap === 'square' ? 2 : 0
      let kind = command.kind === 'rect' ? 0 : command.kind === 'ellipse' ? 1 : command.kind === 'line' ? 2 : 3
      let box = codeLocalBounds(command)
      let shape: number[] = [box.x, box.y, box.width, box.height]
      let fillStart = 0; let fillCount = 0; let strokeStart = 0; let strokeCount = 0; let hairline = 0
      // Lines use a tight, oriented quad. A screen-aligned box shades millions of empty pixels.
      if (command.kind === 'line' && !command.dash?.some(n => n > 0)) {
        const start = command.trimStart ?? 0; const end = command.trimEnd ?? 1
        const dx = command.x2 - command.x1; const dy = command.y2 - command.y1
        const length = Math.hypot(dx, dy) * (end - start)
        if (length <= 0 || half <= 0) continue
        shape = [command.x1 + dx * start, command.y1 + dy * start, command.x1 + dx * end, command.y1 + dy * end]
        box = { x: -half - 1, y: -half - 1, width: length + 2 * half + 2, height: half * 2 + 2 }
      } else if (simple) {
        kind = command.kind === 'rect' ? 4 : 5
        radii.fill(command.kind === 'rect' ? Math.min(command.radius, command.width / 2, command.height / 2) : 0)
      } else {
        const needsEdges = command.kind === 'path' || command.kind === 'line' || command.kind === 'rect' && command.stroke && radii.some(radius => radius === 0)
        if (needsEdges) {
          const edges = this.geometry.get(command)
          hairline = edges.hairline ? 1 : 0
          fillStart = values.length / 4; fillCount = edges.fill.length / 4
          for (const value of edges.fill) values.push(value)
          strokeStart = values.length / 4; strokeCount = edges.stroke.length / 4
          for (const value of edges.stroke) values.push(value)
          if (command.kind === 'line') kind = 3
        }
        // Preserve the old raster viewport (including its miter clipping), not just the geometry.
        const pad = Math.ceil(half + 2)
        box = { x: Math.floor(box.x - pad), y: Math.floor(box.y - pad), width: Math.ceil(box.width + 2 * pad), height: Math.ceil(box.height + 2 * pad) }
      }
      vertices.push(box.x, box.y, box.width, box.height, ...matrix.slice(0, 4), matrix[4], matrix[5], width, height, opacity, kind, command.stroke || command.kind === 'line' ? half : 0, cap, ...shape, ...radii, fill, stroke, fillStart, fillCount, strokeStart, strokeCount, hairline, 0)
      // Bound a binding even for thousands of unrelated complex paths. Splits preserve order.
      if (values.length >= 262144) { this.upload(pass, vertices, values, fastBatch); values.length = 0; vertices.length = 0; paints.clear() }
    }
    this.upload(pass, vertices, values, fastBatch)
  }
  private upload(pass: Pass, vertices: number[], values: number[], fast: boolean): void {
    if (!vertices.length) return
    const index = this.index++; let buffer = this.buffers[index]
    if (!buffer || buffer.vertices.length < vertices.length || buffer.values.length < values.length) {
      const vertexSize = 2 ** Math.ceil(Math.log2(Math.max(vertices.length, buffer?.vertices.length ?? 256)))
      const valueSize = 2 ** Math.ceil(Math.log2(Math.max(values.length, buffer?.values.length ?? 256)))
      buffer?.vertex.destroy(); buffer?.storage.destroy()
      const vertex = this.device.createBuffer({ size: vertexSize * 4, usage: 0x08 | 0x20 })
      const storage = this.device.createBuffer({ size: valueSize * 4, usage: 0x08 | 0x80 })
      buffer = { vertex, storage, vertices: new Float32Array(vertexSize), values: new Float32Array(valueSize), bindGroups: [this.pipeline, this.fastPipeline].map(pipeline => this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] })) }
      this.buffers[index] = buffer; this.counts.bufferAllocations += 2
    }
    buffer.vertices.set(vertices); buffer.values.set(values)
    this.device.queue.writeBuffer(buffer.vertex, 0, buffer.vertices.subarray(0, vertices.length))
    this.device.queue.writeBuffer(buffer.storage, 0, buffer.values.subarray(0, values.length))
    pass.setPipeline(fast ? this.fastPipeline : this.pipeline); pass.setBindGroup(0, buffer.bindGroups[fast ? 1 : 0])
    const instanced = pass as unknown as { setVertexBuffer(slot: number, buffer: GpuBuffer): void; draw(vertices: number, instances: number): void }
    instanced.setVertexBuffer(0, buffer.vertex); instanced.draw(6, vertices.length / stride); this.counts.draws++
  }
  get bytes(): number { return this.buffers.reduce((sum, buffer) => sum + buffer.vertices.byteLength + buffer.values.byteLength, 0) }
  dispose(): void { for (const buffer of this.buffers) { buffer.vertex.destroy(); buffer.storage.destroy() } this.buffers.length = 0; this.geometry.clear() }
}
