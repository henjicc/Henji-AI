// ticket 36 第 6 段验收：标题身后的地面与一盏投影的主光（标题本身是时间线片段）。世界单位 = 显示高度。
import * as THREE from 'three/webgpu'

export default {
  name: '立体标题舞台', width: 1920, height: 1080, durationSeconds: 10,
  createThree() {
    const scene = new THREE.Scene()
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: .8 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -.28, -.6)
    floor.receiveShadow = true
    const key = new THREE.SpotLight(0xffffff, 40, 0, .7, .4)
    key.position.set(-.8, 1.4, 1.2)
    key.target.position.set(0, -.1, -.3)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    scene.add(floor, key, key.target, new THREE.AmbientLight(0xffffff, .15))
    return { scene, update() {} }
  },
}
