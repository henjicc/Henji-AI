# 玻璃、线条生长与圆角卡片

玻璃通常需要可辨背景：文字、网格、色带或真实画面；观感来自背后内容折射／磨砂、边光、投影。只有半透明填充与描边叫透明卡片，不称真实折射。

## 玻璃路线

| 组件／做法 | 适用与检查 |
| --- | --- |
| Glass（effect:shaders.Glass） | 局部透镜／自定义形状玻璃；refraction 0–2、blur 0–20、thickness 0–1、aberration 0–1；从低色差与适量边光起步 |
| FlutedGlass（effect:shaders.FlutedGlass） | 全屏条纹玻璃；查shape/angle/frequency/refraction等目录属性，不把它当局部圆角卡片 |
| GlassTiles（effect:shaders.GlassTiles） | 玻璃砖阵列折射，适合背景；tileCount/roundness/intensity按实际目录单位 |
| Crystal | 棱面水晶透镜，强调切面，不能冒充柔和磨砂 |
| 代码滤镜 | shaderFilter("Glass",props)处理素材输入；必要时blur／多点采样＋局部混合＋边光，不把空间模糊叫相机景深 |

Frost是冰霜生成材质，不是模糊现有画面的滤镜。代码shader的Glass只处理其之前的兄弟／children，读不到别的时间线轨道；要处理既有视频就加片段效果／代码滤镜。几何、遮罩、边光、投影共享同一布局参数，移动时一起变；侧转轮廓不能只跟中心与宽高，否则双轮廓。真实三维体积、镜头景深并不从二维玻璃自动得到。

磨砂从Glass.blur约2–6起试，不把20当默认；refraction从.3–.8起试，观察边缘是否把文字拉成重影。先边缘高光再轻投影，同一光向；背景已经暗时用边缘明度差，别堆黑投影。作者blur半径像素、内置模糊强度、Glass.blur是三套量纲。任何参数建议均须试帧。

## 线条、图标与卡片

- path({d或points,stroke,strokeWidth,lineCap,trimStart,trimEnd})；line同样有trim字段，0–1按描边长度裁切，end≥start。只有描边生长，不改变fill。无填充轮廓省略fill；同时画了实体填充就会在描边未长完时显形。
- 单向用trimEnd从0→1，双向用trimStart从.5→0、trimEnd从.5→1，.6–1.2秒expoOut；方向各异的多段图标可各段中间长出，形成统一性。
- path.d只支持绝对M/L/C/Q/Z，不能直接粘贴带相对命令、弧线、滤镜的任意SVG，也没有SVG自动转图标工具。已有真实Logo走image参数；描边图标用已核对路径或项目组件，不手画近似Logo、不用emoji／符号字当图标。
- 一套图标统一线宽、端点与风格。1080p主体图标可300–500px，小图标80–160px，线宽2–4px是起点，缩小帧看清楚再定。
- 圆角卡片rect.radius或radii（1–4项CSS顺序）；圆角16–32px，线宽2–4px，按短边比例统一。文字驱动宽高用measureText，圆角≤高度一半，锚点决定向哪边长。

## 完整样例：透镜质感＋描边引导

默认Glass是球面透镜，示例不声称矩形卡片匹配折射。背景在同一shader树内供透镜处理，标题与生长线在树外保持清晰。文字、色彩、折射、模糊、线条节奏开放参数。

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "玻璃透镜与引导线",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 5, seed: 15,
  parameters: {
    label: {type: "text", title: "透镜说明", default: "看见信息的层次", maxLength: 64},
    accent: {type: "color", title: "引导色", default: [.6,.88,.95,1]},
    refract: {type: "number", title: "折射程度", default: .6, min: 0, max: 2, step: .05},
    frost: {type: "number", title: "磨砂程度", default: 3, min: 0, max: 20, step: .5},
    seconds: {type: "number", title: "线条生长秒数", default: .8, min: .3, max: 1.5, step: .1}
  },
  render(ctx) {
    const p = expoOut(progress(ctx.time, .2, ctx.params.seconds));
    return [
      shader({id: "lens", x: 0, y: 0, width: ctx.width, height: ctx.height,
        time: ctx.time, layers: [
          {type: "SolidColor", props: {color: ctx.style.palette.bg}},
          {type: "Aurora", props: {speed: .25, intensity: 45}},
          {type: "Glass", props: {center: {x: .5, y: .5}, scale: 1,
            refraction: ctx.params.refract, blur: ctx.params.frost,
            thickness: .2, aberration: .08, highlight: .12}}
        ]}),
      path({id: "guide", points: [[ctx.width * .52,ctx.height * .6],
        [ctx.width * .66,ctx.height * .75],[ctx.width * .88,ctx.height * .75]],
        stroke: ctx.params.accent, strokeWidth: 3, lineCap: "round",
        lineJoin: "round", trimEnd: p}),
      text({id: "label", x: ctx.width * .66, y: ctx.height * .8,
        text: ctx.params.label, fontSize: 48, fontWeight: 600,
        maxWidth: ctx.width * .28, wrap: true, color: ctx.params.accent,
        opacity: progress(ctx.time, .2 + ctx.params.seconds * .6, .3)})
    ];
  }
}
```

检查折射前／后背景形状、线条抵达与文字出现的因果，Glass前不要再放清晰标题以免折射毁字。按review全帧、小屏与标注局部看边缘；CPU编译／求值不证明玻璃GPU像素、抗锯齿或长片性能。
