import type * as Three from 'three'
import { contours } from 'd3-contour'
import simplify from 'simplify-js'
import type { SpaceMaterial } from '@/core/videoEdit/spatialSchema'
import { createSpaceMaterial } from './videoEditSpaceMaterials'

/**
 * 实体卡片：片段受光、材质不是画面、或有厚度时，卡片从“贴好的平面画面”变成三维物体——画面作底色（玻璃、亚克力只取形状），
 * 透明处镂空，被灯光与环境照亮，可投影；有厚度时沿轮廓向后挤出（侧面取画面的平均色）。
 * 轮廓来自卡片画面的透明度（长边 256 格读回，d3-contour 等值线 + simplify-js 简化），按内容身份缓存；
 * 读回不挡预览：没读到前先按平面画，成片等读回完成。内容身份缺省（逐帧变化的画面）按整张卡片的矩形长厚度。
 */
export interface SolidSurface {
  lit: boolean
  material: SpaceMaterial
  thickness: number
  bevel: number
  castShadow: boolean
  receiveShadow: boolean
  /** 卡片画面的内容身份（相同就是同一张画面）；缺省为逐帧变化的画面。 */
  contentKey?: string
}
function solidSurfaceKey(surface: SolidSurface): string { return JSON.stringify([surface.lit, surface.material]) }

interface TslNode {
  mul(value: TslInput): TslNode; div(value: TslInput): TslNode; add(value: TslInput): TslNode
  greaterThan(value: TslInput): TslNode
  readonly rgb: TslNode; readonly a: TslNode
  sample(uv: TslNode): TslNode
}
type TslInput = TslNode | number
type TslFn = (...args: TslInput[]) => TslNode
interface Tsl {
  texture(value: Three.Texture): TslNode & { value: Three.Texture }
  vec2: TslFn; vec3: TslFn; vec4: TslFn; select: TslFn; max: TslFn; pow: TslFn; textureLoad: TslFn; ivec2: TslFn
}
type NodeMaterial = Three.Material & { colorNode: TslNode | null; maskNode: TslNode | null; emissiveNode: TslNode | null; mrtNode: unknown }
type Library = typeof Three & {
  MeshPhysicalNodeMaterial: new (parameters?: Record<string, unknown>) => NodeMaterial
  MeshBasicNodeMaterial: new (parameters?: Record<string, unknown>) => NodeMaterial
  QuadMesh: new (material: Three.Material) => { render(renderer: unknown): void }
}
interface Renderer {
  setRenderTarget(target: Three.RenderTarget | null): void
  readRenderTargetPixelsAsync(target: Three.RenderTarget, x: number, y: number, width: number, height: number): Promise<Uint8Array>
}
export interface SolidCardInput {
  mesh: Three.Mesh
  /** 卡片的画面纹理（宿主纹理：预乘、2.4 伽马）与透明度、发光强度均匀量。 */
  map: TslNode & { value: Three.Texture }
  opacity: TslNode & { value: number }
  emission: TslNode & { value: number }
  width: number
  height: number
}
interface SolidState {
  key: string
  /** 正面材质；未受光的画面材质是平面卡片材质的副本（flat 指向原件，多目标输出跟着原件切换）。 */
  face: NodeMaterial
  flat?: NodeMaterial
  side: NodeMaterial
  /** 玻璃、亚克力自己管透明（透射要排在透明队列里），不随片段透明度切换。 */
  fixedTransparency: boolean
  /** 有发光附件的管线里正面写的那一份多目标输出（发光自带光晕）。 */
  emissionOutput?: unknown
  average: { target: Three.RenderTarget; quad: { render(renderer: unknown): void }; material: Three.Material }
  geometryKey?: string
  geometry?: Three.BufferGeometry
}
type Polygon = { outer: Array<[number, number]>; holes: Array<Array<[number, number]>> }
const OUTLINE_SIDE = 256
const OUTLINE_CACHE = 64

export class VideoEditSolidCards {
  private readonly states = new Map<Three.Mesh, SolidState>()
  private readonly outlines = new Map<string, Promise<Polygon[]>>()
  private readout?: { target: Three.RenderTarget; source: TslNode & { value: Three.Texture }; quad: { render(renderer: unknown): void }; material: Three.Material; placeholder: Three.Texture }

