# 纵深、三维镜头参考与代码伪3D

配方只示范写法与常见做法，不是推荐风格；配色、时长、幅度按风格说明书或需求改。

先识别参考的空间证据：近大远小、前景掠过、遮挡变化、侧转露厚度。整组同比缩放只有平面推进；景深模糊、材质着色也不自动等于真实三维。

## 三维镜头参考的边界

本项目三维镜头参考用于摆场景、机位、焦点与运镜。先从正式目录取得已有文档／节点，使用通用实体描述读取对象与摄像机属性，不能猜ID或凭配方新建无关工程。可用 apply_camera_stage_camera_move 做语义运镜、verify_camera_stage_scene 检查结果；调用前读实际输入schema与权限。

需要输出时 render_camera_stage_output 接受同次画布读取的canvasRef/nodeRef（目标为3D镜头参考节点），outputKind为image/video；图片可selectedTimeSec，输出规格720p/1080p。仅提交后台任务，返回taskRef不是媒体；用wait_camera_stage_render_task／get_camera_stage_render_task确认completed与持久结果节点，再沿正式媒体导入／引用放进剪辑。没节点／没许可就报告缺入口，不猜建模或离线渲染接口。此路线不是通用三维制作软件，也不提供代码素材里的实时摄像机／景深参数。

需要摄影级人物、复杂模型或材质且参考工具不能满足，可建议授权AI图／视频再合成；生成费用、可控性和内部不可编辑性先说明。绝不因为纵深难做自动发起付费调用。

## 代码伪3D配方

背景、主体、前景分成图层，前景移动快、远景慢。轻推进可以只让三层 pose 用不同 scale 与 x/y 幅度；需要近大远小，用投影倍率f/(f+z−cameraTravel)算位置和尺寸，所有层同一时刻直接求值。分母必须始终为正且远离0，限定运镜范围或裁掉穿越镜头的层，不能靠无限放大表现穿越。

图层 pose 只有平面 rotation 与 scaleX/Y；layers 按返回顺序由远到近合成。Canvas2D 可用 `setTransform` 画斜切示意侧转，但不能声称正确透视／体积折射。需要真正的三维体积、透视和光照时用 createWebGPU（光线步进、SDF 或真实网格），见 author-shaders。需要动态遮挡换序时按当前时间排序返回的图层数组，不读取上一帧。

完整样例：三层卡片按固定纵深由远到近绘制，统一前推产生不同位移和尺度。运镜距离、秒数、标题、颜色可改；技术约束来自投影分母，非产品数量上限。它是伪3D平面卡片，不含厚度、真实光照或相机景深。

```ts
const sineInOut = t => -(Math.cos(Math.PI * t) - 1) / 2
const clamp01 = v => Math.min(1, Math.max(0, v))
export default {
  name: "三层视差推进", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 6,
  params: [
    { key: "title", type: "text", title: "卡片文字", default: "近与远", maxLength: 32 },
    { key: "accent", type: "color", title: "卡片颜色", default: "#24666e" },
    { key: "travel", type: "number", title: "推进距离", default: 180, min: 0, max: 300, step: 10, description: "伪3D投影距离；最大300，确保最近层分母至少350，不穿过镜头" },
    { key: "seconds", type: "number", title: "推进秒数", default: 4, min: 2, max: 5, step: .1 }
  ],
  layers(params, width, height) {
    const z = [500, 0, -250], xs = [-620, 0, 560], ys = [-180, 0, 160]
    const advance = t => params.travel * sineInOut(clamp01((t - .2) / params.seconds))
    const cards = [0, 1, 2].map(i => ({ id: `depth-card-${i}`, bounds: [width / 2 - 200, height / 2 - 100, width / 2 + 200, height / 2 + 100],
      pose: t => { const k = 900 / (900 + z[i] - advance(t)); return { x: width / 2 * (1 - k) + xs[i] * k, y: height / 2 * (1 - k) + ys[i] * k, scale: k } },
      draw(ctx) {
        ctx.fillStyle = params.accent; ctx.strokeStyle = "#9ea8b5"; ctx.lineWidth = 2
        ctx.beginPath(); ctx.roundRect(width / 2 - 200, height / 2 - 100, 400, 200, 24); ctx.fill(); ctx.stroke()
        ctx.fillStyle = "#f2f5f7"; ctx.font = "48px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
        ctx.fillText(params.title, width / 2, height / 2)
      } }))
    return [{ id: "background", draw(ctx) { ctx.fillStyle = "#0f1217"; ctx.fillRect(0, 0, width, height) } }, ...cards]
  }
}
```

检查推进起中末的相对运动、近景是否盖住关键信息、所有图形是否仍在安全区。要真正侧转或人物绕行时改用三维／媒体路线，不能只给全片加缩放。

## 用 three 画真实网格

需要真实网格、透视和光照，又不想手写着色器时，用内置的 three（版本与导入路径见 [代码工程](code-project.md) 的“内置库”，作者接口 v5 起可用）。在 `createWebGL` 里把宿主给的上下文交给 three：`gl.canvas` 是宿主的 OffscreenCanvas，`canvas` 与 `context` 要一起传，否则 three 会另建一张宿主看不到的画布。每帧按 `time` 直接求值物体姿态，不累加上一帧；输出尺寸会变，`draw` 里按传入的宽高同步渲染器和摄像机。

```ts
import * as THREE from "three"
export default {
  name: "three 旋转方块", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 4,
  createWebGL(gl: WebGL2RenderingContext) {
    const renderer = new THREE.WebGLRenderer({ canvas: gl.canvas, context: gl, alpha: true, premultipliedAlpha: true })
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 100)
    camera.position.set(0, 0, 6)
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshStandardMaterial({ color: 0x24666e, roughness: 0.5 }))
    const light = new THREE.DirectionalLight(0xffffff, 1.6)
    light.position.set(3, 4, 5)
    scene.add(cube, light, new THREE.AmbientLight(0xffffff, 0.4))
    return {
      draw(time: number, _params: AuthorParams, width: number, height: number) {
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        cube.rotation.set(time * 0.6, time * 0.9, 0)
        renderer.render(scene, camera)
      },
      dispose() { renderer.dispose() },
    }
  },
}
```
