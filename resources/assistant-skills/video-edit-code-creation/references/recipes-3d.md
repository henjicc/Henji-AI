# 空间构图与三维内容

先用风格件，再用内置效果、宿主空间能力，最后用标准 three 创作几何与灯光。

## 时间线卡片

1. 从正式目录取得 documentRef、sequenceRef、clipRefs，读取当前属性和关键帧。
2. 拉开远近用 `arrange_video_edit_depth`：clipRefs 按远到近，parallaxRatio 是最近/最远层视差比，focusRef 保持参考层；有动画时给 range。
3. 从平面连续展开或压平用 `transition_video_edit_space`，range 是包含两端的序列帧；expand 给 parallaxRatio、perspective。宿主持久保存主体取景，不在源码手算投影或另建摄像机。
4. 精确调整走通用属性：片段 spatial_enabled、depth、rotation_x/y、anchor_depth 及各自 keyframes；序列 spatial_camera 保存 framing.target、heightFraction、perspective、aim、focus、defocus。clip 目标使用完整 targetRef；相机曲线用序列帧，目标切换用 hold。
5. 调 `verify_video_edit_space` 读同帧几何、焦点、裁剪、遮挡与误差，沿 nextCursor 读完。再 `observe_video_edit_frame`，用 `read_application_media(mode="image")` 看图；结构证据不能代替视觉通过。

## 片段的三维表面、灯光与成片质感

能用属性做的不写代码：
- 发光：`space_emission`（1–2 常用，可关键帧），自带光晕、照亮周围物体；不必再开序列泛光。
- 立体字与实体：`space_thickness`（文字 0.02–0.06，可关键帧）+ `space_bevel`（0.1–0.3）沿片段轮廓挤出；`space_material` 选 `{preset:"metal",roughness}`、`matte`、`thin-film`（以画面为底色），或 `acrylic` / `glass`（按轮廓成形、透出身后与下方画面）；画面材质要被照亮时开 `space_lit`。轮廓含片段的投影与外发光，想要干净的挤出体先关这些效果。
- 灯光：用素材项 `kind:"light"` 放一条灯光片段（`light_kind` spot / directional / point / area、`light_intensity` 1 为常用主光且可关键帧、`light_cast_shadow`、`light_softness`、`light_angle`），位置是片段 x/y 与 `depth`，朝向是 `rotation_x` / `rotation_y`（缺省朝画面里）；它照亮整条序列受光的三维内容。要投影的片段开 `space_cast_shadow`，承接阴影的开 `space_receive_shadow`。三点布光 = 主光（左前上、投影）+ 辅光（右前、亮度 0.3–0.5、不投影）+ 轮廓光（身后上方朝镜头、亮度 1–2）。
- 没有任何灯与环境光时，受光内容会自动套“缺省布光”（摄影棚中性环境 + 一盏主光，序列 `space_default_lighting` 可关）；要精确控制就自己放灯或设 `space_environment`。
- 质感：序列 `space_tone_mapping`（agx 高光柔和）、`space_exposure`、`space_environment` 与强度、旋转、`space_bloom` 与 `space_bloom_threshold` / `space_bloom_radius`。实时与“渲染”（路径追踪）读同一份属性；实心玻璃、互反射以“渲染”为准，成片用序列 `final_renderer:"pathTrace"`。
- 实时精致档（缺省都关，按需打开）：`space_global_illumination`（全局光照，0.6–1：亮面把颜色反弹到周围，墙角色溢、背光面不再死黑）+ `space_ambient_occlusion`（0.5–0.8：相接处与凹处压暗）+ `space_reflections`（0.3–0.5：金属、光滑面反射画面里的东西）+ 一个 `space_environment` 环境光。软阴影是灯光片段的 `light_softness`（0.5–0.8）。三项都只看得到画面里的东西，画外的反弹与反射没有；金属整体偏暗、玻璃折射不真时只能靠路径追踪。
- 选实时还是路径追踪（4090、4K 实测，场景见 docs/task/三维画质）：实时现状约 15 ms/帧，开精致档三项约 21 ms/帧（约 48 帧/秒，只开全局光照约 18 ms）；4K 看片卡时把节目监视器回放分辨率降到 1/2（1080P 开全三项约 10 ms）。路径追踪 4K 每帧：16 采样约 3.6 秒、32 约 5.5 秒、64（默认）约 9 秒、256 约 31 秒，都含降噪；漫反射面 16–32 采样降噪后已接近 256，玻璃、色散、焦散要 64 才干净，64 与 256 肉眼几乎分不出。一段 10 秒 60 帧的 4K 片子 64 采样约一个半小时，一般不必提高 `path_trace_samples`；试看可降到 16–32。
- 核对：`verify_video_edit_space` 的 facts 要处理：`cross-group`（引用片段隔着二维层）、`element-cycle`（代码片段互相引用）、`reference-inactive`（引用的片段这一帧不在画面里，作者拿到空画面）、`cross-group-order`（三维里靠前的卡片在层序更低的组，会被盖住）、`unlit`（受光内容没有任何光）。
- 改完用 `observe_video_edit_frame` 看图；单张序列帧会一并返回 `space`：每组片段的形态与材质、作者物体（类型、材质、包围盒）、灯光（含缺省布光）、环境与 facts（缺省布光、实时玻璃近似等）。作者场景里物体没出现、材质不对、灯没生效，先读它再改代码。

