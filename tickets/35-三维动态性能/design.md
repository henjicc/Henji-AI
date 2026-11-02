摘要：三维改为“一份 three.js 场景 + 多种显示方式 + 可选最终渲染器”，取代逐张卡片精确合成的空间管线；目标实时模式 4K60。
摘要：分 6 段实施（基准样片 → 统一实时渲染器 → 显示方式与自动降级 → 路径追踪 → 导出切换与外部渲染器接口 → 退役旧管线），每段可独立验证与回滚。
摘要：保留现有空间数据模型、算法能力与读回；只替换渲染这一段，接入点是 videoEditRenderer 里调用 renderVideoEditSpatialCompositeScene 的那一处。

# 35 三维：实时渲染器与多显示方式

用户决定见 `docs/task/代码效果与渲染改进/以后再做.md` 第 4 项开头 2026-11-03 那段。本文件是实现设计。

## 1. 为什么换

现有空间管线（`videoEditSpatialExposure*`、`videoEditSpatialComposite`、`videoEditCompositeScene.renderVideoEditSpatialCompositeScene`）按离线精确思路做，每帧：

1. 每张卡片按投影密度栅格成独立材料面，生成整条 mip；
2. 每张卡片按自己的弥散圆单独做镜头虚化；
3. 投影到画面并按中心深度排序、MSAA 覆盖率合成；
4. 运动模糊在快门内重做整套流程 8 次（导出最多 16 次）再平均。

绘制命令数随“卡片数 × 每卡步骤 × 子帧”成倍增长。11-01 剖析：渲染 Worker 九成空闲、显卡约四成，堵在 Chromium 把 Dawn 命令转交显卡进程的那条单线程上。静止卡片缓存（ticket 28）后，固定 20 卡仍要 16 ms；卡片逐帧变化的样片 p95 约 135 ms、跳帧约一半。

11-03 归因（result.md“归因”，1080p、开运动模糊与景深、240 帧逐帧等 GPU 完成）：三维段帧时间 p50/p95 97.5/123 ms，其中 GPU 实际执行只有 3.5/8.4 ms；每帧约 215 个 pass、76 次提交、68 次 CPU 等 GPU 往返。最大头是 mip 生成（每帧 119 个 pass）与每层结束同步等 GPU 的累积提交。关掉运动模糊与景深仍要 39 ms。代码素材的 three 场景每个子样本重渲，还给整幅画面生成用不上的 mip。

实时引擎对同样的画面每帧固定十几步（粗估 8–20 个 pass、1–2 次提交、0 次往返），步数不随卡片数增长。这是设计层面的差别，修补现有管线不可能到 4K60。

## 2. 总体结构

```
剪辑序列（现有数据：片段 spatial 属性、序列 spatialCamera、作者 createThree 场景）
        │  每帧求值（现有 spatialEvaluation / spatialLayout，不变）
        ▼
统一 three 场景（作者冻结版 three 0.186.1，three/webgpu，共享合成器 GPUDevice）
  ├─ 卡片：剪辑片段画面作贴图的平面（内容不变不重画，按屏幕所需尺寸栅格）
  ├─ 作者场景：各代码片段 createThree 返回的 Scene 作为子节点挂入
  ├─ 灯光、阴影、环境（作者场景提供；卡片默认不受光）
  └─ 摄像机：由序列 spatialCamera 求值
        │
        ▼  按显示方式 / 最终渲染器选择
  线框 · 实体 · 实时（光栅 + TSL 后处理） · 渲染（路径追踪） · 外部（接口）
        │
        ▼
整帧画面（与现有 SpatialPictureLease 同一契约）→ 继续走二维合成、调整层、转场、导出
```

- 接入点只有一处：`videoEditRenderer.ts` 中 `renderVideoEditSpatialCompositeScene(...)` 那次调用。新渲染器交回同样的整帧租约，二维管线、卡片画面生成、渲染缓存、导出流程不动。
- 没有三维内容（现有 `flatIdentity` 判定为真）时不进三维渲染器，仍走现有二维合成，平面画面逐像素不变（P1 恒等矩阵保持零差）。
- 新渲染器住在渲染 Worker，与合成器共用 GPUDevice，three 的渲染目标就是合成器可读的纹理，不经 CPU、不整帧拷贝。

