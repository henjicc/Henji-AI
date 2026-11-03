// ticket 35 质感样片「光带」：一束彩虹光泽的金属丝带从顶部标题下方涌出，向两边展开、朝镜头铺开，光沿丝带往下流。
// 丝带是一张合并的网格（每条一段扁平带子），彩虹来自薄膜干涉（iridescence）对彩色摄影棚环境的反射。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'
import { abs, attribute, texture, dot, exp, float, mix, normalize, normalView, positionView, pow, sin, smoothstep, step, time, uv, vec3 } from 'three/tsl'

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
    const seed = next(), width = .004 + next() * .008, twist = (next() - .5) * 2.4, depth = (next() - .5) * .12
    const path = (s: number, out: THREE.Vector3) => out.set(
      // 顶端按位置均匀铺满标题的宽度（光从字的整条下沿涌出），往下再甩开。
      lane * .2 + spread * 2.3 * Math.pow(s, 2.2) + Math.sin(s * 3 + seed * 6) * .01 * s,
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
      // 不能细到不足一个像素：侧对镜头时会闪成虚线。
      const w = width * (.7 + s)
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
    // 薄膜厚度沿带子变化：同一条带子上颜色一段段变，像全息膜。
    material.iridescenceThicknessNode = mix(float(180), float(950), sin(along.mul(9).add(seed.mul(25))).mul(.5).add(.5))
    // 自发光：越靠近顶部的光源越亮；一段段亮光沿带子往下流（每条带子相位不同）。
    const source = pow(float(1).sub(along), 9).mul(1.2)
    // 两头渐隐的光斑（正弦尖峰），不留硬切的末端。
    const flow = pow(sin(along.mul(3.4).sub(time.mul(.9)).add(seed.mul(40))).mul(.5).add(.5), 18).mul(smoothstep(0, .15, along)).mul(.9)
    const shimmer = sin(along.mul(40).add(seed.mul(30)).sub(time.mul(2))).mul(.5).add(.5)
    // 开场光从字底下涌出：光头沿带子往下推进，光头处最亮；推进到画外之后只剩顺着带子往下流的光。
    // 每条带子的光头错开一点，不齐成一条线。
    const head = smoothstep(.8, 3.4, time.sub(seed.mul(.5))).mul(1.25)
    material.opacityNode = step(along, head)
    material.alphaTest = .5
    const front = exp(along.sub(head).div(.035).pow(2).negate()).mul(1.8)
    // 带子侧对镜头时变得很窄、在像素间闪烁，按朝向淡掉。
    const facing = smoothstep(.04, .3, abs(dot(normalView, normalize(positionView).negate())))
    material.colorNode = mix(vec3(1, .86, .62), vec3(.85, .9, 1), seed).mul(facing)
    material.emissiveNode = vec3(1, .8, .55).mul(source.add(flow.mul(shimmer.mul(.6).add(.4))).add(front)).mul(facing)
    const bundle = new THREE.Mesh(ribbons(), material)
    scene.add(bundle)
    // 标题是场景里的发光体（不是时间线上的文字卡片）：卡片是画好的平面画面、自己不发光，淡入时只是一层灰字，
    // 和丝带的光连不到一起。这里把字画进贴图、按高动态亮度自发光，和丝带同一套泛光；字先烧亮，光再从它底下涌出。
    const canvas = new OffscreenCanvas(1024, 256), context = canvas.getContext('2d')!
    context.fillStyle = '#fff'; context.textAlign = 'center'; context.textBaseline = 'middle'
    context.font = '500 250px "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif'
    context.fillText('痕　迹', 512, 140)
    const glyphs = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement)
    glyphs.colorSpace = THREE.SRGBColorSpace
    const ignite = smoothstep(0, 1.1, time)
    const title = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    const glyph = texture(glyphs).r
    // 亮度只略高于泛光阈值：字芯清楚可读，四周再带一圈光晕。
    title.colorNode = vec3(1, .92, .8).mul(ignite.mul(ignite).mul(2.2))
    // 只有笔画处不透明：整块平面不透明会在宿主合成时盖住背景，成一个暗框。
    title.opacityNode = glyph
    const label = new THREE.Mesh(new THREE.PlaneGeometry(.5, .125), title)
    // 字的下沿正好落在丝带顶端。
    label.position.set(0, .33 + .085, -1.88)
    scene.add(label)
    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      void info
    } }
  },
}
