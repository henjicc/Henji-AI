// ticket 35 质感样片「玻璃方块」：圆角玻璃方块在黑底上旋转。透射 + 色散出彩虹边，彩色柔光箱环境给内部反光。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// 黑色摄影棚里几条亮的柔光条（暖橙、品红、青蓝、白），玻璃的反射与折射全靠它们出彩。
function studio(): THREE.DataTexture {
  const width = 2048, height = 1024, data = new Float32Array(width * height * 4)
  const strips: Array<{ u: number; v: number; w: number; h: number; color: [number, number, number] }> = [
    { u: .08, v: .42, w: .035, h: .32, color: [6, 2.2, .5] },
    { u: .3, v: .2, w: .12, h: .035, color: [2.4, 2.4, 2.7] },
    { u: .52, v: .5, w: .03, h: .4, color: [4.5, .6, 3.2] },
    { u: .7, v: .35, w: .05, h: .25, color: [.5, 2.2, 6] },
    { u: .88, v: .6, w: .025, h: .3, color: [6, 3.5, 1] },
    { u: .62, v: .08, w: .3, h: .03, color: [2.5, 2.8, 3.5] },
  ]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, i = (y * width + x) * 4
    let r = .004, g = .004, b = .006
    for (const s of strips) {
      const du = Math.min(Math.abs(u - s.u), 1 - Math.abs(u - s.u)) / s.w, dv = Math.abs(v - s.v) / s.h
      // 边缘柔和衰减：硬边在光滑玻璃上会反射出锯齿。
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

export default {
  name: '玻璃方块', width: 1920, height: 1080, durationSeconds: 10,
  createThree() {
    const scene = new THREE.Scene()
    const environment = studio()
    const glass = new THREE.MeshPhysicalNodeMaterial({
      color: 0xffffff, metalness: 0, roughness: .03, transmission: 1, thickness: .45, ior: 1.52, dispersion: 7,
      iridescence: .55, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 620], clearcoat: 1, clearcoatRoughness: .02,
      envMap: environment, envMapIntensity: 1.6, side: THREE.DoubleSide,
    })
    const cube = new THREE.Mesh(new RoundedBoxGeometry(.5, .5, .5, 10, .05), glass)
    cube.position.set(0, 0, -1.6)
    scene.add(cube)
    // 两盏小灯打出棱边高光。
    const key = new THREE.PointLight(0xffffff, 6, 4), rim = new THREE.PointLight(0xff4fd8, 4, 4)
    key.position.set(.7, .8, -.9); rim.position.set(-.8, -.3, -1.2)
    scene.add(key, rim)
    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      const t = info.time
      cube.rotation.set(.62 + Math.sin(t * .45) * .18, t * .55, .2 + Math.cos(t * .3) * .08)
      cube.position.y = Math.sin(t * .8) * .012
    } }
  },
}
