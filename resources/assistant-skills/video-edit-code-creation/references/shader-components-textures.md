# 着色器组件：纹理与背景

由脚本从 shaders 4.0.2 生成。作为剪辑内置效果使用（片段效果 effect:shaders.组件名）；过渡从 video_edit.builtin_effect 读取整理后的目录与方式，作者代码不直接调用；中文名是效果面板名。角色：生成=画出整幅内容；滤镜=处理片段画面；转场=剪辑过渡。⏱ 为速度属性。属性含义与范围读实体 video_edit.builtin_effect。

- **FallingLines** 下落线条｜生成｜Directional falling lines with a leading-to-trailing color fade｜colorA colorB colorSpace angle speed⏱ speedVariance density trailLength balance strokeWidth rounding
- **Marble** 大理石｜生成｜Classic marble swirl and vein texture using noise-warped sine waves｜colorA colorB colorC scale turbulence speed⏱ seed colorSpace
- **Ripples** 波纹｜生成｜Concentric animated ripples emanating from a point｜center colorA colorB speed⏱ frequency softness thickness phase
- **SineWave** 正弦波｜生成｜Animated wave with thickness and softness｜color amplitude frequency speed⏱ angle position thickness softness
- **Spiral** 螺旋｜生成｜Rotating spiral pattern with animated movement｜colorA colorB strokeWidth strokeFalloff softness speed⏱ center scale colorSpace
- **StudioBackground** 影棚背景｜生成｜Multi-light studio background with ambient motion.｜color keyColor keyIntensity keySoftness fillColor fillIntensity fillSoftness fillAngle backColor backIntensity backSoftness brightness vignette center lightTarget wallCurvature ambientIntensity ambientSpeed seed
- **Swirl** 旋涡｜生成｜Flowing swirl pattern with multi-layered noise｜colorA colorB stops speed⏱ detail blend colorSpace
- **Waveform** 波形｜生成｜Audio-visualizer waveform — equalizer bars, a filled wave, an oscillos…｜style colorA colorB stops colorSpace from to amplitude frequency height align count barWidth rounding dotSize lineWidth softness speed⏱ seed
