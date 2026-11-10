import type * as Three from 'three'

/**
 * 三维标准材质：作者场景（`host.space.material`）与以后的时间线片段材质共用一份实现。参数按意图给（磨砂程度、色散、吸收），
 * 实时与路径追踪读同一份参数：磨砂、金属、薄膜金属、亚克力、发光体直接是经典材质参数，两边一致；
 * 实心玻璃实时用两次折射的节点材质（three 自带的透射只折一次、看起来是空心的），路径追踪时换成同参数的经典透射材质（真实体积）。
 */
const SPACE_MATERIAL_PRESETS = ['matte', 'metal', 'thin-film', 'acrylic', 'glass', 'emissive'] as const
export type SpaceMaterialPreset = typeof SPACE_MATERIAL_PRESETS[number]
export interface SpaceMaterialParams {
  /** 颜色：'#rrggbb' 或 0xrrggbb。磨砂、金属、薄膜金属的底色，发光体的光色。 */
  color?: string | number
  /** 表面粗糙 0–1。 */
  roughness?: number
  /** 亚克力、玻璃的磨砂程度 0–1（0 清透）。 */
  frost?: number
  /** 亚克力、玻璃的颜色（透过去的光被染成这个颜色）。 */
  tint?: string | number
  /** 玻璃的色散 0–1（边缘分出彩边）。 */
  dispersion?: number
  /** 玻璃的吸收 0–1：越厚的地方颜色越深（0 不吸收，只在表面带一点 tint）。 */
  absorption?: number
  /** 玻璃折射率，缺省 1.5。 */
  ior?: number
  /** 薄膜金属：膜厚范围（纳米），缺省 [250, 650]；strength 薄膜强度 0–1；frequency 沿 u 方向的色带条数。 */
  range?: readonly [number, number]
  strength?: number
  frequency?: number
  /** 发光体亮度（线性倍数），缺省 2。 */
  intensity?: number
}

type Library = typeof Three
/** 作者版 three 的 TSL 节点（类型声明跟着应用自带的 three 版本，这里只描述用到的部分）。 */
interface TslNode {
  mul(value: TslInput): TslNode; div(value: TslInput): TslNode; add(value: TslInput): TslNode; sub(value: TslInput): TslNode
  greaterThan(value: TslInput): TslNode; lessThan(value: TslInput): TslNode; and(value: TslNode): TslNode; or(value: TslNode): TslNode; readonly xyz: TslNode; negate(): TslNode; normalize(): TslNode; length(): TslNode
  dot(value: TslNode): TslNode; pow(value: TslInput): TslNode; sample(coord: TslNode): TslNode
  readonly r: TslNode; readonly g: TslNode; readonly b: TslNode; readonly rgb: TslNode; readonly a: TslNode; readonly xy: TslNode; readonly z: TslNode; readonly w: TslNode; readonly x: TslNode; readonly y: TslNode
}
type TslInput = TslNode | number
type TslFn = (...args: TslInput[]) => TslNode
interface Tsl {
  texture(value: Three.Texture): TslNode & { value: Three.Texture }
  uniform(value: number): TslNode & { value: number }
  vec2: TslFn; vec3: TslFn; vec4: TslFn; float: TslFn; select: TslFn; max: TslFn; refract: TslFn; reflect: TslFn; log2: TslFn; exp: TslFn; pow: TslFn
  textureBicubicLevel: TslFn; viewportOpaqueMipTexture(uv: TslNode): TslNode; cos: TslFn; sin: TslFn; or: TslFn
  pmremTexture(value: Three.Texture, direction?: TslNode, level?: TslInput): TslNode & { value: Three.Texture }
  positionView: TslNode; normalView: TslNode; cameraProjectionMatrix: TslNode; cameraWorldMatrix: TslNode; screenUV: TslNode; screenSize: TslNode
}

/**
 * 实心玻璃要的背面信息由统一三维渲染器每帧画出：玻璃物体的背面在视空间里的法线（rgb）与视深（a），
 * 渲染器把玻璃网格加进 `layer` 这一层单独画背面。`on` 为 0 时（作者场景单独渲染、实体线框显示）按固定厚度近似。
 */
