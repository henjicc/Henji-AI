# 定做法：把质感翻译成真实能力

用于参考里的玻璃、金属、颗粒、景深、程序纹理和空间运动。先问“要画新画面，还是处理已有画面？之后谁要改哪一项？”，再选路线。没有图层面板、插件系统、表达式或MOGRT。

## 选择表

| 路线 | 适合与常见组合 | 确定性／可编辑性／成本边界 |
| --- | --- | --- |
| 代码图形生成器 | 标题、Logo排版、信息图、线条、参数化卡片；rect/path/text/group＋progress | 任意寻帧确定；参数与元素可编辑；大量图形、逐字、路径按单帧展开预算计费 |
| 代码滤镜 | 输入画面局部处理、方向采样、自定义折射；sample/blur＋数学或shaderFilter | 只拿当前输入，不自动取得其他轨道或历史；源码可改；采样和标量工作有预算 |
| shaders组件 | 成熟纹理、材质、扭曲、模糊；优先查167组件目录；代码内shader({name:"Glass"})或layers，片段效果effect:shaders.Glass | 本项目筛选可寻帧确定的组件；易调参数；材质、多层和大尺寸较贵，不能搬别的软件帧率数据 |
| 自写WGSL | 组件拼不出的像素算法／距离场质感 | 作者shaders定义＋shader/shaderFilter；无网页／无限历史；可维护源码但需真实编译与试帧，不先自研成熟效果 |
| 内置效果 | 全能调色effect:color_grade、辉光Pro effect:glow_pro、高斯／方向／缩放模糊、锐化、颗粒、暗角 | 用video_edit.builtin_effect查参数；video_edit.effect通用实体可改、可设frame_curves；单位通常是意图强度而非作者像素 |
| AI生图／生视频再合成 | 真实场景、复杂角色、摄影／难程序化的有机纹理；原地生成后图形／字幕叠加 | 生成可能付费且不保证精确重复或文字正确；固定结果成为媒体，源画面内部不可逐元素改；先给用户可评估的方案与预算，遵守已有生成授权 |
| 时间线片段／转场 | 现成媒体编排、剪接、字幕、速度交接；video_edit.transition的kind可用shaders.转场组件名 | 时间线驱动过渡进度；片段与字幕易接手；不用代码重写已有剪辑操作，转场名必须来自目录 |

## 判定做不到之前必须做完三步

1. 按中英文概念查 shader-components 各参考的角色和真实组件名，再读 video_edit.builtin_effect 的范围与含义；滤镜、生成器、转场不能混称。
2. 查内置效果与项目组件库（video_edit.code_component）；已有全能调色／辉光Pro／方向模糊不复制一份算法。按同目的比较组件组合、代码图形、素材路线的可编辑性与代价。
3. 用授权目标做最小试帧：提交源码／参数并通过试渲染，用 observe_video_edit_frame＋read_application_media 读真实结果；检查关键质感而非只编译成功。没有可安全试帧的目标或权限时报告“未验证”，不能判定技术做不到。

三步后仍不达标，说明查过哪些、差在哪里、哪种近似可交付；有方向可行而样张失败时先改组合，不继续堆自写算法。

常用组合：程序纹理在底、稳定文字在上；背景轻Blur、主体清晰；Glass处理它前面的纹理，文字放Glass之后；数字／连线由生成器控制，落点配已有音效；摄影底图先全能调色再局部辉光，不用每层泛白。滤镜作用范围由children／效果所在片段确定，代码shader不会折射外部时间线的下方轨道。

## 参考有纵深

整体缩放没有近远视差。小幅界面景深可用代码前中后层的不同位移／尺度，标明伪3D；物体侧转露出厚度、遮挡或真实运镜，优先读 recipes-3d，使用三维镜头参考验证机位或授权AI素材。三维参考输出是媒体，不会变成代码素材里的实时相机。

## 完整样例：组件纹理＋可改标题

先用成熟组件画质感、代码排文字。参数开放标题、颜色、流速与入场；试帧能检查焦点，不能据CPU求值宣称GPU观感或4K性能通过。

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "纹理与信息分工",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 5, seed: 12,
  parameters: {
    title: {type: "text", title: "标题", default: "让画面解释想法", maxLength: 80},
    ink: {type: "color", title: "标题颜色", default: [.94,.96,.98,1]},
    speed: {type: "number", title: "背景流速", default: .4, min: 0, max: 2, step: .05},
    enter: {type: "number", title: "入场秒数", default: .6, min: .2, max: 1.2, step: .05}
  },
  render(ctx) {
    return [
      shader({id: "texture", x: 0, y: 0, width: ctx.width, height: ctx.height,
        time: ctx.time, layers: [
          {type: "SolidColor", props: {color: ctx.style.palette.bg}},
          {type: "Aurora", props: {speed: ctx.params.speed, intensity: 35}}
        ]}),
      text({id: "title", x: ctx.width * .08, y: ctx.height * .5,
        text: ctx.params.title, fontSize: ctx.height * .08,
        fontFamily: ctx.style.fonts.display.family, fontWeight: 700,
        maxWidth: ctx.width * .84, wrap: true, color: ctx.params.ink,
        opacity: progress(ctx.time, .15, ctx.params.enter * .5)})
    ];
  }
}
```