## 3. 保留与退役

保留（不改语义）：

- 持久数据：片段 `depth / rotationX / rotationY / anchorDepth / spatial.enabled`，序列 `spatialCamera`（偏移、透视量、framing / aim / focus 意图、defocus、fStop），全部曲线与传播规则。
- 求值与算法：`core/videoEdit/spatialEvaluation`、`spatialMatrices`、`spatialLayout`、`spatialPropagation`，“展开 / 压平空间”“拉开景深层次”，结构读回（卡片画面位置、遮挡、焦点）。
- 作者接口：`createThree`、`info.space`、宿主时钟与确定性约定。作者场景从“单独渲染成一层”改为“挂进统一场景”，作者代码不用改。

退役（第 6 段，新管线人眼验收通过后删除）：

- `videoEditSpatialExposure.ts`、`videoEditSpatialExposurePlan.ts` 的曝光/分组/逐样本合成，`videoEditSpatialComposite.ts` 的材料面缓存、逐卡 mip 与逐卡景深，`renderVideoEditSpatialCompositeScene`。
- 读回里依赖旧曝光计划的部分改为从统一场景求（卡片几何本来就来自 spatialEvaluation，不受影响）。

## 4. 统一场景

### 4.1 卡片

- 每张空间卡片是一个平面网格：几何用现有 `SpatialCardGeometry.uvToWorld` 直接作模型矩阵，保证与现有求值、读回同一几何。
- 贴图来自现有二维管线已画好的片段画面（`pictureMap`，含片段效果、裁剪、二维放置）。内容不变时沿用同一纹理（复用 ticket 28 的内容键判定），变了才重画；栅格尺寸按卡片在屏幕上的投影像素取档（现有栅格档位规划），不再生成整条 mip，只在缩小超过一档时生成到所需级数。
- 材质默认不受光（MeshBasicNodeMaterial，预乘 alpha，颜色空间与二维合成一致），所以无灯光时卡片颜色与二维完全相同。可选“受光”（MeshStandardNodeMaterial，以后由片段属性开启，本票先留字段不做界面）。
- 双面显示、背面镜像，沿用现有约定。

### 4.2 透明与排序

- 不透明物体走深度缓冲，正确遮挡。
- 半透明卡片默认按中心视深从远到近排序后绘制（与现有排序规则同一判定，结果可预期）；卡片互相穿插时用 three 自带的顺序无关透明（`OITPassNode`）兜底。先实测两者画面与成本，选默认。
- 已知近似：半透明交界处的景深与运动模糊是屏幕空间近似，见第 7 节。

### 4.3 作者场景

- 各代码片段 `createThree` 返回的 Scene 作为子节点挂进统一场景（同一份已加载的作者 three，`instanceof` 成立），共享摄像机、灯光、阴影与后处理。作者场景里的灯光同样照亮其他作者物体；卡片受光与否按 4.1。
- 作者场景各自的 `update` 仍按宿主时钟串行调用；粒子等逐帧状态按现有确定性约定（按时间求，不依赖上一帧）。
- 场景包围盒、遮挡与焦点读回由统一场景提供。

## 5. 显示方式（预览）

| 显示方式 | 画面 | 实现 |
|---|---|---|
| 线框 | 只画几何结构线，卡片画边框 | 统一覆盖材质（线框），无后处理 |
| 实体 | 简单明暗，不算材质贴图细节、阴影与后处理 | 统一覆盖材质（法线朝向明暗 / matcap），卡片仍显示画面 |
| 实时（默认） | 材质、灯光、阴影、景深、运动模糊、反射、全局光照、环境光遮蔽、泛光、抗锯齿 | 见 5.1 |
| 渲染 | 路径追踪，画面停住后渐进收敛 | 见第 6 节 |

### 5.1 实时模式的后处理

