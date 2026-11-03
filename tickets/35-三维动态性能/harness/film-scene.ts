// ticket 35 小短片「星核」：八万粒子从远处螺旋汇聚 → 核心点燃、冲击波扩散 → 粒子壳层呼吸、吸积盘旋转，
// 金属环与晶体在镜面地板上反射。粒子位置全在显卡上按编号与宿主时间算（确定性）。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'
import { Fn, instanceIndex, float, vec3, vec4, sin, cos, sqrt, exp, max, mix, uv, time, smoothstep, step, length, pow, hash } from 'three/tsl'

const SWARM = 80000
const STARS = 6000
const IGNITE = 3.6

function softDot(colorNode: ReturnType<typeof vec3>, strength: ReturnType<typeof float> | number = 1) {
  const d = length(uv().sub(.5)).mul(2)
  const falloff = pow(smoothstep(1, 0, d), 2.2)
  return vec4(colorNode.mul(falloff).mul(strength), falloff)
}

const ramp = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)))
const easeOutBack = (u: number) => 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2)

export default {
  name: '星核短片', width: 1920, height: 1080, durationSeconds: 10,
  createThree() {
    const scene = new THREE.Scene()
    const root = new THREE.Group()
    root.rotation.x = -.36
    root.scale.setScalar(1.55)
    scene.add(root)

    // 粒子群：七成落在呼吸的球壳上，三成落进吸积盘；汇聚前在远处大球面上，沿螺旋飞入。
    const swarm = new THREE.Sprite(new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    swarm.count = SWARM
    const m = swarm.material as THREE.PointsNodeMaterial
    const s = Fn(() => vec3(hash(instanceIndex), hash(instanceIndex.add(17111)), hash(instanceIndex.add(39187))))()
    const s2 = hash(instanceIndex.add(51234))
    const theta = s.x.mul(Math.PI * 2), cosPhi = s.y.mul(2).sub(1), sinPhi = sqrt(float(1).sub(cosPhi.mul(cosPhi)))
    const delay = s.z.mul(1.9).add(.15)
    const p = smoothstep(delay, delay.add(1.5), time)
    const after = max(time.sub(IGNITE), 0)
    const ignite = smoothstep(IGNITE - .15, IGNITE + .05, time)
    const pulse = exp(after.mul(-2.2)).mul(ignite)
    const breathe = sin(time.mul(1.6).add(s.x.mul(6))).mul(.03).mul(ignite).add(1)
    const disk = step(s2, .3)
    const shellR = s2.mul(.08).add(.3).mul(pulse.mul(.45).add(1)).mul(breathe)
    const diskR = s2.div(.3).mul(.95).add(.48)
    const targetR = mix(shellR.mul(sinPhi), diskR, disk)
    const targetY = mix(shellR.mul(cosPhi), s.y.sub(.5).mul(.025), disk)
    const targetA = theta.add(mix(time.mul(.22), time.mul(float(.55).div(diskR)), disk))
    const R = mix(sinPhi.mul(3.4), targetR, p), Y = mix(cosPhi.mul(2.2), targetY, p)
    const A = targetA.add(float(1).sub(p).mul(5.5))
    m.positionNode = vec3(cos(A).mul(R), Y, sin(A).mul(R))
    const flight = vec3(.55, .75, 1), shellColor = vec3(1, .58, .24), diskColor = mix(vec3(.35, .55, 1), vec3(.8, .35, 1), smoothstep(.5, 1.4, diskR))
    const landed = mix(shellColor, diskColor, disk)
    const glow = pulse.mul(2.5).add(mix(float(.55), float(1), ignite))
    const twinkle = sin(time.mul(3).add(s.z.mul(40))).mul(.2).add(.9)
    m.colorNode = softDot(mix(flight, landed, p).mul(glow).mul(twinkle), 2)
    m.sizeNode = mix(float(.018), float(.01), p).mul(s.x.mul(.7).add(.6))
    m.sizeAttenuation = true
    root.add(swarm)

    // 星空。
    const stars = new THREE.Sprite(new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    stars.count = STARS
    const sm = stars.material as THREE.PointsNodeMaterial
    const q = Fn(() => vec3(hash(instanceIndex.add(5)), hash(instanceIndex.add(9001)), hash(instanceIndex.add(77777))))()
    sm.positionNode = vec3(q.x.sub(.5).mul(8), q.y.sub(.3).mul(4.5), q.z.mul(-2).sub(2.6))
    sm.colorNode = softDot(vec3(.8, .85, 1).mul(sin(time.mul(2).add(q.x.mul(90))).mul(.3).add(.7)), 1.2)
    sm.sizeNode = q.z.mul(.018).add(.007)
    scene.add(stars)

    // 核心、光晕与冲击波。
    const core = new THREE.Mesh(new THREE.SphereGeometry(.07, 64, 32), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.2, 1.4, .6) }))
    root.add(core)
    const halo = new THREE.Sprite(new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.count = 1
    const hm = halo.material as THREE.PointsNodeMaterial
    hm.colorNode = softDot(vec3(1, .55, .2), ignite.mul(sin(time.mul(2.4)).mul(.2).add(.9)).add(pulse.mul(1.5)))
    hm.sizeNode = float(1.1)
    root.add(halo)
    const wave = new THREE.Mesh(new THREE.RingGeometry(.96, 1, 192), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(1.6, 1, .55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }))
    wave.rotation.x = -Math.PI / 2
    root.add(wave)

    // 金属环、晶体与镜面地板。
    const metal = new THREE.MeshStandardNodeMaterial({ color: 0xd8c39a, roughness: .2, metalness: 1 })
    const rings = [.5, .64].map((r, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .007 + index * .003, 16, 256), metal)
      root.add(ring); return ring
    })
    const crystals = Array.from({ length: 9 }, (_, index) => {
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(.032 + (index % 3) * .012, 0),
        new THREE.MeshPhysicalNodeMaterial({ color: index % 2 ? 0x9fd8ff : 0xffb27a, roughness: .08, metalness: .1, clearcoat: 1, flatShading: true }))
      root.add(mesh); return mesh
    })
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 128), new THREE.MeshStandardNodeMaterial({ color: 0x0c0d12, roughness: .18, metalness: .85 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -.42
    root.add(floor)
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 2, 2)
    const warm = new THREE.PointLight(0xff7a2a, 5, 3), cool = new THREE.PointLight(0x3f8cff, 5, 3)
    scene.add(key, new THREE.HemisphereLight(0x8090ff, 0x100808, .3))
    root.add(warm, cool)

    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      const t = info.time
      // 镜头缓缓推近并绕转。
      const push = ramp(t, 0, 10)
      root.position.set(0, .04, -2.3 + push * .75)
      root.rotation.y = t * .06
      const lit = ramp(t, IGNITE - .2, IGNITE + .35)
      core.scale.setScalar(Math.max(.001, lit < 1 ? easeOutBack(lit) * lit : 1 + Math.sin(t * 2.4) * .08))
      const u = ramp(t, IGNITE, IGNITE + 1.6)
      wave.visible = u > 0 && u < 1
      wave.scale.setScalar(.15 + u * 2.6)
      ;(wave.material as THREE.MeshBasicNodeMaterial).opacity = Math.pow(1 - u, 2)
      const grow = easeOutBack(ramp(t, IGNITE + .2, IGNITE + 1.2))
      rings[0].scale.setScalar(Math.max(.001, grow))
      rings[1].scale.setScalar(Math.max(.001, easeOutBack(ramp(t, IGNITE + .45, IGNITE + 1.45))))
      rings[0].rotation.set(Math.PI / 2 + Math.sin(t * .7) * .35, t * .6, 0)
      rings[1].rotation.set(Math.PI / 2 + Math.cos(t * .5) * .45, -t * .4, t * .2)
      crystals.forEach((mesh, index) => {
        const a = t * (.4 + index * .04) + index * Math.PI * 2 / crystals.length, r = .82 + (index % 3) * .14
        mesh.scale.setScalar(Math.max(.001, easeOutBack(ramp(t, IGNITE + .6 + index * .08, IGNITE + 1.4 + index * .08))))
        mesh.position.set(Math.cos(a) * r, Math.sin(t * 1.4 + index) * .06 + .06, Math.sin(a) * r)
        mesh.rotation.set(t * (1 + index * .2), t * (.7 + index * .1), 0)
      })
      warm.intensity = cool.intensity = 5 * lit
      warm.position.set(Math.cos(t) * .55, .15, Math.sin(t) * .55)
      cool.position.set(Math.cos(t + Math.PI) * .55, -.1, Math.sin(t + Math.PI) * .55)
    } }
  },
}
