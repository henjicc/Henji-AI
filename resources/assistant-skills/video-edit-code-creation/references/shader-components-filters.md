# 着色器组件：模糊、扭曲与调色

由脚本从 shaders 4.0.2 生成。作为剪辑内置效果使用（片段效果 effect:shaders.组件名）；过渡从 video_edit.builtin_effect 读取整理后的目录与方式，作者代码不直接调用；中文名是效果面板名。角色：生成=画出整幅内容；滤镜=处理片段画面；转场=剪辑过渡。⏱ 为速度属性。属性含义与范围读实体 video_edit.builtin_effect。

- **Bend** 弯曲屏｜滤镜｜Bends the ends of the frame toward you like a curved display — content…｜strength falloff angle edges
- **FlutedGlass** 条纹玻璃｜滤镜｜Full-screen fluted glass effect — refracts content through repeating c…｜shape angle frequency softness waveAmplitude waveFrequency speed⏱ refraction aberration lightAngle highlight highlightSoftness highlightColor edges
- **Form3D** 立体包裹｜滤镜｜Wraps child content onto a 3D raymarched shape with lighting.｜shape3d center zoom glossiness lighting uvMode speed⏱
- **GlassTiles** 玻璃砖｜滤镜｜Refraction-like distortion in a tile grid pattern｜intensity tileCount rotation roundness
- **Kaleidoscope** 万花筒｜滤镜｜Create a kaleidoscope effect with radial mirrored segments｜center segments angle edges
- **Perspective** 透视旋转｜滤镜｜Rotate the plane in 3D space with pan and tilt｜center pan tilt fov zoom offset edges
- **PolarCoordinates** 极坐标｜滤镜｜Convert rectangular coordinates to polar space｜center wrap radius intensity edges
- **RectangularCoordinates** 直角坐标｜滤镜｜Convert polar coordinates back to rectangular space｜center scale intensity edges
- **Stretch** 拉伸｜滤镜｜Stretch content towards a direction from a center point｜center strength angle falloff edges
