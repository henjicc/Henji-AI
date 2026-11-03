// ticket 36 探针：作者场景的图片参数绑定时间线片段，把拿到的画面贴到一块倾斜的平面上（验证片段引用整条链路）。
import * as THREE from 'three/webgpu'

export default {
  name: '片段引用探针', width: 1920, height: 1080, durationSeconds: 8,
  params: [{ key: 'title', type: 'image', title: '引用的片段' }],
  createThree() {
    const scene = new THREE.Scene()
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, color: 0xffaa55 })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(.9, .5), material)
    plane.position.set(0, -.15, -1.6); plane.rotation.set(-.5, .4, 0)
    scene.add(plane)
    let texture: THREE.Texture | undefined, source: unknown
    return { scene, update(_params: unknown, assets: Record<string, CanvasImageSource | undefined>, info: { time: number }) {
      const image = assets.title
      if (image && image !== source) {
        texture?.dispose()
        texture = new THREE.Texture(image as unknown as HTMLImageElement); texture.needsUpdate = true; texture.colorSpace = THREE.SRGBColorSpace
        material.map = texture; material.needsUpdate = true; source = image
      }
      plane.rotation.y = .4 + Math.sin(info.time) * .2
    } }
  },
}
