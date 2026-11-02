// ticket 35 复杂测试样片的作者场景：贴近日常的“偏复杂”三维——反射地面、带阴影的平行光、两盏运动彩色点光、
// 程序化环境图、金属/清漆/透明物体与挤出体、2 万个确定性运动的发光粒子。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'

const PARTICLES = 20000

function skyTexture(): THREE.DataTexture {
  const width = 256, height = 128, data = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = y / (height - 1), u = x / width, i = (y * width + x) * 4
    const horizon = Math.exp(-((v - .5) ** 2) * 60)
    // 上方冷色、地平线暖光带、一块偏左的强光（给反射与玻璃一个亮点）。
    const spot = Math.exp(-(((u - .3) * 6) ** 2 + ((v - .72) * 10) ** 2)) * 12
    data[i] = .04 + .5 * horizon + spot; data[i + 1] = .05 + .32 * horizon + spot * .95; data[i + 2] = .09 + .18 * horizon + spot * .9; data[i + 3] = 1
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.needsUpdate = true
  return texture
}

export default {
  name: '三维复杂测试样片', width: 1920, height: 1080, durationSeconds: 10,
  createThree() {
    const scene = new THREE.Scene()
    scene.environment = skyTexture()
    scene.environmentIntensity = .25

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardNodeMaterial({ color: 0x101216, roughness: .32, metalness: .4 }))
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.62; floor.receiveShadow = true
    scene.add(floor)

    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6)
    sun.position.set(1.4, 2.2, 1.6); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: .1, far: 8 })
    scene.add(sun, sun.target)
    const warm = new THREE.PointLight(0xff8a3d, 3, 3), cool = new THREE.PointLight(0x4fa8ff, 3, 3)
    scene.add(warm, cool)

    const objects = [
      new THREE.Mesh(new THREE.SphereGeometry(.16, 64, 32), new THREE.MeshStandardNodeMaterial({ color: 0xd4a14a, roughness: .18, metalness: 1 })),
      new THREE.Mesh(new THREE.TorusKnotGeometry(.11, .035, 200, 24), new THREE.MeshPhysicalNodeMaterial({ color: 0xb8202a, roughness: .3, clearcoat: 1, clearcoatRoughness: .05 })),
      new THREE.Mesh(new THREE.BoxGeometry(.22, .22, .22), new THREE.MeshPhysicalNodeMaterial({ color: 0xbfe3ff, roughness: .05, transmission: .9, thickness: .2, transparent: true, opacity: .55 })),
      new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .4, 48), new THREE.MeshStandardNodeMaterial({ color: 0xe8e8e8, roughness: .45, metalness: .1 })),
    ]
    objects.forEach((mesh, index) => { mesh.castShadow = true; mesh.receiveShadow = true; mesh.position.set(-.9 + index * .6, -.45, -.9 - (index % 2) * .35); scene.add(mesh) })

    // 粒子：小二十面体实例，自发光加法混合；位置只由时间与编号决定（确定性）。
    const particles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.0022, 0),
      new THREE.MeshBasicNodeMaterial({ color: 0x9fd8ff, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }), PARTICLES)
    particles.frustumCulled = false
    scene.add(particles)
    const matrix = new THREE.Matrix4()
    const seeds = Float32Array.from({ length: PARTICLES * 4 }, (_, i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) })

    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      const t = info.time
      warm.position.set(Math.cos(t * .9) * .9, -.25, Math.sin(t * .9) * .4 - 1)
      cool.position.set(Math.cos(t * .9 + Math.PI) * .9, -.1, Math.sin(t * .9 + Math.PI) * .4 - 1)
      objects.forEach((mesh, index) => { mesh.rotation.set(t * (.3 + index * .1), t * (.5 + index * .07), 0); mesh.position.y = -.45 + Math.sin(t * 1.3 + index) * .04 })
      for (let i = 0; i < PARTICLES; i++) {
        const a = seeds[i * 4] * Math.PI * 2 + t * (.15 + seeds[i * 4 + 1] * .35), r = .3 + seeds[i * 4 + 2] * 1.6
        const y = -.55 + ((seeds[i * 4 + 3] + t * .04 * (.5 + seeds[i * 4 + 1])) % 1) * 1.4
        matrix.makeTranslation(Math.cos(a) * r * 1.4, y, Math.sin(a) * r * .5 - 1.4)
        particles.setMatrixAt(i, matrix)
      }
      particles.instanceMatrix.needsUpdate = true
    } }
  },
}
