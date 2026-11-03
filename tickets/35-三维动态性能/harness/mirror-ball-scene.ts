// 核对环境光预设朝向：一个镜面球，上半反出天、下半反出地，左右灯位看两侧。
import * as THREE from 'three/webgpu'

export default {
  name: '镜面球', width: 1920, height: 1080, durationSeconds: 10,
  createThree() {
    const scene = new THREE.Scene()
    const ball = new THREE.Mesh(new THREE.SphereGeometry(.3, 96, 64), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0 }))
    ball.position.set(0, 0, -1.5)
    scene.add(ball)
    return { scene, update() {} }
  },
}
