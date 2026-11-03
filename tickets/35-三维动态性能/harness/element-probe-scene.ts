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
    // 标题下沿的一排小发光球：验证 info.elements 给出的位置贴着时间线上那个标题。
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(.004, 8, 6), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3, 1.2, .3) }), 400)
    dots.count = 0; dots.frustumCulled = false
    scene.add(dots)
    const placement = new THREE.Matrix4()
    let texture: THREE.Texture | undefined, source: unknown
    return { scene, update(_params: unknown, assets: Record<string, CanvasImageSource | undefined>, info: { time: number; elements?: Record<string, { edge(side: string): Array<{ x: number; y: number; z: number }> } | null> }) {
      const edge = info.elements?.title?.edge('bottom') ?? []
      dots.count = Math.min(400, edge.length)
      for (let i = 0; i < dots.count; i++) { placement.makeTranslation(edge[i].x, edge[i].y, edge[i].z); dots.setMatrixAt(i, placement) }
      dots.instanceMatrix.needsUpdate = true
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