  constructor(private readonly library: Library, private readonly tsl: Tsl & { mrt(outputs: Record<string, TslNode>): unknown }, private readonly renderer: Renderer, private readonly flat: Three.BufferGeometry) {}

  /** 管线有没有发光附件随序列而定：受光实体的正面在有附件时写自己的发光（自带光晕），没有时不能写。 */
  syncOutputs(emission: boolean): void {
    for (const state of this.states.values()) {
      if (state.flat) {
        for (const material of [state.face, state.side]) if (material.mrtNode !== state.flat.mrtNode) { material.mrtNode = state.flat.mrtNode; material.needsUpdate = true }
        continue
      }
      if (!state.emissionOutput) continue
      const next = emission ? state.emissionOutput : null
      if (state.face.mrtNode !== next) { state.face.mrtNode = next; state.face.needsUpdate = true }
    }
  }

  /** 线性直通色（与平面卡片同一解码约定）。 */
  private straight(sample: TslNode): TslNode {
    const { tsl } = this
    return tsl.pow(tsl.max(tsl.select(sample.a.greaterThan(0), sample.rgb.div(sample.a), tsl.vec3(0)), tsl.vec3(0)), tsl.vec3(2.4))
  }

  /** 网格换成实体（或换回平面：surface 缺省）。返回这一帧是否还在用粗略形状（轮廓没读回）。 */
  async apply(card: SolidCardInput, flatMaterial: Three.Material, surface: SolidSurface | undefined, scale: readonly [number, number, number], exact: boolean): Promise<{ approximate: boolean }> {
    const { mesh } = card
    let state = this.states.get(mesh)
    if (!surface) {
      if (state) { this.release(state); this.states.delete(mesh) }
      mesh.geometry = this.flat; mesh.material = flatMaterial; mesh.castShadow = mesh.receiveShadow = false
      return { approximate: false }
    }
    const key = solidSurfaceKey(surface)
    if (state && state.key !== key) { this.release(state); this.states.delete(mesh); state = undefined }
    if (!state) { state = this.create(card, surface, key, flatMaterial as NodeMaterial); this.states.set(mesh, state) }
    // 侧面颜色：卡片画面的平均色（每帧在显卡上归约到 1×1）。
    this.renderer.setRenderTarget(state.average.target)
    try { state.average.quad.render(this.renderer) } finally { this.renderer.setRenderTarget(null) }
    const transparent = card.opacity.value < 1
    if (!state.fixedTransparency) for (const material of [state.face, state.side]) if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true }
    mesh.castShadow = surface.castShadow
    mesh.receiveShadow = surface.receiveShadow
    let approximate = false
    if (surface.thickness > 0) {
      const outline = surface.contentKey === undefined ? undefined : this.outline(surface.contentKey, card)
      const shapes = outline ? exact ? await outline : await Promise.race([outline, Promise.resolve(undefined)]) : undefined
      approximate = !!outline && !shapes
      const geometryKey = JSON.stringify([shapes ? surface.contentKey : 'rect', surface.thickness, surface.bevel, scale])
      if (state.geometryKey !== geometryKey && (shapes || !outline)) {
        state.geometry?.dispose()
        state.geometry = this.extrude(shapes ?? [{ outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] }], surface.thickness, surface.bevel, scale)
        state.geometryKey = geometryKey
      }
      // 轮廓还没读回（看片时内容刚变）：沿用上一次的形状，没有过形状才先按平面。
      mesh.geometry = state.geometry ?? this.flat
    } else mesh.geometry = this.flat
    // 挤出体有两组面（正背面、侧面）；平面只有一组。玻璃、亚克力挤出后是闭合体只画正面，没厚度时是一张薄片、两面都画。
    if (state.fixedTransparency && !state.flat) {
      const side = mesh.geometry === this.flat ? this.library.DoubleSide : this.library.FrontSide
      if (state.face.side !== side) { state.face.side = side; state.face.needsUpdate = true }
    }
    mesh.material = mesh.geometry === this.flat || !mesh.geometry.groups.length ? state.face : [state.face, state.side]
    return { approximate }
  }

  /** 未受光的实体（画面材质只长厚度或投影）：照旧按平面卡片画（实时的卡片那一层画它，路径追踪里是 matte 发光面）。 */
  isFlatSolid(mesh: Three.Mesh): boolean { return !!this.states.get(mesh)?.flat }
  /** 路径追踪里受光实体卡片的经典材质参数（画面作底色时）；玻璃、亚克力走材质库的替换表或本身就是经典参数。 */
  pathTraceParameters(mesh: Three.Mesh): { roughness: number; metalness: number } | undefined {
    const state = this.states.get(mesh)
    if (!state || state.flat) return undefined
    const face = state.face as unknown as { roughness: number; metalness: number; transmission?: number }
    return (face.transmission ?? 0) > 0 ? undefined : { roughness: face.roughness, metalness: face.metalness }
  }
  isSolid(mesh: Three.Mesh): boolean { return this.states.has(mesh) }

  private create(card: SolidCardInput, surface: SolidSurface, key: string, flatMaterial: NodeMaterial): SolidState {
    const { library, tsl } = this
    const preset = surface.material.preset
    const params = surface.material as Record<string, unknown>
    // 纹理节点本身按网格 uv 取样（正面 uv 与画面逐像素对齐）。
    const straight = this.straight(card.map)
    const average = this.averageTarget(card)
    const mean = tsl.textureLoad(tsl.texture(average.target.texture), tsl.ivec2(0, 0))
    // 画面材质、不受光：正面仍是平面卡片（宿主预虚化、跳过色调映射），只长出厚度；侧面按画面平均色、不受光。
    // 用副本：同一份材质同时挂在网格的两组面与单材质之间来回切换时，three 会释放仍在使用的绘制对象缓冲。
    if (!surface.lit) {
      // 侧面与正面同一种混合（预乘、ONE / ONE_MINUS_SRC_ALPHA）与同一份后处理属性（跳过色调映射与整幅景深），淡入淡出时一起变。
      const side = new library.MeshBasicNodeMaterial({ toneMapped: false, side: library.DoubleSide, transparent: true, depthWrite: true, premultipliedAlpha: true,
        blending: library.CustomBlending, blendSrc: library.OneFactor, blendDst: library.OneMinusSrcAlphaFactor, blendSrcAlpha: library.OneFactor, blendDstAlpha: library.OneMinusSrcAlphaFactor })
      side.colorNode = tsl.vec4(mean.rgb.mul(card.opacity), card.opacity)
      side.mrtNode = flatMaterial.mrtNode
      const face = (flatMaterial as unknown as { clone(): NodeMaterial }).clone()
      return { key, face, flat: flatMaterial, side, fixedTransparency: true, average }
    }
    let face: NodeMaterial
    const glassy = preset === 'glass' || preset === 'acrylic'
    if (preset === 'glass') {
      face = createSpaceMaterial(library, tsl as never, 'glass', { frost: params.frost as number | undefined, dispersion: params.dispersion as number | undefined, tint: params.tint as string | undefined, absorption: params.absorption as number | undefined }) as NodeMaterial
    } else if (preset === 'acrylic') {
      const classic = createSpaceMaterial(library, tsl as never, 'acrylic', { frost: params.frost as number | undefined, tint: params.tint as string | undefined }) as Three.MeshPhysicalMaterial
      face = new library.MeshPhysicalNodeMaterial({ color: classic.color, roughness: classic.roughness, metalness: 0, transmission: 1, thickness: classic.thickness, ior: classic.ior, transparent: true })
      classic.dispose()
    } else {
      // 画面材质受光时按偏哑光的表面；磨砂、金属、薄膜金属取材质库同参数，底色换成画面。
      const classic = createSpaceMaterial(library, tsl as never, preset === 'picture' ? 'matte' : preset, preset === 'picture' ? { roughness: .85 } : params as never) as Three.MeshPhysicalMaterial
      face = new library.MeshPhysicalNodeMaterial({ roughness: classic.roughness, metalness: classic.metalness, iridescence: classic.iridescence,
        iridescenceIOR: classic.iridescenceIOR, iridescenceThicknessRange: classic.iridescenceThicknessRange, iridescenceThicknessMap: classic.iridescenceThicknessMap })
      classic.dispose()
      face.colorNode = tsl.vec4(straight, card.opacity)
      face.emissiveNode = straight.mul(card.emission)
    }
    // 实体是物体：后处理属性按物体（色调映射、整幅景深），不写平面卡片的那一份；发光在有发光附件时另写。
    face.mrtNode = null
    face.maskNode = card.map.a.greaterThan(.5)
    // 玻璃、亚克力是闭合的透射体，只画正面（背面由背面通道记下）；其他表面双面，薄片背面也看得见。
    face.side = glassy ? library.FrontSide : library.DoubleSide
    face.depthWrite = true
    let side: NodeMaterial
    if (glassy) side = face
    else {
      // 侧面：同一种表面，颜色取画面平均色，不镂空。
      side = (face as unknown as { clone(): NodeMaterial }).clone()
      side.maskNode = null
      side.colorNode = tsl.vec4(mean.rgb, card.opacity)
      side.emissiveNode = mean.rgb.mul(card.emission)
    }
    const emissionOutput = glassy ? undefined : tsl.mrt({ emission: tsl.vec4(straight.mul(card.emission), card.opacity) as TslNode })
    return { key, face, side, fixedTransparency: glassy, ...(emissionOutput ? { emissionOutput } : {}), average }
  }

  /** 卡片画面的平均直通色（预乘平均 ÷ 平均覆盖率），8×8 个采样点。 */
  private averageTarget(card: SolidCardInput): SolidState['average'] {
    const { library, tsl } = this
    const target = new library.RenderTarget(1, 1, { type: library.HalfFloatType, depthBuffer: false })
    let color: TslNode = tsl.vec3(0), coverage: TslNode = tsl.vec3(0)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sample = card.map.sample(tsl.vec2((x + .5) / 8, (y + .5) / 8))
      color = color.add(this.straight(sample).mul(sample.a))
      coverage = coverage.add(tsl.vec3(sample.a))
    }
    const material = new library.MeshBasicNodeMaterial({ toneMapped: false, depthTest: false, depthWrite: false })
    material.colorNode = tsl.vec4(color.div(tsl.max(coverage, 1e-4)), 1)
    return { target, quad: new library.QuadMesh(material), material }
  }

  /** 读回卡片画面的透明度，求出轮廓（uv 多边形）。同一内容身份只读一次。 */
  private outline(contentKey: string, card: SolidCardInput): Promise<Array<{ outer: Array<[number, number]>; holes: Array<Array<[number, number]>> }>> {
    const cached = this.outlines.get(contentKey)
    if (cached) { this.outlines.delete(contentKey); this.outlines.set(contentKey, cached); return cached }
    const { library, tsl } = this
    const aspect = card.width / Math.max(1, card.height)
    const width = aspect >= 1 ? OUTLINE_SIDE : Math.max(8, Math.round(OUTLINE_SIDE * aspect)), height = aspect >= 1 ? Math.max(8, Math.round(OUTLINE_SIDE / aspect)) : OUTLINE_SIDE
    if (!this.readout) {
      const placeholder = new library.Texture()
      const source = tsl.texture(placeholder)
      const material = new library.MeshBasicNodeMaterial({ toneMapped: false, depthTest: false, depthWrite: false })
      material.colorNode = tsl.vec4(tsl.vec3((source as unknown as TslNode).a), 1)
      this.readout = { target: new library.RenderTarget(width, height, { depthBuffer: false }), source, quad: new library.QuadMesh(material), material, placeholder }
    }
    const readout = this.readout
    if (readout.target.width !== width || readout.target.height !== height) readout.target.setSize(width, height)
    readout.source.value = card.map.value
    this.renderer.setRenderTarget(readout.target)
    try { readout.quad.render(this.renderer) } finally { this.renderer.setRenderTarget(null) }
    const pending = this.renderer.readRenderTargetPixelsAsync(readout.target, 0, 0, width, height).then(pixels => {
      // 显卡读回的每行按 256 字节对齐，行末可能带填充：按实际行跨度取。
      const stride = Math.floor(pixels.length / height)
      const alpha = new Float64Array(width * height)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = pixels[y * stride + x * 4]
      const [field] = contours().size([width, height]).thresholds([128])(alpha as unknown as number[])
      const toUv = (ring: Array<[number, number]>): Array<[number, number]> => simplify(ring.map(([x, y]) => ({ x, y })), .6, true).map(point => [point.x / width, point.y / height] as [number, number])
      return (field?.coordinates ?? []).map(polygon => ({ outer: toUv(polygon[0] as Array<[number, number]>), holes: polygon.slice(1).map(ring => toUv(ring as Array<[number, number]>)) })).filter(polygon => polygon.outer.length >= 3)
    })
    this.outlines.set(contentKey, pending)
    pending.catch(() => this.outlines.delete(contentKey))
    while (this.outlines.size > OUTLINE_CACHE) this.outlines.delete(this.outlines.keys().next().value!)
    return pending
  }

  /**
   * 沿轮廓向后挤出：正面在卡片平面上（局部 z = 0），厚度向远离镜头的一侧。在世界尺度下挤出（卡片局部 x、y 按画面宽高缩放，
   * 直接在局部空间做倒角会横竖不一致），再缩回局部空间。倒角向内收（不让字变粗），大小按厚度的比例，
   * 并限在最细笔画（按 2 × 面积 ÷ 周长估计）半宽的三分之一以内。uv 按卡片平面位置铺，正面与画面逐像素对齐。
   */
  private extrude(polygons: Polygon[], depth: number, bevel: number, scale: readonly [number, number, number]): Three.BufferGeometry {
    const { library } = this
    const [sx, sy, sz] = [scale[0] || 1, scale[1] || 1, scale[2] || 1]
    const point = ([u, v]: [number, number]): Three.Vector2 => new library.Vector2((u - .5) * sx, (v - .5) * sy)
    const shapes = polygons.map(polygon => {
      const shape = new library.Shape(polygon.outer.map(point))
      shape.holes = polygon.holes.map(ring => new library.Path(ring.map(point)))
      return shape
    })
    const ringArea = (ring: Array<[number, number]>): number => Math.abs(ring.reduce((sum, [u, v], index) => { const [u2, v2] = ring[(index + 1) % ring.length]; return sum + (u * sx) * (v2 * sy) - (u2 * sx) * (v * sy) }, 0)) / 2
    const ringLength = (ring: Array<[number, number]>): number => ring.reduce((sum, [u, v], index) => { const [u2, v2] = ring[(index + 1) % ring.length]; return sum + Math.hypot((u2 - u) * sx, (v2 - v) * sy) }, 0)
    const stroke = Math.min(...polygons.map(polygon => {
      const area = ringArea(polygon.outer) - polygon.holes.reduce((sum, ring) => sum + ringArea(ring), 0)
      const length = ringLength(polygon.outer) + polygon.holes.reduce((sum, ring) => sum + ringLength(ring), 0)
      return length > 0 ? 2 * area / length : Infinity
    }))
    const size = bevel > 0 ? Math.min(bevel * depth, stroke / 6) : 0
    const geometry = new library.ExtrudeGeometry(shapes, { depth: Math.max(1e-4, depth - 2 * size), curveSegments: 1, steps: 1,
      bevelEnabled: size > 0, bevelThickness: size, bevelSize: size, bevelOffset: -size, bevelSegments: 3 })
    geometry.translate(0, 0, -depth + size)
    geometry.scale(1 / sx, 1 / sy, 1 / sz)
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    for (let index = 0; index < uv.count; index++) uv.setXY(index, position.getX(index) + .5, position.getY(index) + .5)
    geometry.computeVertexNormals()
    return geometry
  }

  private release(state: SolidState): void {
    if (!state.flat) (state.face as unknown as { iridescenceThicknessMap?: Three.Texture | null }).iridescenceThicknessMap?.dispose()
    state.face.dispose()
    if (state.side !== state.face) state.side.dispose()
    state.geometry?.dispose(); state.average.target.dispose(); state.average.material.dispose()
  }

  dispose(): void {
    for (const state of this.states.values()) this.release(state)
    this.states.clear()
    if (this.readout) { this.readout.target.dispose(); this.readout.material.dispose(); this.readout.placeholder.dispose() }
  }
}
