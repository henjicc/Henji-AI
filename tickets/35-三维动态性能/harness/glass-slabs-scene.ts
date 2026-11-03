// ticket 36 质感样片「三块磨砂玻璃」：三块圆角磨砂玻璃板上下叠放、斜俯视，缓慢转动并错开浮动。
// 只用经典材质参数（透射、粗糙度、厚度、吸收颜色）：实时与路径追踪读同一份材质。蓝色的光来自板子下面的一块发光面和蓝调环境。
// 世界单位 = 显示高度。
import * as THREE from 'three/webgpu'

const SIZE = .5, THICK = .03, GAP = .2

// 暗底蓝调摄影棚：顶上一块冷白柔光（玻璃边缘的亮线），下方大片蓝光（透过磨砂玻璃的辉光），亮度连续衰减。
function studio(): THREE.DataTexture {
  const width = 1024, height = 512, data = new Float32Array(width * height * 4)
  const lights: Array<{ u: number; v: number; w: number; h: number; color: [number, number, number] }> = [
    { u: .5, v: .08, w: .3, h: .06, color: [6, 6.5, 8] },
    { u: .25, v: .35, w: .05, h: .1, color: [4, 4.6, 6] },
    { u: .75, v: .4, w: .05, h: .1, color: [.6, .9, 2.4] },
    { u: .5, v: .85, w: .5, h: .12, color: [.15, .35, 1.6] },
  ]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, i = (y * width + x) * 4
    let r = .002, g = .003, b = .008
    for (const s of lights) {
      const du = Math.min(Math.abs(u - s.u), 1 - Math.abs(u - s.u)) / s.w, dv = Math.abs(v - s.v) / s.h
      const k = Math.exp(-(du * du + dv * dv) * 2)
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

// 圆角方板：平面上大圆角，厚度方向一圈小倒角（边缘的亮线就是倒角反出来的光）。
function slab(): THREE.BufferGeometry {
  const half = SIZE / 2, radius = .085, bevel = .007, inner = half - bevel, shape = new THREE.Shape()
  shape.moveTo(-inner + radius, -inner)
  shape.lineTo(inner - radius, -inner); shape.quadraticCurveTo(inner, -inner, inner, -inner + radius)
  shape.lineTo(inner, inner - radius); shape.quadraticCurveTo(inner, inner, inner - radius, inner)
  shape.lineTo(-inner + radius, inner); shape.quadraticCurveTo(-inner, inner, -inner, inner - radius)
  shape.lineTo(-inner, -inner + radius); shape.quadraticCurveTo(-inner, -inner, -inner + radius, -inner)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: THICK - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 16 })
  geometry.translate(0, 0, -(THICK - 2 * bevel) / 2)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

// 中心亮、向外柔和衰减的圆斑（发光与透明度共用），辉光不出硬边。
function radial(): THREE.DataTexture {
  const size = 128, data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1, value = Math.round(255 * Math.exp(-(dx * dx + dy * dy) * 4.5)), i = (y * size + x) * 4
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.magFilter = texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

// 三块板：上面一块深蓝、中间一块近白、下面一块浅蓝；越往上吸收越强（颜色越深）。
const SLABS: Array<{ color: number; attenuation: number; distance: number; roughness: number }> = [
  { color: 0x3a5cff, attenuation: 0x1a36d8, distance: .03, roughness: .5 },
  { color: 0xeef3ff, attenuation: 0xd0dcff, distance: .25, roughness: .6 },
  { color: 0xa8c6ff, attenuation: 0x6a96ff, distance: .08, roughness: .55 },
]

export default {
  name: '三块磨砂玻璃', width: 1920, height: 1080, durationSeconds: 10,
  createThree() {
    const scene = new THREE.Scene()
    scene.environment = studio()
    const stack = new THREE.Group()
    stack.position.set(0, .02, -1.5)
    scene.add(stack)
    const geometry = slab()
    const slabs = SLABS.map((value, index) => {
      const material = new THREE.MeshPhysicalMaterial({
        color: value.color, metalness: 0, roughness: value.roughness, transmission: 1, thickness: THICK, ior: 1.5,
        attenuationColor: new THREE.Color(value.attenuation), attenuationDistance: value.distance,
        specularIntensity: 1, clearcoat: .3, clearcoatRoughness: .2,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.y = (1 - index) * GAP
      stack.add(mesh)
      return mesh
    })
    // 板子下面的蓝色发光面：透过三层磨砂玻璃成为柔和的辉光，也从下方照亮板子的边。
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 1.3, SIZE * 1.3), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(.22, .42, 1), emissiveIntensity: 2.2, emissiveMap: radial(), transparent: true, alphaMap: radial(), depthWrite: false }))
    glow.rotation.x = -Math.PI / 2
    glow.position.y = -GAP - .07
    stack.add(glow)
    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      const t = info.time
      // 斜俯视、慢慢转；三块板错开相位上下浮动，间距一张一合。
      stack.rotation.set(.6, Math.PI / 4 + Math.sin(t * .35) * .5, 0)
      slabs.forEach((mesh, index) => {
        mesh.position.y = (1 - index) * GAP * (1 + .25 * Math.sin(t * 1.1)) + Math.sin(t * 1.4 + index * 1.3) * .012
        mesh.rotation.y = Math.sin(t * .7 + index) * .06
      })
    } }
  },
}
