# 着色器组件：风格化与转场

由脚本从 shaders 4.0.2 生成。作为剪辑内置效果使用（片段效果 effect:shaders.组件名）；过渡从 video_edit.builtin_effect 读取整理后的目录与方式，作者代码不直接调用；中文名是效果面板名。角色：生成=画出整幅内容；滤镜=处理片段画面；转场=剪辑过渡。⏱ 为速度属性。属性含义与范围读实体 video_edit.builtin_effect。

- **Chalkboard** 黑板粉笔｜滤镜｜Renders content as a chalk drawing on a blackboard, with edge strokes …｜boardColor chalkColor edgeSensitivity edgeThickness shading hatchScale grain
- **ContourLines** 等高线｜滤镜｜Draw topographical contour lines based on luminance or alpha｜levels lineWidth softness gamma invert source colorMode lineColor backgroundColor
- **Engraving** 铜版雕刻｜滤镜｜Copper-plate line engraving — the image is redrawn as flowing line wor…｜style frequency angle center relief waviness contrast inkColor paperColor
- **LensDistortion** 镜头畸变｜滤镜｜Split content into shifting chromatic layers with barrel or pincushion…｜center spread angle perspective bias count dispersion dispersionShift dispersionColor focusCenter focusEdges lensBulge lensCircle swirl noise noiseFrequency noiseOffset grainMixer grainOverlay
- **ReflectivePlane** 倒影地面｜滤镜｜Reflective floor that mirrors the content above it｜height distance falloff blur blurDistance edges
- **Sparkle** 闪光点｜滤镜｜Twinkling star glints over the bright parts of the layer inside｜size intensity threshold expand rayLength colorize speed⏱ seed
- **Stone** 石材浮雕｜滤镜｜Applies a marbled stone relief and surface distortion to child content｜intensity scale contrast distortion seed
- **Watercolor** 水彩｜滤镜｜Painterly watercolor look — Kuwahara flattening, pigment edge darkenin…｜radius bleed strength paper paperColor
- **Wool** 毛织物｜滤镜｜Applies an interwoven fibrous fabric texture and distortion to child c…｜intensity scale contrast distortion seed
