# 着色器组件：纹理与背景（续）

由脚本从 shaders 4.0.2 生成。代码里写英文组件名；中文名是效果面板名。角色：生成=自己画；滤镜=处理之前画好的图层；转场=剪辑过渡或 layers 里的揭示。⏱ 为速度属性。属性含义与范围读实体 video_edit.builtin_effect（effect:shaders.组件名 / transition:shaders.组件名）。

- **TriangularGrid** 三角网格｜生成｜Tiling grid of equilateral triangles with optional animated row offsets｜colorA colorB cells thickness rotation softness variation speed⏱ speedVariance colorSpace
- **Truchet** 特鲁谢拼贴｜生成｜Quarter-circle arc tiles that connect to form organic, maze-like flowi…｜colorA colorB cells thickness rotation softness seed colorSpace
- **Voronoi** 泰森多边形｜生成｜Cellular pattern where each pixel is colored by its distance to the ne…｜colorA colorB stops colorBorder scale speed⏱ seed edgeIntensity edgeSoftness colorSpace
- **Waveform** 波形｜生成｜Audio-visualizer waveform — equalizer bars, a filled wave, an oscillos…｜style colorA colorB stops colorSpace from to amplitude frequency height align count barWidth rounding dotSize lineWidth softness speed⏱ seed
- **WaveletNoise** 小波噪声｜生成｜Rotating banded wavelets that ripple as they animate｜colorA colorB stops colorSpace scale detail contrast balance seed speed⏱
- **Weave** 编织｜生成｜Interlaced textile weave pattern with two thread colors going over and…｜colorA colorB cells gap rotation
- **WorleyNoise** 细胞噪声｜生成｜Cellular noise field — distance-based, with selectable feature combina…｜colorA colorB colorSpace scale mode distance octaves lacunarity persistence jitter contrast balance seed speed⏱
