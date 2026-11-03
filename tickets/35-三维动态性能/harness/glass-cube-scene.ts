// ticket 35 质感样片「玻璃方块」：实心玻璃方块在黑底上旋转。
// 实时透射只能透出屏幕上画在后面的东西（黑底 → 显得空心），所以在着色器里逐像素追踪光线穿过实心方块：
// 前表面折射进去 → 内壁折射出去（太斜则全反射再走一段）→ 按磨砂程度模糊采样彩色摄影棚环境；
// 红绿蓝三色各用自己的折射率，色散是真的分光。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { smoothstep, abs, cameraPosition, dot, exp, float, max, min, mix, modelWorldMatrix, modelWorldMatrixInverse, normalLocal, normalize, pmremTexture, positionLocal, pow, reflect, refract, select, step, vec3, vec4 } from 'three/tsl'

type Node = ReturnType<typeof vec3>
const HALF = .25, FROST = .09, IOR: [number, number, number] = [1.46, 1.5, 1.55]

// 黑色摄影棚：几块大的彩色柔光（琥珀、品红、钴蓝）与白色条灯，玻璃体内的彩色全来自它们。
function studio(): THREE.DataTexture {
  const width = 2048, height = 1024, data = new Float32Array(width * height * 4)
  const lights: Array<{ u: number; v: number; w: number; h: number; color: [number, number, number] }> = [
    { u: .05, v: .45, w: .018, h: .3, color: [7, 2.6, .5] },
    { u: .2, v: .24, w: .12, h: .02, color: [6, 6, 6.6] },
    { u: .36, v: .6, w: .025, h: .32, color: [.5, 1.8, 7] },
    { u: .55, v: .42, w: .015, h: .36, color: [6.5, .7, 4.4] },
    { u: .7, v: .55, w: .04, h: .15, color: [7, 3.6, .8] },
    { u: .84, v: .35, w: .012, h: .4, color: [5.5, 5.8, 6.6] },
    { u: .62, v: .82, w: .2, h: .02, color: [1.6, .8, 3.2] },
    { u: .95, v: .7, w: .03, h: .12, color: [.6, 3, 5] },
  ]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, i = (y * width + x) * 4
    let r = .003, g = .003, b = .005
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

// 方块内部从 p 沿 d 走到内壁：返回出射点、出射面外法线与走过的长度。
function exitBox(p: Node, d: Node): { point: Node; normal: Node; length: ReturnType<typeof float> } {
  const sign = step(vec3(0), d).mul(2).sub(1)
  const t = sign.mul(HALF).sub(p).div(d.add(sign.mul(1e-5)))
  const length = min(t.x, min(t.y, t.z))
  const normal = normalize(vec3(step(t.x, length).mul(sign.x), step(t.y, length).mul(sign.y), step(t.z, length).mul(sign.z)))
  return { point: p.add(d.mul(length)), normal, length }
}

// 一种颜色的光线穿过实心方块后的出射方向（方块局部坐标）与在玻璃里走过的长度。
function traverse(p: Node, view: Node, n: Node, ior: number): { direction: Node; length: ReturnType<typeof float>; exit: Node } {
  const inside = refract(view, n, 1 / ior)
  const first = exitBox(p, inside)
  const out = refract(inside, first.normal.negate(), ior)
  const trapped = dot(out, out).lessThan(1e-4)
  // 全反射：在内壁弹一次再出去（第二次仍出不去就按反射方向取）。
  const bounced = reflect(inside, first.normal)
  const second = exitBox(first.point.add(bounced.mul(1e-4)), bounced)
  const out2 = refract(bounced, second.normal.negate(), ior)
  const escaped = select(dot(out2, out2).lessThan(1e-4), reflect(bounced, second.normal), out2)
  return { direction: select(trapped, escaped, out), length: select(trapped, first.length.add(second.length), first.length), exit: first.point }
}

export default {
  name: '玻璃方块', width: 1920, height: 1080, durationSeconds: 10,
  createThree() {
    const scene = new THREE.Scene()
    const environment = studio()
    const toWorld = (d: Node) => normalize(modelWorldMatrix.mul(vec4(d, 0)).xyz)
    const sample = (d: Node, blur: number | ReturnType<typeof float>) => pmremTexture(environment, toWorld(d), float(blur)).rgb

    const p = positionLocal, n = normalize(normalLocal)
    const eye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz
    const view = normalize(p.sub(eye))
    // 三种颜色各追一次：色散让不同颜色从不同方向出来，棱角处分出彩虹边。
    const channels = IOR.map(ior => traverse(p, view, n, ior))
    const body = vec3(sample(channels[0].direction, FROST).r, sample(channels[1].direction, FROST).g, sample(channels[2].direction, FROST).b)
    // 体积感：在玻璃里走得越长越暗、略偏冷，厚的地方显得“实”。
    const travelled = channels[1].length
    const absorbed = body.mul(exp(travelled.mul(-1.1))).mul(vec3(.96, .98, 1))
    // 前表面：菲涅耳反射（掠射角更亮），磨砂比体内轻一些。
    const cos = max(dot(view.negate(), n), 0)
    const fresnel = float(.04).add(float(.96).mul(pow(float(1).sub(cos), 5)))
    const reflected = sample(reflect(view, n), FROST * .3)
    // 透过前面看到的后侧棱边：出射点靠近方块的棱（另外两个坐标里次大的也贴近边界）时，圆角内壁会把光聚成一道亮线。
    const q = abs(channels[1].exit).div(HALF)
    const middle = q.x.add(q.y).add(q.z).sub(max(q.x, max(q.y, q.z))).sub(min(q.x, min(q.y, q.z)))
    const edge = smoothstep(.88, .985, middle)
    const edgeLight = sample(channels[1].direction, .04).mul(1.8).add(vec3(.035, .035, .045)).mul(edge)
    const color = mix(absorbed.add(edgeLight), reflected, fresnel)

    const material = new THREE.MeshBasicNodeMaterial()
    material.colorNode = vec4(color, 1)
    const cube = new THREE.Mesh(new RoundedBoxGeometry(HALF * 2, HALF * 2, HALF * 2, 12, .06), material)
    cube.position.set(0, 0, -1.6)
    scene.add(cube)
    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      const t = info.time
      cube.rotation.set(.62 + Math.sin(t * .45) * .18, t * .5, .2 + Math.cos(t * .3) * .08)
      cube.position.y = Math.sin(t * .8) * .012
    } }
  },
}
