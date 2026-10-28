# 定做法：把质感翻译成真实能力

用于参考里的玻璃、金属、颗粒、景深、程序纹理和空间运动。先问“要画新画面，还是处理已有画面？之后谁要改哪一项？”，再选路线。

## 选择表

| 路线 | 适合与常见组合 | 确定性／可编辑性／成本边界 |
| --- | --- | --- |
| 代码生成器（Canvas2D 图层） | 标题、Logo 排版、信息图、线条、参数化卡片、粒子；`layers` 分图层＋pose 运动 | 按 time 可任意寻帧；参数与图层可点选编辑；绘制量大时看 performance 反馈优化 |
| 代码生成器（WebGPU） | 程序纹理、距离场、体积光、大量粒子、满屏点阵与网格底纹、多遍后期 | 与合成共用 GPU 设备，效率最高；需自己管理管线与纹理，务必真实试帧 |
| 代码滤镜 | 处理下方画面：局部折射、方向模糊、色散、相邻帧拖影；`createWebGPU` 读 `inputs.current` 与 `inputs.frames` | 只拿当前输入与声明的相邻帧，不读其他轨道或无限历史；源码可改 |
| shaders 组件 | 成熟纹理、材质、扭曲、模糊；先查组件目录，作为片段效果 `effect:shaders.组件名` 或转场 `transition:shaders.组件名` | 已筛选为可寻帧确定；参数易调；作者代码不能直接调用组件 |
| 内置效果 | 全能调色 effect:color_grade、辉光 Pro effect:glow_pro、高斯／方向／缩放模糊、锐化、颗粒、暗角 | 用 video_edit.builtin_effect 查参数；video_edit.effect 可改、可设 frame_curves；单位通常是意图强度 |
| AI 生图／生视频再合成 | 真实场景、复杂角色、摄影／难程序化的有机纹理；原地生成后图形／字幕叠加 | 可能付费且不保证精确重复或文字正确；结果成为媒体，内部不可逐元素改；先给用户可评估的方案与预算，遵守已有生成授权 |
| 时间线片段／转场 | 现成媒体编排、剪接、字幕、速度交接 | 时间线驱动过渡进度；不用代码重写已有剪辑操作，转场名必须来自目录 |

## 判定做不到之前必须做完三步

1. 按中英文概念查 shader-components 各参考的角色和真实组件名，再读 video_edit.builtin_effect 的范围与含义；滤镜、生成器、转场不能混称。
2. 查内置效果与项目组件库（video_edit.code_component）；已有全能调色／辉光 Pro／方向模糊不复制一份算法。按同目的比较组件、代码、素材路线的可编辑性与代价。
3. 用授权目标做最小试帧：提交源码／参数并通过试渲染，用 observe_video_edit_frame＋read_application_media(mode="image") 读真实结果；检查关键质感而非只加载成功。没有可安全试帧的目标或权限时报告“未验证”，不能判定技术做不到。

三步后仍不达标，说明查过哪些、差在哪里、哪种近似可交付；有方向可行而样张失败时先改组合，不继续堆自写算法。

常用组合：程序纹理在底、稳定文字在上；背景轻模糊、主体清晰；折射类效果作为滤镜放在纹理片段上，文字放在更高轨道；数字／连线由生成器控制，落点配已有音效；摄影底图先全能调色再局部辉光，不用每层泛白。

## 参考有纵深

整体缩放没有近远视差。小幅界面景深可用前中后图层不同 pose 位移／尺度，并给远层 `blurShape: "lens"` 散焦，标明伪 3D；物体侧转露出厚度、遮挡或真实运镜，优先读 recipes-3d，使用三维镜头参考验证机位或授权 AI 素材。三维参考输出是媒体，不会变成代码里的实时相机。

## 完整样例：程序纹理＋可改标题

背景用代码画缓慢流动的光带，标题单独成层，参数开放标题、颜色、流速与入场；试帧能检查焦点，不能据一帧宣称 4K 实时性能通过。

```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
export default {
  name: "纹理与信息分工", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: "title", type: "text", title: "标题", default: "让画面解释想法", maxLength: 80, layer: "title" },
    { key: "ink", type: "color", title: "标题颜色", default: "#f0f5fa" },
    { key: "speed", type: "number", title: "背景流速", default: .4, min: 0, max: 2, step: .05 },
    { key: "enter", type: "number", title: "入场秒数", default: .6, min: .2, max: 1.2, step: .05 }
  ],
  layers(params, width, height) {
    return [
      { id: "texture", draw(ctx, time) {
        ctx.fillStyle = "#0f1217"; ctx.fillRect(0, 0, width, height)
        const glow = ctx.createLinearGradient(0, 0, width, height)
        const phase = .5 + .3 * Math.sin(time * params.speed)
        glow.addColorStop(0, "rgba(40, 120, 110, 0)"); glow.addColorStop(phase, "rgba(40, 120, 110, .35)"); glow.addColorStop(1, "rgba(40, 120, 110, 0)")
        ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height)
      } },
      { id: "title", bounds: [width * .08, height * .42, width * .92, height * .58], draw(ctx, time) {
        ctx.globalAlpha = clamp01((time - .15) / (params.enter * .5))
        drawText(ctx, layoutText(params.title, { fontSize: height * .08, fontWeight: 700, align: "left", fill: { color: params.ink } }, { maxWidth: width * .84, maxLines: 2, fit: { minFontSize: height * .04 }, anchor: { x: width * .08, y: height * .5, horizontal: 0, vertical: .5 } }))
      } }
    ]
  }
}
```
