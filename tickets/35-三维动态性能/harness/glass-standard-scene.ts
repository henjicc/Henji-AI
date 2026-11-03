// ticket 36 第 5 段验收：标准实心玻璃（host.space.material('glass')）方块，缓慢转动，放在下方画面之上。
// 实时为两次折射的节点材质，渲染方式下换成同参数的经典透射材质。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

interface Host { space?: { material(preset: string, params?: Record<string, unknown>): THREE.Material; environment(preset: string): THREE.Texture | null } }

export default {
  name: '实心玻璃方块', width: 1920, height: 1080, durationSeconds: 10,
  createThree(host: Host) {
    if (!host.space) throw new Error('需要作者接口 17 的 host.space。')
    const scene = new THREE.Scene()
    scene.environment = host.space.environment('studioCool')
    const glass = host.space.material('glass', { frost: .04, dispersion: .5, tint: '#c4d8ff', absorption: .25 })
    const cube = new THREE.Mesh(new RoundedBoxGeometry(.42, .42, .42, 6, .05), glass)
    cube.position.set(0, 0, -1.2)
    scene.add(cube)
    return { scene, update(_parameters: unknown, _assets: unknown, info: { time: number }) {
      cube.rotation.set(.5 + info.time * .2, .7 + info.time * .35, 0)
    } }
  },
}
