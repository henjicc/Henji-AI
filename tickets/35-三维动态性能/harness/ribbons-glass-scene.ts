// ticket 36 质感样片「玻璃光带」：标题（时间线文字片段，自身发光）下沿长出一束磨砂玻璃丝带，向两边展开、朝镜头铺开。
// 只用经典材质参数（透射、粗糙度、折射率、薄膜干涉、发光贴图），不写着色节点：实时与路径追踪读同一份材质。
// 生长动画改的是真实几何（没长到的段收到光头处），流光是发光贴图的偏移。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'

const RIBBONS = 220, SEGMENTS = 200, COLUMNS = 64

// 柔和的摄影棚：暗底上两块大柔光（暖白顶光、偏冷侧光）和几条细长条灯，亮度连续衰减，反射出来是渐变而不是色块。
function studio(): THREE.DataTexture {
  const width = 1024, height = 512, data = new Float32Array(width * height * 4)
  const lights: Array<{ u: number; v: number; w: number; h: number; color: [number, number, number] }> = [
    { u: .5, v: .12, w: .35, h: .1, color: [3.2, 2.9, 2.5] },
    { u: .15, v: .45, w: .12, h: .25, color: [.9, 1.1, 1.5] },
    { u: .8, v: .42, w: .1, h: .22, color: [1.6, 1.1, .8] },
    { u: .32, v: .5, w: .015, h: .3, color: [2.4, 2.4, 2.6] },
    { u: .66, v: .5, w: .012, h: .32, color: [2.6, 2.3, 2] },
  ]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, i = (y * width + x) * 4
    // 底色：上方略亮的暖灰，往下渐暗。
    const sky = .018 * (1 - v) + .004
    let r = sky * 1.1, g = sky, b = sky * .9
    for (const s of lights) {
      const du = Math.min(Math.abs(u - s.u), 1 - Math.abs(u - s.u)) / s.w, dv = Math.abs(v - s.v) / s.h
      const k = Math.exp(-(du * du + dv * dv) * 2.2)
      r += s.color[0] * k; g += s.color[1] * k; b += s.color[2] * k
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.magFilter = texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

// 流光：每条带子（贴图的一列，按带子的随机数取列）上两段光斑沿带子往下走，相位各不相同；纵向一个周期，偏移动画无缝。
function flowMap(): THREE.DataTexture {
  const height = 256, data = new Uint8Array(COLUMNS * height * 4)
  for (let x = 0; x < COLUMNS; x++) {
    const phase = Math.sin(x * 12.9898) * 43758.5453 % 1
    for (let y = 0; y < height; y++) {
      const v = y / height, wave = .5 + .5 * Math.cos(2 * Math.PI * (2 * v + phase))
      const value = Math.round(255 * Math.min(1, wave ** 60)), i = (y * COLUMNS + x) * 4
      data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, COLUMNS, height, THREE.RGBAFormat)
  texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

// 薄膜厚度：沿带子一段段变化，同一条带子上的虹彩颜色随之变化。
function thicknessMap(): THREE.DataTexture {
  const height = 256, data = new Uint8Array(COLUMNS * height * 4)
  for (let x = 0; x < COLUMNS; x++) for (let y = 0; y < height; y++) {
    const value = Math.round(255 * (.5 + .5 * Math.sin(y / height * 9 + x * .39 * 25))), i = (y * COLUMNS + x) * 4
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255
  }
  const texture = new THREE.DataTexture(data, COLUMNS, height, THREE.RGBAFormat)
  texture.magFilter = texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
}

interface Bundle { geometry: THREE.BufferGeometry; full: Float32Array; seeds: Float32Array }

// 每条带子 SEGMENTS + 1 对顶点；uv.x 是这条带子在贴图里的列（各带子取不同的流光相位与薄膜厚度），uv.y 是沿带子的位置。
function ribbons(starts: readonly THREE.Vector3[]): Bundle {
  const next = random(7)
  const xs = starts.map(point => point.x), center = (Math.min(...xs) + Math.max(...xs)) / 2, half = Math.max(.05, (Math.max(...xs) - Math.min(...xs)) / 2)
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], seeds: number[] = []
  const point = new THREE.Vector3(), ahead = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1)
  for (let r = 0; r < RIBBONS; r++) {
    const start = starts[Math.floor(next() * starts.length)]
    // 展开方向跟着起点在标题里的左右位置走：左边的笔画往左甩，右边的往右甩，中间的几乎直落。
    const lane = (start.x - center) / half + (next() - .5) * .25, spread = Math.sign(lane) * Math.pow(Math.min(1.2, Math.abs(lane)), .8)
    const seed = next(), width = .005 + next() * .011, twist = (next() - .5) * 2.4, depth = (next() - .5) * .12
    const column = (Math.floor(seed * COLUMNS) + .5) / COLUMNS
    const path = (s: number, out: THREE.Vector3) => out.set(
      start.x + spread * 2.3 * Math.pow(s, 2.2) + Math.sin(s * 3 + seed * 6) * .01 * s,
      start.y - s * 1.42 + Math.pow(s, 2) * .2,
      start.z + depth * s + 1.5 * Math.pow(s, 1.6))
    const base = positions.length / 3
    seeds.push(seed)
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS
      path(s, point); path(Math.min(1, s + 1e-3), ahead)
      tangent.subVectors(ahead, point).normalize()
      // 带子宽度方向沿路径扭一点，反光才一段段变化；起点和笔画差不多粗，越往外越宽。
      side.crossVectors(tangent, up).normalize().applyAxisAngle(tangent, twist * s + seed)
      const w = width * (.6 + s * 1.1)
      positions.push(point.x - side.x * w, point.y - side.y * w, point.z - side.z * w, point.x + side.x * w, point.y + side.y * w, point.z + side.z * w)
      uvs.push(column, s, column, s)
      if (i < SEGMENTS) { const a = base + i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    }
  }
  const geometry = new THREE.BufferGeometry()
  const full = new Float32Array(positions)
  geometry.setAttribute('position', new THREE.BufferAttribute(full.slice(), 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  // 法线按长全的形状算一次，生长时收起的段沿用。
  const shape = new THREE.BufferGeometry(); shape.setAttribute('position', new THREE.BufferAttribute(full, 3)); shape.setIndex(indices); shape.computeVertexNormals()
  geometry.setAttribute('normal', shape.getAttribute('normal'))
  return { geometry, full, seeds: new Float32Array(seeds) }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// 生长：每条带子的光头沿带子往下推进（各带子错开一点），光头之后的段收到光头处，不画。
function grow(bundle: Bundle, time: number): boolean {
  const positions = bundle.geometry.getAttribute('position') as THREE.BufferAttribute, out = positions.array as Float32Array, full = bundle.full
  const stride = (SEGMENTS + 1) * 6
  let complete = true
  for (let r = 0; r < bundle.seeds.length; r++) {
    const head = smooth(.6, 3.2, time - bundle.seeds[r] * .5) * SEGMENTS
    if (head < SEGMENTS) complete = false
    const cut = Math.floor(head), t = head - cut, base = r * stride
    for (let i = 0; i <= SEGMENTS; i++) for (let k = 0; k < 6; k++) {
      const at = base + i * 6 + k
      out[at] = i <= cut ? full[at] : cut < SEGMENTS ? full[base + cut * 6 + k] + (full[base + (cut + 1) * 6 + k] - full[base + cut * 6 + k]) * t : full[at]
    }
  }
  positions.needsUpdate = true
  return complete
}

export default {
  name: '玻璃光带', width: 1920, height: 1080, durationSeconds: 10,
  params: [{ key: 'title', type: 'image', title: '光源文字' }],
  createThree() {
    const scene = new THREE.Scene()
    scene.environment = studio()
    const flow = flowMap()
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: .06, transmission: 1, thickness: .03, ior: 1.5, dispersion: .6,
      attenuationColor: new THREE.Color(1, .62, .3), attenuationDistance: .06,
      iridescence: .7, iridescenceIOR: 1.4, iridescenceThicknessRange: [200, 800], iridescenceThicknessMap: thicknessMap(),
      emissive: new THREE.Color(1, .78, .5), emissiveMap: flow, emissiveIntensity: 1.6,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
    mesh.frustumCulled = false
    // 标题还没显出来（淡入前）时没有外沿点，先不画。
    mesh.visible = false
    scene.add(mesh)
    let bundle: Bundle | undefined, signature = '', grown = false
    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number; elements?: Record<string, { edge(side: 'bottom', spacing?: number): Array<{ x: number; y: number; z: number }> } | null> }) {
      const edge = info.elements?.title?.edge('bottom', .003) ?? []
      // 丝带放在字后面一点（远离镜头），字始终压在光上。
      const starts = edge.map(point => new THREE.Vector3(point.x, point.y, point.z - .012))
      const key = starts.length ? `${starts.length}:${starts[0].toArray().map(v => v.toFixed(4))}:${starts[starts.length - 1].toArray().map(v => v.toFixed(4))}` : ''
      if (key !== signature) {
        signature = key
        mesh.geometry.dispose()
        bundle = starts.length ? ribbons(starts) : undefined
        mesh.geometry = bundle?.geometry ?? new THREE.BufferGeometry()
        mesh.visible = !!bundle
        material.needsUpdate = true
        grown = false
      }
      // 往回拖到生长阶段时重新收起；长全之后不再改几何。
      if (bundle && (info.time < 3.8 || !grown)) grown = grow(bundle, info.time)
      // 流光沿带子往下走。
      flow.offset.y = info.time * .35
    } }
  },
}