全部用作者版 three 0.186.1 自带的 TSL 节点（已核实存在于 `examples/jsm/tsl/display/`）：

| 效果 | 节点 | 备注 |
|---|---|---|
| 景深 | `DepthOfFieldNode` | 焦距、光圈来自 spatialCamera 求值（与现有光学参数同一换算） |
| 运动模糊 | `MotionBlur` + 场景速度缓冲（MRT `velocity`） | 速度由序列在 t−Δt 的确定性求值给出，不依赖播放历史 |
| 泛光 | `BloomNode` | 光效、发光材质 |
| 环境光遮蔽 | `GTAONode` | |
| 屏幕空间反射 | `SSRNode` | 需 MRT 法线与金属度/粗糙度 |
| 屏幕空间全局光照 | `SSGINode` | 成本高，默认关，按质量档开启 |
| 抗锯齿 | 预览 `TRAANode`；导出 `SSAAPassNode` 或 MSAA | TRAA 依赖历史帧，导出逐帧必须可复现，所以导出不用 |
| 透明 | `OITPassNode` | 见 4.2 |
| 放大 | `FSR1Node` / `TAAUNode` | 自动降级时降内部分辨率再放大 |

这些效果的开关与强度是序列的“三维渲染设置”（第 8 节），助手可设。阴影用 three 自带阴影贴图（灯光由作者场景创建并开启 castShadow）。

### 5.2 自动降级

- 预览每帧测实时模式的帧时间（现有渲染条统计）。连续超出预算时，先降内部渲染分辨率（FSR1 放大回输出尺寸），再关最贵的效果（SSGI → SSR → 体积类），仍不够再降一档显示方式（实时 → 实体）。恢复时反向逐级升回，带迟滞避免来回跳。
- 当前是简化画面时在节目监视器给出简短状态提示（用户任务语言，例如“预览已简化”），悬停说明原因。不展示内部计数。
- 用户手动选了显示方式就锁定该档，不自动降；可选“自动”。

## 6. 渲染模式：应用内路径追踪

- 采用 three-gpu-pathtracer 的 `WebGPUPathTracer`（MIT）。版本 0.0.27：peerDependencies three ≥ 0.185、three-mesh-bvh ≥ 0.9.15，与作者版 three 0.186.1 兼容（0.0.28 起要求 three ≥ 0.187，暂不升）。three-mesh-bvh 用 0.9.x（应用里镜头参考仍用 0.7.8，两者分开）。两包的 `three` 导入在渲染 Worker 打包时指向作者版 three，不打包第二份。
- 预览“渲染”模式：画面停住后每帧累加采样、渐进收敛，拖动时退回实时模式画面；带降噪。
- 导出：每帧固定采样数（序列设置），随机种子按帧号确定，逐帧可复现。
- 卡片在路径追踪里是发光面（等同不受光），作者物体用标准 PBR 材质；不支持的材质（节点自定义着色）退回最接近的标准材质并给出一条警告日志。
- 上限如实说明：浏览器无显卡硬件光追，比 Blender Cycles + RTX 慢；超大场景、体积、毛发、复杂程序化材质不在本票范围，留给外部渲染器。

## 7. 近似与已知瑕疵

- 景深、运动模糊是屏幕空间后处理：半透明卡片前后交叠、物体遮挡边缘处有轻微瑕疵；按“人眼看不出差别就算过”验收，对比图由 Claude 目视，拿不准的发给用户。
- 导出可选“高质量运动模糊”：实时渲染器在快门内取若干子帧累加（每帧多画几遍，导出时可接受），解决遮挡边缘问题。默认用速度缓冲。
- TRAA 只在预览用；导出用不依赖历史的抗锯齿，保证任意帧随机访问可复现。

## 8. 持久格式与助手能力

序列新增可选对象（缺省即现状，不写入旧作品）：