export interface SpaceGlassShared {
  back: TslNode & { value: Three.Texture }; on: TslNode & { value: number }; layer: number
  /** 场景环境（等距柱状）的取样节点与强度、水平旋转：全反射与出射到屏幕外的光线取环境，而不是屏幕上的画面。 */
  environments: Set<TslNode & { value: Three.Texture }>; environmentIntensity: TslNode & { value: number }; environmentRotation: TslNode & { value: number }
  placeholder: Three.Texture
}
const SPACE_GLASS_LAYER = 30
const shared = new WeakMap<object, SpaceGlassShared>()
export function spaceGlassShared(library: Library, tsl: Tsl): SpaceGlassShared {
  let value = shared.get(library)
  if (!value) {
    const placeholder = new library.DataTexture(new Uint16Array(4), 1, 1, library.RGBAFormat, library.HalfFloatType)
    placeholder.mapping = library.EquirectangularReflectionMapping
    placeholder.needsUpdate = true
    const empty = new library.Texture()
    markSpaceSharedTexture(placeholder); markSpaceSharedTexture(empty)
    value = { back: tsl.texture(empty), on: tsl.uniform(0), layer: SPACE_GLASS_LAYER, placeholder,
      environments: new Set(), environmentIntensity: tsl.uniform(0), environmentRotation: tsl.uniform(0) }
    shared.set(library, value)
  }
  return value
}

/**
 * 玻璃节点里引用、但不归作者的贴图（背面纹理、占位图、序列环境）：作者场景按节点遍历登记自己的资源时要跳过它们，
 * 否则最后一个用玻璃的作者场景释放时会把宿主的贴图一起释放。
 */
const sharedTextures = new WeakSet<object>()
export function markSpaceSharedTexture(texture: object | null | undefined): void { if (texture) sharedTextures.add(texture) }
export function isSpaceSharedTexture(texture: object): boolean { return sharedTextures.has(texture) }

/** 路径追踪时要换成的经典材质（只有实时节点版与追踪版不同的材质才登记）。 */
const pathTraceReplacements = new WeakMap<Three.Material, Three.Material>()
const glassMaterials = new WeakSet<Three.Material>()
export function spacePathTraceReplacement(material: Three.Material): Three.Material | undefined { return pathTraceReplacements.get(material) }
export function isSpaceGlassMaterial(material: Three.Material): boolean { return glassMaterials.has(material) }

const unit = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`材质参数 ${name} 要在 0–1 之间。`)
  return value
}
function color(library: Library, value: string | number | undefined, fallback: number, name: string): Three.Color {
  if (value === undefined) return new library.Color(fallback)
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return new library.Color(value)
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return new library.Color(value)
  throw new Error(`材质参数 ${name} 要写成 '#rrggbb' 或 0xrrggbb。`)
}
/** 吸收换成 Beer 定律的衰减距离（世界单位，即显示高度）：吸收 1 时穿过 0.25 个显示高度后剩 tint 的颜色。 */
const attenuationDistance = (absorption: number): number => absorption > 0 ? .25 / absorption : Infinity

/** 薄膜厚度沿 u 方向的色带（g 通道 0–1 映射到膜厚范围）：实时与路径追踪读同一张贴图。 */
function filmThickness(library: Library, frequency: number): Three.DataTexture {
  const width = 512, data = new Uint8Array(width * 4 * 4)
  for (let row = 0; row < 4; row++) for (let x = 0; x < width; x++) {
    const value = Math.round((Math.sin((x + .5) / width * frequency * Math.PI * 2) * .5 + .5) * 255), index = (row * width + x) * 4
    data[index] = data[index + 1] = data[index + 2] = value; data[index + 3] = 255
  }
  const texture = new library.DataTexture(data, width, 4, library.RGBAFormat)
  texture.wrapS = library.RepeatWrapping
  texture.magFilter = texture.minFilter = library.LinearFilter
  texture.needsUpdate = true
  return texture
}

