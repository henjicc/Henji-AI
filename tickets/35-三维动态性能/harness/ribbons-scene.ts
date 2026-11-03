// ticket 35 质感样片「光带」：一束彩虹光泽的金属丝带从顶部标题下方涌出，向两边展开、朝镜头铺开，光沿丝带往下流。
// 丝带是一张合并的网格（每条一段扁平带子），彩虹来自薄膜干涉（iridescence）对彩色摄影棚环境的反射。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'
import { attribute, float, mix, pow, sin, smoothstep, time, uv, vec3 } from 'three/tsl'

const RIBBONS = 340, SEGMENTS = 220

function studio(): THREE.DataTexture {
  const width = 1024, height = 512, data = new Float32Array(width * height * 4)
  const lights: Array<{ u: number; v: number; w: number; h: number; color: [number, number, number] }> = [
    { u: .5, v: .15, w: .5, h: .12, color: [5, 4.4, 3.4] },
    { u: .1, v: .45, w: .04, h: .3, color: [6, 2.4, .5] },
    { u: .3, v: .5, w: .03, h: .35, color: [.6, 2.4, 6] },
    { u: .62, v: .45, w: .03, h: .35, color: [5, .8, 4] },
    { u: .8, v: .5, w: .05, h: .3, color: [4.5, 4.2, 3.6] },
    { u: .95, v: .4, w: .03, h: .3, color: [1, 4, 3] },
  ]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, i = (y * width + x) * 4
    let r = .01, g = .008, b = .006
    for (const s of lights) {
      const du = Math.min(Math.abs(u - s.u), 1 - Math.abs(u - s.u)) / s.w, dv = Math.abs(v - s.v) / s.h
      const k = Math.max(0, 1 - Math.max(du, dv) ** 2) ** 2
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

// 可重复的伪随机。
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
}

function ribbons(): THREE.BufferGeometry {
  const next = random(7)
  const positions: number[] = [], uvs: number[] = [], seeds: number[] = [], indices: number[] = []
  const point = new THREE.Vector3(), ahead = new THREE.Vector3(), tangent = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1)
  for (let r = 0; r < RIBBONS; r++) {
    // 展开系数：中间的几乎直落，两边的甩得最开；偏中间的更多，束子才密。
    const lane = (next() * 2 - 1), spread = Math.sign(lane) * Math.pow(Math.abs(lane), .8)
    const seed = next(), width = .0025 + next() * .0075, twist = (next() - .5) * 2.4, depth = (next() - .5) * .12
    const path = (s: number, out: THREE.Vector3) => out.set(
      spread * (.06 + 2.4 * Math.pow(s, 2.2)) + Math.sin(s * 3 + seed * 6) * .01,
      .33 - s * 1.35 + Math.pow(s, 2) * .2,
      -1.9 + depth + 1.5 * Math.pow(s, 1.6))
    const base = positions.length / 3
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS
      path(s, point); path(Math.min(1, s + 1e-3), ahead)
      tangent.subVectors(ahead, point).normalize()
      // 带子宽度方向：先取与路径和朝向都垂直的方向，再沿路径扭一点，反光才一段段变化。
      side.crossVectors(tangent, up).normalize().applyAxisAngle(tangent, twist * s + seed)
      // 顶端收细，末端早已出画。
      const w = width * (.3 + s * 1.2)
      positions.push(point.x - side.x * w, point.y - side.y * w, point.z - side.z * w, point.x + side.x * w, point.y + side.y * w, point.z + side.z * w)
      uvs.push(0, s, 1, s); seeds.push(seed, seed)
      if (i < SEGMENTS) { const a = base + i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export default {
  name: '光带', width: 1920, height: 1080, durationSeconds: 10,
  createThree() {
    const scene = new THREE.Scene()
    const seed = attribute('seed', 'float'), along = uv().y
    const material = new THREE.MeshPhysicalNodeMaterial({
      color: 0xffffff, metalness: 1, roughness: .16, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [150, 900],
      envMap: studio(), envMapIntensity: 1, side: THREE.DoubleSide,
    })
    // 每条带子底色略有冷暖差别。
    material.colorNode = mix(vec3(1, .86, .62), vec3(.85, .9, 1), seed)
    // 薄膜厚度沿带子变化：同一条带子上颜色一段段变，像全息膜。
    material.iridescenceThicknessNode = mix(float(180), float(950), sin(along.mul(9).add(seed.mul(25))).mul(.5).add(.5))
    // 自发光：越靠近顶部的光源越亮；一段段亮光沿带子往下流（每条带子相位不同）。
    const source = pow(float(1).sub(along), 9).mul(2.6)
    // 两头渐隐的光斑（正弦尖峰），不留硬切的末端。
    const flow = pow(sin(along.mul(3.4).sub(time.mul(.9)).add(seed.mul(40))).mul(.5).add(.5), 18).mul(smoothstep(0, .15, along)).mul(.9)
    const shimmer = sin(along.mul(40).add(seed.mul(30)).sub(time.mul(2))).mul(.5).add(.5)
    material.emissiveNode = vec3(1, .8, .55).mul(source.add(flow.mul(shimmer.mul(.6).add(.4))))
    const bundle = new THREE.Mesh(ribbons(), material)
    scene.add(bundle)
    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      const t = info.time
      bundle.rotation.y = Math.sin(t * .25) * .06
      bundle.position.z = Math.sin(t * .2) * .03
    } }
  },
}