景深是层中心近似；透明媒体、文字空白、蒙版与未知作者场景不能凭几何断言像素可见。强度或构图不可行时按事实调整输入，不降低误差门槛。二维错峰、示范动作、防抖和跟踪只处理二维动作，空间键原样保留。

## 真实几何与灯光（作者 API 15 起）

用受管 `createThree(host)` 返回 `{scene, update, dispose?}`。作者只创建标准 three 内容，宿主掌管相机、渲染器、景深与曝光；不调用 render、setAnimationLoop 或 RAF。材质使用标准材质或节点材质，不使用 GLSL ShaderMaterial。相机、three/webgpu、three/tsl 必须来自同一冻结作者库。`dispose` 只释放自己创建的几何体、材质和纹理；Sprite 的几何体等 three 内部共用的资源不要释放，宿主拦不住，会弄坏之后所有同类物体。

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

从时间线元素派生内容（作者 API 16）：先用属性和元素引用，不要把文字、标志复制进代码写死。图片参数声明 `{ key: "title", type: "image" }`，绑定 `{kind:"clip",clipId}` 引用同序列里的片段；`update` 里 `assets.title` 是它此刻的画面，`info.elements.title` 是它在作者根空间里的位置与形状：`edge("bottom")` 取外沿点（光带从字下沿长出）、`sample(n)` 在不透明处撒点（粒子从标志飞散）、`at(u,v)`。片段此刻不在画面上时两者都为空，按缺省分支处理；形状变了（改字）就重建派生几何；还没有点时（标题淡入前）把网格设为不可见，不要挂一个没有属性的空几何去渲染（着色器会按缺属性编译），换几何后设 `material.needsUpdate = true`。发光的标题用片段属性 `space_emission`（1–2），不要在代码里自己画发光字。

标准材质与环境（作者 API 17）：要玻璃、金属、薄膜干涉、亚克力、发光体时用 `host.space.material(预设, 参数)`，不要自己写着色器——同一份参数在节目监视器“实时”与“渲染”（路径追踪）里一致：`glass`（实心玻璃，`frost` 磨砂、`dispersion` 色散、`tint` 颜色、`absorption` 按厚度变深、`ior`）、`acrylic`（薄透明板）、`metal`、`matte`、`thin-film`（`range` 膜厚、`strength`、`frequency` 色带条数）、`emissive`（`color`、`intensity`）。环境用序列属性 `space_environment`，或在场景里 `scene.environment = host.space.environment("studioCool")`（宿主所有，不要释放）。实心玻璃实时是屏幕空间近似：看得到身后已画好的一切（含下方的视频与卡片），看不到屏幕外；要真实体积就切到“渲染”。节点材质里的动画用 `host.time`（本场景源时间的均匀量），不要用 TSL 自带的 `time`（按渲染次数走，预览与导出对不上）。要按元素轮廓挤出立体字或做描边时用 `info.elements.键.outline()`：返回 uv 多边形（外轮廓 + 洞），建 `THREE.Shape` / `ExtrudeGeometry` 后 `geometry.applyMatrix4(new THREE.Matrix4().fromArray(element.matrix))`。

update 的 info.time 是源时间；模拟用 `info.simulation.at(info.time)`，不能累加 delta。需要空间上下文的其他入口显式声明 `space: true`，只在中心时刻生成卡片材料；createThree 自动依赖空间，按宿主子时刻渲染。不要把序列时间当源时间。

API 9 及以下的 createWebGL/createWebGPU 内容保留其版本行为；新作品用受管场景。镜头参考工作区仍走自身正式能力输出媒体，不能把它的相机当作剪辑序列相机。
