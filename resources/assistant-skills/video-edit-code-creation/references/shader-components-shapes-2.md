# 着色器组件：图形与材质（续）

由脚本从 shaders 4.0.2 生成。代码里写英文组件名；中文名是效果面板名。角色：生成=自己画；滤镜=处理之前画好的图层；转场=剪辑过渡或 layers 里的揭示。⏱ 为速度属性。属性含义与范围读实体 video_edit.builtin_effect（effect:shaders.组件名 / transition:shaders.组件名）。

- **Star** 星形｜生成｜Classic star polygon with straight sides and sharp pointed tips｜origin color center radius sides innerRatio rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Teardrop** 水滴｜生成｜Teardrop — a rounded bulb tapering to a sharp point｜origin color center radius height rotation softness strokeThickness strokeColor strokePosition colorSpace
- **ThinFilm** 薄膜虹彩｜生成｜Iridescent thin-film edge｜origin center scale rotation intensity rimWidth edgeSoftness thickness dispersion saturation hueShift lightAngle mode colorA colorB colorC colorSpace speed⏱ shape
- **Trapezoid** 梯形｜生成｜Trapezoid with adjustable top and bottom widths and height｜origin color center bottomWidth topWidth height rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Vesica** 双圆交集｜生成｜Vesica piscis (lens shape) formed by the intersection of two overlappi…｜origin color center radius spread rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Voxels** 体素｜生成｜Rebuild any shape out of voxels — a flat shape becomes chunky pixel ar…｜origin center scale rotation voxelSize voxelShape voxelScale fill bevel depth gridSpace colorA colorB colorMode colorVariation colorSpace lightAngle lightElevation lightColor lightIntensity ambientColor ambient shadows shadowSoftness ao glossiness specular seams shape
- **Water** 水体｜生成｜Translucent water — a refractive, light-absorbing body that deepens to…｜origin center scale rotation waterColor clarity depth shallows caustics causticScale choppiness waveScale swirl speed⏱ reflection envRotation sharpness lightAngle foam edgeSoftness shape