/** 标准材质的预设名（三维读回按它报告作者物体的材质）。 */
const presets = new WeakMap<Three.Material, SpaceMaterialPreset>()
export function spaceMaterialPresetOf(material: Three.Material): SpaceMaterialPreset | undefined { return presets.get(material) }
export function createSpaceMaterial(library: Library, tsl: Tsl, preset: SpaceMaterialPreset, params: SpaceMaterialParams = {}): Three.Material {
  const material = buildSpaceMaterial(library, tsl, preset, params)
  presets.set(material, preset)
  return material
}
function buildSpaceMaterial(library: Library, tsl: Tsl, preset: SpaceMaterialPreset, params: SpaceMaterialParams): Three.Material {
  if (!SPACE_MATERIAL_PRESETS.includes(preset)) throw new Error(`没有材质预设「${String(preset)}」，可用：${SPACE_MATERIAL_PRESETS.join('、')}。`)
  if (params === null || typeof params !== 'object') throw new Error('材质参数要是对象。')
  switch (preset) {
    case 'matte': return new library.MeshPhysicalMaterial({ color: color(library, params.color, 0xd8d8d8, 'color'), roughness: unit(params.roughness, .7, 'roughness'), metalness: 0 })
    case 'metal': return new library.MeshPhysicalMaterial({ color: color(library, params.color, 0xe8e8ea, 'color'), roughness: unit(params.roughness, .25, 'roughness'), metalness: 1 })
    case 'thin-film': {
      const range = params.range ?? [250, 650]
      if (!Array.isArray(range) || range.length !== 2 || !range.every(value => typeof value === 'number' && value >= 0 && value <= 2000) || range[0] > range[1]) throw new Error('薄膜参数 range 要写成 [最薄, 最厚]（纳米，0–2000）。')
      const frequency = params.frequency ?? 3
      if (typeof frequency !== 'number' || !(frequency > 0 && frequency <= 64)) throw new Error('薄膜参数 frequency 要在 0–64 之间。')
      return new library.MeshPhysicalMaterial({ color: color(library, params.color, 0xd0d0d4, 'color'), roughness: unit(params.roughness, .2, 'roughness'), metalness: 1,
        iridescence: unit(params.strength, 1, 'strength'), iridescenceIOR: 1.3, iridescenceThicknessRange: [range[0], range[1]], iridescenceThicknessMap: filmThickness(library, frequency) })
    }
    case 'acrylic': return new library.MeshPhysicalMaterial({ color: color(library, params.tint, 0xffffff, 'tint'), roughness: unit(params.frost, .15, 'frost'), metalness: 0,
      transmission: 1, thickness: .02, ior: 1.49 })
    case 'emissive': {
      const intensity = params.intensity ?? 2
      if (typeof intensity !== 'number' || !(intensity >= 0 && intensity <= 100)) throw new Error('发光体参数 intensity 要在 0–100 之间。')
      return new library.MeshStandardMaterial({ color: 0x000000, emissive: color(library, params.color, 0xffffff, 'color'), emissiveIntensity: intensity, roughness: 1, metalness: 0 })
    }
    case 'glass': return createGlass(library, tsl, params)
  }
}

/**
 * 实心玻璃（实时）：正面折射进入 → 由正面与背面的视深得到穿过的距离 → 在背面出射点按背面法线再折射出去（全反射时按反射）→
 * 在出射方向上取已画好的画面（含下方画面与玻璃身后的一切，磨砂按模糊级）→ 红绿蓝各用一个折射率（色散）→ 按距离吸收。
 * 表面反射、高光交给物理材质本身（菲涅耳、环境与灯光），折射光按 1 − 菲涅耳 叠在自发光通道上。
 */