```ts
interface VideoEditSequenceRender3d {
  /** 导出与预渲染用的最终渲染器。 */
  renderer?: 'realtime' | 'pathTrace' | 'external'   // 缺省 realtime
  pathTraceSamples?: number                         // 缺省 256
  motionBlur?: 'velocity' | 'subframes'             // 导出运动模糊方式，缺省 velocity
  effects?: { bloom?: number; ambientOcclusion?: number; reflections?: number; globalIllumination?: number }  // 0..1 强度，缺省按质量档
  external?: { kind: 'blender'; samples?: number }  // 只预留，renderer 选 external 时目前报“未安装/未接入”
}
```

- 按 `docs/rules/persistence.md`：只新增可选字段，不提高最低可读版本；登记格式、写黄金样本。
- 预览显示方式（自动 / 线框 / 实体 / 实时 / 渲染）是查看状态，不进作品内容和撤销栈，随作品的查看状态保存（与现有回放分辨率同一处）。
- 两者都登记为通用实体属性，助手用通用读/改动词设置，取帧读回能报告当前显示方式与是否被自动简化（`docs/rules/assistant-capability.md`）。

## 9. 外部渲染器接口（只预留）

- 接口：`render3dExternal.describe()`（是否可用、版本）、`exportScene(sequence, range) → 场景包`（glTF + 摄像机与动画曲线 + 卡片画面序列帧引用）、`render(scenePackage, frames, settings, signal) → 帧序列`。
- 本票只定接口类型与“未接入”的明确报错，不实现场景导出与调用 Blender。

## 10. 测试样片（贴近日常、适度复杂）

隔离临时数据里由脚本建工程，1920×1080 与 3840×2160 各一份，60 fps，10 秒：

- 8 张剪辑卡片：2 张视频、2 张图片、2 张逐帧变化的文字动画、2 张代码画面（其中 1 张逐帧变化的数据图表），分布在不同深度并有 X/Y 旋转；摄像机推近 + 环绕，对焦从近卡拉到远卡。
- 作者 three 场景：
  - 粒子：约 2 万个点精灵，按时间确定性运动，带发光；
  - 灯光：1 个带阴影的平行光、2 个彩色点光源、环境贴图；
  - 地面：带粗糙度的反射地面（检验反射与阴影）；
  - 2–3 个标准材质物体（金属球、玻璃感半透明块、文字挤出）。
- 开启：景深、运动模糊、泛光、环境光遮蔽、反射；全局光照单独一轮测。

验收指标：

| 项 | 指标 |
|---|---|
| 实时模式 1080p60 | 帧时间 p50 / p95，跳帧率 < 1% |
| 实时模式 4K60 | 帧时间 p50 / p95，跳帧率 < 5%（目标） |
| 自动降级 | 超预算后几帧内降档、恢复后升回，不来回跳 |
| 显示方式切换 | 切换到首帧出画耗时 |
| 路径追踪导出 | 每帧耗时（1080p，256 采样） |
| 平面恒等 | P1 恒等矩阵零差 |
| 画面 | 与现有管线同一时刻对比，人眼无可感知差异（新增光影效果的部分除外） |

## 11. 分段实施

| 段 | 内容 | 可独立验证 |
|---|---|---|
| 1 | 基准样片与测量脚本；在现有管线上测基线 | 基线数字 |
| 2 | 统一场景实时渲染器（卡片、作者场景挂入、摄像机、透明排序、TSL 后处理）替换接入点；平面仍走二维 | P1 零差；样片对比图；1080p/4K 帧时间 |
| 3 | 显示方式（线框 / 实体 / 实时）与自动降级；查看状态与助手属性；节目监视器里的切换入口与简化提示（界面由 Claude 做） | 切换耗时；降级行为；助手读写 |
| 4 | 路径追踪（依赖安装、Worker 打包别名、渐进预览、导出采样与种子） | 收敛画面；逐帧可复现；每帧耗时 |
| 5 | 序列三维渲染设置（格式、迁移、黄金样本）、导出自动切换最终渲染器、外部渲染器接口 | 导出样片；格式测试 |
| 6 | 退役旧空间管线，清理读回依赖 | 全部相关测试；P1；样片复测 |

每段提交前按 AGENTS.md 做独立审查（L2 及持久格式）。

