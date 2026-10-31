# 着色器组件：风格化与转场

由脚本从 shaders 4.0.2 生成。作为剪辑内置效果使用（片段效果 effect:shaders.组件名）；过渡从 video_edit.builtin_effect 读取整理后的目录与方式，作者代码不直接调用；中文名是效果面板名。角色：生成=画出整幅内容；滤镜=处理片段画面；转场=剪辑过渡。⏱ 为速度属性。属性含义与范围读实体 video_edit.builtin_effect。

- **Chalkboard** 黑板粉笔｜滤镜｜Renders content as a chalk drawing on a blackboard, with edge strokes …｜boardColor chalkColor edgeSensitivity edgeThickness shading hatchScale grain
- **ChromaticAberration** 镜头色差｜滤镜｜Separate RGB channels for a prismatic distortion effect｜strength angle redOffset greenOffset blueOffset
- **CompressionArtifacts** 压缩失真｜滤镜｜Simulates lossy JPEG compression — 8×8 DCT block quantization, blockin…｜quality
- **ContourLines** 等高线｜滤镜｜Draw topographical contour lines based on luminance or alpha｜levels lineWidth softness gamma invert source colorMode lineColor backgroundColor
- **CRTScreen** 显像管屏幕｜滤镜｜Retro CRT monitor simulation with scanlines｜pixelSize colorShift scanlineIntensity scanlineFrequency brightness contrast vignetteIntensity vignetteRadius
- **Dither** 抖动｜滤镜｜Dithering effect with multiple pattern options｜pattern pixelSize threshold spread colorMode colorA colorB
- **DropShadow** 投影｜滤镜｜Adds a soft shadow behind the child content based on its alpha silhoue…｜color distance angle blur intensity cutout
- **Engraving** 铜版雕刻｜滤镜｜Copper-plate line engraving — the image is redrawn as flowing line wor…｜style frequency angle center relief waviness contrast inkColor paperColor
- **FilmGrain** 胶片颗粒（着色器）｜滤镜｜Analog film grain texture overlay, weighted toward darker areas｜strength bias animated
- **Glitch** 故障｜滤镜｜Digital glitch that melts pixels and distorts colors｜intensity speed rgbShift blockDensity colorBarIntensity mirrorAmount scanlineIntensity
- **Glow** 柔光｜滤镜｜Soft glow effect with adjustable intensity｜intensity threshold size
- **GradientMap** 渐变映射｜滤镜｜Maps source luminance through an animated color gradient (Photoshop-st…｜palette colorLow colorMid colorHigh speed contrast blackPoint whitePoint strength colorSpace
- **Halftone** 半调网点｜滤镜｜Halftone dot pattern effect for printing aesthetics｜style frequency angle cyanAngle magentaAngle yellowAngle blackAngle misprint misprintAngle paperColor cyanColor magentaColor yellowColor blackColor
- **LensDistortion** 镜头畸变｜滤镜｜Split content into shifting chromatic layers with barrel or pincushion…｜center spread angle perspective bias count dispersion dispersionShift dispersionColor focusCenter focusEdges lensBulge lensCircle swirl noise noiseFrequency noiseOffset grainMixer grainOverlay
- **LensFlare** 镜头光晕｜生成｜Realistic camera lens flare with artifacts.｜lightPosition intensity ghostIntensity ghostSpread ghostChroma haloIntensity haloRadius haloChroma haloSoftness starburstIntensity starburstPoints streakIntensity streakLength glareIntensity glareSize edgeFade speed⏱
- **LightLeak** 漏光｜滤镜｜Photorealistic film light leak — warm overexposed light bleeding in fr…｜position spread intensity streaks colorHot colorMid colorFringe flicker speed⏱ seed
- **Paper** 纸张质感｜滤镜｜Applies realistic paper grain and surface roughness to child content｜roughness grainScale displacement seed
- **Pixelate** 像素化｜滤镜｜Pixelation effect with adjustable cell size｜scale gap roundness
- **ReflectivePlane** 倒影地面｜滤镜｜Reflective floor that mirrors the content above it｜height distance falloff blur blurDistance edges
- **Sparkle** 闪光点｜滤镜｜Twinkling star glints over the bright parts of the layer inside｜size intensity threshold expand rayLength colorize speed⏱ seed
- **Stone** 石材浮雕｜滤镜｜Applies a marbled stone relief and surface distortion to child content｜intensity scale contrast distortion seed
- **VHS** 录像带｜滤镜｜Analog VHS tape with intermittent tape damage, chroma bleed, and per-s…｜wobble scanlineNoise smear speed
- **Vignette** 暗角（着色器）｜滤镜｜Darkens or tints the edges of the frame, drawing attention toward the …｜color center radius falloff intensity
- **Watercolor** 水彩｜滤镜｜Painterly watercolor look — Kuwahara flattening, pigment edge darkenin…｜radius bleed strength paper paperColor
- **Wool** 毛织物｜滤镜｜Applies an interwoven fibrous fabric texture and distortion to child c…｜intensity scale contrast distortion seed