function createGlass(library: Library, tsl: Tsl, params: SpaceMaterialParams): Three.Material {
  const frost = unit(params.frost, .05, 'frost'), dispersion = unit(params.dispersion, .3, 'dispersion'), absorption = unit(params.absorption, .2, 'absorption')
  const ior = params.ior ?? 1.5
  if (typeof ior !== 'number' || !(ior >= 1 && ior <= 2.5)) throw new Error('玻璃参数 ior 要在 1–2.5 之间。')
  const tint = color(library, params.tint, 0xffffff, 'tint')
  const glass = spaceGlassShared(library, tsl)
  const nodes: Array<TslNode & { value: Three.Texture }> = []
  const Material = (library as unknown as { MeshPhysicalNodeMaterial: new (parameters: Record<string, unknown>) => Three.Material & { colorNode: TslNode; emissiveNode: TslNode } }).MeshPhysicalNodeMaterial
  const material = new Material({ color: 0x000000, roughness: Math.max(.02, frost), metalness: 0, transparent: true, ior, specularIntensity: 1 })
  const coefficient = tsl.vec3(...[tint.r, tint.g, tint.b].map(value => -Math.log(Math.max(value, 1e-3)) / attenuationDistance(absorption)))
  const point = tsl.positionView, normal = tsl.normalView, incoming = point.normalize()
  const frontDepth = point.z.negate()
  const project = (position: TslNode): TslNode => {
    const clip = tsl.cameraProjectionMatrix.mul(tsl.vec4(position, 1))
    return clip.xy.div(clip.w).mul(tsl.vec2(.5, -.5)).add(.5)
  }
  // 一个折射率的整条光路：出射方向上取画面的位置。
  const path = (eta: number): { uv: TslNode; distance: TslNode; leaving: TslNode; internal: TslNode } => {
    const inside = tsl.refract(incoming, normal, 1 / eta)
    const back = glass.back.sample(tsl.screenUV)
    const across = tsl.select(glass.on.greaterThan(.5).and(back.a.greaterThan(frontDepth)), back.a.sub(frontDepth), tsl.float(.1))
    const distance = across.div(tsl.max(inside.z.negate(), .3))
    const exit = point.add(inside.mul(distance))
    const exitBack = glass.back.sample(project(exit))
    const rawNormal = tsl.select(glass.on.greaterThan(.5).and(exitBack.a.greaterThan(0)), exitBack.rgb.normalize(), normal.negate())
    const outward = tsl.select(rawNormal.dot(inside).greaterThan(0), rawNormal, rawNormal.negate())
    const refracted = tsl.refract(inside, outward.negate(), eta)
    const internal = refracted.length().lessThan(1e-4)
    const leaving = tsl.select(internal, tsl.reflect(inside, outward.negate()), refracted)
    // 出射后再走一段（与穿过的距离同量级）才落到身后的画面上：屏幕空间近似，偏移随厚度变化。
    return { uv: project(exit.add(leaving.mul(across.add(.05)))), distance, leaving, internal }
  }
  // 环境里沿某方向（视空间）的光：换到世界方向，按场景环境的水平旋转转过去，磨砂按粗糙度取模糊级。
  const environment = (direction: TslNode): TslNode => {
    const world = tsl.cameraWorldMatrix.mul(tsl.vec4(direction, 0)).xyz
    const angle = glass.environmentRotation, cosine = tsl.cos(angle), sine = tsl.sin(angle)
    const turned = tsl.vec3(world.x.mul(cosine).add(world.z.mul(sine)), world.y, world.z.mul(cosine).sub(world.x.mul(sine)))
    // 每次取样各是一个预滤波环境节点（方向不同）；渲染器换环境时逐个改它们的贴图。
    const node = tsl.pmremTexture(glass.placeholder, turned, Math.max(.02, frost))
    glass.environments.add(node)
    nodes.push(node)
    return node.rgb.mul(glass.environmentIntensity)
  }
  const spread = dispersion * .04
  const lod = tsl.log2(tsl.screenSize.x).mul(frost * frost * 1.5)
  const channel = (eta: number, pick: (sample: TslNode) => TslNode): { value: TslNode; distance: TslNode } => {
    const { uv, distance, leaving, internal } = path(eta)
    // 全反射、或出射点落在画面外：屏幕上没有那里的画面，改取环境（与路径追踪里的光线看到的一致）。
    const outside = uv.x.lessThan(0).or(uv.x.greaterThan(1)).or(uv.y.lessThan(0)).or(uv.y.greaterThan(1))
    const screen = pick(tsl.textureBicubicLevel(tsl.viewportOpaqueMipTexture(uv), lod))
    return { value: tsl.select(internal.or(outside), pick(environment(leaving)), screen), distance }
  }
  const red = channel(ior - spread, sample => sample.r), green = channel(ior, sample => sample.g), blue = channel(ior + spread, sample => sample.b)
  const transmitted = tsl.vec3(red.value, green.value, blue.value).mul(tsl.exp(coefficient.mul(green.distance).negate()))
  // 菲涅耳（Schlick）：掠射处反射多、透过少，与物理材质自己算的反射互补。
  const f0 = ((ior - 1) / (ior + 1)) ** 2
  const cosine = tsl.max(normal.dot(incoming.negate()), 0)
  const fresnel = tsl.float(f0).add(tsl.float(1 - f0).mul(tsl.pow(tsl.float(1).sub(cosine), 5)))
  material.colorNode = tsl.vec4(0, 0, 0, 1)
  material.emissiveNode = transmitted.mul(tsl.float(1).sub(fresnel)).mul(tsl.vec3(tint.r, tint.g, tint.b).add(tsl.vec3(1)).mul(.5).pow(tsl.float(absorption > 0 ? 0 : 1)))
  glassMaterials.add(material)
  const traced = new library.MeshPhysicalMaterial({ color: 0xffffff, roughness: frost, metalness: 0, transmission: 1, thickness: .1, ior,
    dispersion: dispersion * 5, attenuationColor: tint, attenuationDistance: attenuationDistance(absorption) })
  pathTraceReplacements.set(material, traced)
  material.addEventListener('dispose', () => { traced.dispose(); pathTraceReplacements.delete(material); for (const node of nodes) glass.environments.delete(node) })
  return material
}