## 12. 风险

- TSL 节点在 0.186.1 的 WebGPU 后端上个别效果可能有缺陷或成本过高：逐个实测，不达标的换实现或降默认。
- three-gpu-pathtracer 的 WebGPU 版很新（0.0.x）：锁定精确版本，路径追踪失败时退回实时模式画面并报告，不影响实时与导出的实时渲染器。
- 共享 GPUDevice：three 的渲染目标与合成器纹理格式、颜色空间要对齐（线性、半浮点），设备丢失后统一场景随合成器一起重建。
- 作者场景挂入统一场景后，作者之间可能互相影响（灯光、雾）：作为预期行为写进作者说明；需要隔离时作者自己用 layers。

## 参考

- three.js WebGPU 后处理：https://threejs.org/manual/en/webgpu-postprocessing.html
- three-gpu-pathtracer WebGPUPathTracer（v0.0.26 起）：https://discourse.threejs.org/t/three-gpu-pathtracer-a-modular-shader-based-path-tracing-extension-for-three-js/36903/56
- WebGPU 尚无硬件光追（Khronos GDC 2026）：https://www.khronos.org/assets/uploads/developers/presentations/3D_on_the_Web_2026_-_GDC_2026_WebGL%2BWebGPU_Update.pdf
- Blender 命令行渲染：https://docs.blender.org/manual/es/3.6/advanced/command_line/render.html

## 第 4 段可行性（11-03，prototype/pt.ts，evidence/pt/）

- three-gpu-pathtracer 0.0.27 + three-mesh-bvh 0.9.17 在 three 0.186.1 上可用（只有 Source 改名的警告）。1080p 本机：首帧约 3.8 s（编译着色器），64 spp 约 8 s，256 spp 约 21 s（约 20 spp/s）。玻璃折射、金属、清漆、地面反射正确。
- 环境光必须是 CPU 上有数据的等距柱状图，且要线性过滤（DataTexture 默认最近邻，three 当作不可过滤、不声明采样器，WGSL 报 `*_sampler` 未定义）；PMREM 不行，立方体贴图转换走 WebGL 的 readRenderTargetPixels 也不行。做法：GPU 上把立方体环境展开成等距柱状图再异步读回，转半精度。
- 只在 GPU 上的卡片画面（ExternalTexture）能进图集，但上下颠倒、未做 sRGB 解码：接入时先把卡片画进普通渲染目标（解码 gamma 2.4 到线性），再作为自发光贴图。
- 接入真实渲染链路（harness `--display render --quality final`，正式样片第 150 帧，evidence/trace/）：1080p 256 spp 约 8 s（含编译）。卡片颜色与实时逐点对上（42→43、216→216、橙条完全相同），位置、景深强度一致。
  踩过的坑：卡片发光被中性色调映射压暗（追踪里没有卡片遮罩）→ 解码时先做中性色调映射的逆；半透明穿透后的背景要设成透明（TRANSMISSIVE_BACKGROUND_TRANSPARENT）；贴图图集改半精度。

## 复杂测试样片（11-03，harness/complex-scene.ts，evidence/complex*/）

反射地面、带 2048 阴影的平行光、两盏运动彩色点光、程序化环境图、金属/清漆/透明物体、2 万个确定性运动的发光粒子，加正式样片的 6 张卡片。
1080p 逐帧等显卡完成（不是流水线播放）的三维段帧时间 p50 / p95：

| 效果 | p50 | p95 |
|---|---|---|
| 都不开 | 12.0–12.5 | 15–20 |
| 只开运动模糊 | 18 | 21 |
| 只开景深 | 15.6–21.5 | 37–45 |
| 都开 | 22.5–25.5 | 42–52 |

瓶颈是景深的尖峰：这条样片持续拉焦，标题、副标题卡片（栅格约 3400×1900）每帧重新整张虚化。下一步可做：卡片虚化按屏幕所需尺寸降采样后再虚化、虚化半径分档复用。
统一渲染器打开了阴影（PCF 软阴影），作者灯光的 castShadow 生效。
