// ticket 35 展示与验收样片：发光粒子星系漩涡 + 能量核心 + 金属环 + 漂浮晶体 + 星空。
// 粒子位置全在显卡上按编号与宿主时间算（确定性），一次绘制。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'
import { Fn, instanceIndex, float, vec2, vec3, vec4, sin, cos, fract, mix, uv, time, smoothstep, length, pow, hash, uniform } from 'three/tsl'

const GALAXY = 60000
const STARS = 8000

function softDot(colorNode: ReturnType<typeof vec3>, strength = 1) {
  // 圆形软边光点：中心亮、边缘平滑衰减，加法混合叠出发光感。
  const d = length(uv().sub(.5)).mul(2)
  const falloff = pow(smoothstep(1, 0, d), 2.2)
  return vec4(colorNode.mul(falloff).mul(strength), falloff)
}

export default {
  name: '三维展示样片', width: 1920, height: 1080, durationSeconds: 8,
  createThree() {
    const scene = new THREE.Scene()
    const root = new THREE.Group()
    root.position.set(0, .02, -1.5)
    root.rotation.x = -.42
    root.scale.setScalar(1.7)
    scene.add(root)

    // 星系：对数螺旋两条旋臂，内快外慢地转，核心偏橙、外围偏蓝紫。
    const galaxy = new THREE.Sprite(new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    galaxy.count = GALAXY
    const material = galaxy.material as THREE.PointsNodeMaterial
    const seed = Fn(() => vec3(hash(instanceIndex), hash(instanceIndex.add(17111)), hash(instanceIndex.add(39187))))()
    const radius = pow(seed.x, 1.6).mul(1.1).add(.03)
    const arm = float(instanceIndex.mod(2)).mul(Math.PI)
    const swirl = radius.mul(5.2)
    const spin = time.mul(float(.35).div(radius.add(.25)))
    const angle = arm.add(swirl).add(spin).add(seed.y.sub(.5).mul(float(1.1).mul(radius.add(.15))))
    const thickness = seed.z.sub(.5).mul(float(.08).mul(float(1).sub(radius.div(1.2))).add(.01))
    material.positionNode = vec3(cos(angle).mul(radius), thickness, sin(angle).mul(radius))
    const core = vec3(1, .62, .25), outer = vec3(.32, .55, 1), rim = vec3(.75, .35, 1)
    const tint = mix(mix(core, outer, smoothstep(.05, .55, radius)), rim, smoothstep(.6, 1.1, radius).mul(seed.y))
    const twinkle = sin(time.mul(3).add(seed.z.mul(40))).mul(.25).add(.85)
    material.colorNode = softDot(tint.mul(twinkle), 2.2)
    material.sizeNode = mix(float(.03), float(.009), smoothstep(0, 1, radius)).mul(seed.x.mul(.8).add(.6))
    material.sizeAttenuation = true
    root.add(galaxy)

    // 星空背景。
    const stars = new THREE.Sprite(new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    stars.count = STARS
    const starMaterial = stars.material as THREE.PointsNodeMaterial
    const s = Fn(() => vec3(hash(instanceIndex.add(5)), hash(instanceIndex.add(9001)), hash(instanceIndex.add(77777))))()
    starMaterial.positionNode = vec3(s.x.sub(.5).mul(7), s.y.sub(.5).mul(4), s.z.mul(-2).sub(2.2))
    starMaterial.colorNode = softDot(vec3(.8, .85, 1).mul(sin(time.mul(2).add(s.x.mul(90))).mul(.3).add(.7)), 1.3)
    starMaterial.sizeNode = s.z.mul(.02).add(.008)
    scene.add(stars)

    // 能量核心：自发光球 + 一圈脉动的光晕粒子。
    const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(.06, 64, 32), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(1.6, 1.05, .55) }))
    root.add(coreMesh)
    const halo = new THREE.Sprite(new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.count = 1
    const haloMaterial = halo.material as THREE.PointsNodeMaterial
    haloMaterial.colorNode = softDot(vec3(1, .55, .2), sin(time.mul(2.4)).mul(.2).add(.9))
    haloMaterial.sizeNode = float(.9)
    root.add(halo)

    // 金属环与漂浮晶体，受两盏彩色点光与一盏主光照亮。
    const metal = new THREE.MeshStandardNodeMaterial({ color: 0xd8c39a, roughness: .22, metalness: 1 })
    const rings = [.32, .46].map((r, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .006 + index * .003, 16, 256), metal)
      root.add(ring); return ring
    })
    const crystals = Array.from({ length: 7 }, (_, index) => {
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(.035 + (index % 3) * .012, 0),
        new THREE.MeshPhysicalNodeMaterial({ color: index % 2 ? 0x9fd8ff : 0xffb27a, roughness: .08, metalness: .1, clearcoat: 1, flatShading: true }))
      root.add(mesh); return mesh
    })
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 2)
    const warm = new THREE.PointLight(0xff7a2a, 4, 2.5), cool = new THREE.PointLight(0x3f8cff, 4, 2.5)
    scene.add(key, new THREE.HemisphereLight(0x8090ff, 0x100808, .35))
    root.add(warm, cool)
    void uniform; void vec2; void fract

    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      const t = info.time
      rings[0].rotation.set(Math.PI / 2 + Math.sin(t * .7) * .35, t * .6, 0)
      rings[1].rotation.set(Math.PI / 2 + Math.cos(t * .5) * .45, -t * .4, t * .2)
      crystals.forEach((mesh, index) => {
        const a = t * (.45 + index * .05) + index * Math.PI * 2 / crystals.length, r = .62 + (index % 3) * .12
        mesh.position.set(Math.cos(a) * r, Math.sin(t * 1.4 + index) * .06 + .05, Math.sin(a) * r)
        mesh.rotation.set(t * (1 + index * .2), t * (.7 + index * .1), 0)
      })
      warm.position.set(Math.cos(t) * .5, .15, Math.sin(t) * .5)
      cool.position.set(Math.cos(t + Math.PI) * .5, -.1, Math.sin(t + Math.PI) * .5)
      coreMesh.scale.setScalar(1 + Math.sin(t * 2.4) * .08)
    } }
  },
}
