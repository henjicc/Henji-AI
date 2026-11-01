# 空间构图与三维内容

先用风格件，再用内置效果、宿主空间能力，最后用标准 three 创作几何与灯光。

## 时间线卡片

1. 从正式目录取得 documentRef、sequenceRef、clipRefs，读取当前属性和关键帧。
2. 拉开远近用 `arrange_video_edit_depth`：clipRefs 按远到近，parallaxRatio 是最近/最远层视差比，focusRef 保持参考层；有动画时给 range。
3. 从平面连续展开或压平用 `transition_video_edit_space`，range 是包含两端的序列帧；expand 给 parallaxRatio、perspective。宿主持久保存主体取景，不在源码手算投影或另建摄像机。
4. 精确调整走通用属性：片段 spatial_enabled、depth、rotation_x/y、anchor_depth 及各自 keyframes；序列 spatial_camera 保存 framing.target、heightFraction、perspective、aim、focus、defocus。clip 目标使用完整 targetRef；相机曲线用序列帧，目标切换用 hold。
5. 调 `verify_video_edit_space` 读同帧几何、焦点、裁剪、遮挡与误差，沿 nextCursor 读完。再 `observe_video_edit_frame`，用 `read_application_media(mode="image")` 看图；结构证据不能代替视觉通过。

景深是层中心近似；透明媒体、文字空白、蒙版与未知作者场景不能凭几何断言像素可见。强度或构图不可行时按事实调整输入，不降低误差门槛。二维错峰、示范动作、防抖和跟踪只处理二维动作，空间键原样保留。

## 真实几何与灯光（作者 API 13 起）

用受管 `createThree(host)` 返回 `{scene, update, dispose?}`。作者只创建标准 three 内容，宿主掌管相机、渲染器、景深与曝光；不调用 render、setAnimationLoop 或 RAF。材质使用标准材质或节点材质，不使用 GLSL ShaderMaterial。相机、three/webgpu、three/tsl 必须来自同一冻结作者库。

```ts
import * as THREE from "three"
export default {
  name: "旋转方块", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 4,
  createThree(host) {
    const scene = new THREE.Scene()
    const cube = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .3),
      new THREE.MeshStandardMaterial({ color: 0x738b96, roughness: .5 }))
    scene.add(cube, new THREE.AmbientLight(0xffffff, 2))
    return { scene, update(params, assets, info) {
      cube.rotation.set(info.time * .4, info.time * .7, 0)
    } }
  }
}
```

update 的 info.time 是源时间；模拟用 `info.simulation.at(info.time)`，不能累加 delta。需要空间上下文的其他入口显式声明 `space: true`，只在中心时刻生成卡片材料；createThree 自动依赖空间，按宿主子时刻渲染。不要把序列时间当源时间。

API 9 及以下的 createWebGL/createWebGPU 内容保留其版本行为；新作品用受管场景。镜头参考工作区仍走自身正式能力输出媒体，不能把它的相机当作剪辑序列相机。
