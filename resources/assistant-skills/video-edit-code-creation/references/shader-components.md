# 着色器组件目录

由 scripts/generate-shader-components.cjs 从 shaders 4.0.2 生成，勿手改。代码里写英文组件名；中文名是效果面板里的名字。

角色：生成＝自己画出画面；滤镜＝处理它之前画好的图层（shader 的 layers 里放在后面，或滤镜素材里 shaderFilter）；转场＝剪辑过渡（kind 为 shaders.组件名），在 layers 里也能当遮罩式揭示用。
属性写组件原名（如 colorA），下划线写法 color_a 也认；带 ⏱ 的是速度属性（time 按“秒×速度”推进，不能做关键帧）。
每个属性的含义、默认值与范围：read_application_entity 读 video_edit.builtin_effect 的 `effect:shaders.<组件名>`（params 里的 description 写了代码属性名）；转场读 `transition:shaders.<组件名>`。

## 纹理与背景（Textures）

- **Aurora** 极光｜生成｜Mesmerizing aurora borealis with layered curtains, vertical rays, and flowing light.｜colorA colorB colorC colorSpace balance intensity curtainCount speed⏱ waviness rayDensity height center seed
- **Beam** 光束｜生成｜A beam of light from one point to another.｜startPosition endPosition startThickness endThickness startSoftness endSoftness insideColor outsideColor colorSpace
- **Blob** 流体团｜生成｜Organic animated blob with 3D lighting and gradients｜origin colorA colorB stops size deformation softness highlightIntensity highlightX highlightY highlightZ highlightColor speed⏱ seed center colorSpace
- **BlockNoise** 方块噪声｜生成｜Blocky value noise with soft cells that morph over time｜colorA colorB stops colorSpace scale contrast balance seed speed⏱
- **BlueNoise** 蓝噪声｜生成｜High-frequency blue noise — even, grainy speckle ideal for dithering｜colorA colorB stops colorSpace grain contrast balance seed
- **BrickPattern** 砖墙｜生成｜Classic brick wall pattern with alternating rows and mortar gaps｜colorBrick colorMortar cellsX cellsY mortar softness variation rotation speed⏱ offset speedVariance seed colorSpace
- **Checkerboard** 棋盘格｜生成｜Classic checkerboard pattern with two alternating colors｜colorA colorB cells softness colorSpace
- **Chevron** 人字纹｜生成｜Animated chevron / zigzag stripe pattern｜colorA colorB count angle balance softness speed⏱ offset colorSpace
- **ColorWheel** 色轮渐变｜生成｜A directional gradient that smoothly cycles through rainbow colors or a custom set of three colors｜mode colorA colorB colorC scale angle speed⏱ colorSpace
- **ConicGradient** 角向渐变｜生成｜Colors sweep in a full circle around a center point, like a color wheel｜colorA colorB stops center rotation repeat colorSpace
- **CurlNoise** 旋流噪声｜生成｜Swirling divergence-free flow field that drifts over time｜colorA colorB stops colorSpace scale contrast balance seed speed⏱
- **DiamondGradient** 菱形渐变｜生成｜Diamond-shaped gradient radiating from a center point using Manhattan distance｜colorA colorB stops center size rotation repeat roundness colorSpace
- **DotGrid** 点阵｜生成｜Grid of dots with optional twinkling animation｜color density dotSize offset speed⏱ speedVariance twinkle
- **ErosionNoise** 侵蚀纹｜生成｜Branching, hydraulic-erosion ridges carved into noise｜colorA colorB stops colorSpace scale contrast balance seed
- **FallingLines** 下落线条｜生成｜Directional falling lines with a leading-to-trailing color fade｜colorA colorB colorSpace angle speed⏱ speedVariance density trailLength balance strokeWidth rounding
- **FlowingGradient** 流动渐变｜生成｜Liquid silk gradient with organic flowing color bands｜colorA colorB colorC colorD colorSpace speed⏱ distortion seed
- **FractalNoise** 分形噪声｜生成｜Multi-octave fractal Brownian motion noise texture with true noise evolution｜colorA colorB stops octaves detail contrast speed⏱ angle seed colorSpace
- **GaborNoise** 指纹噪声｜生成｜Oriented sine-grain noise with a fingerprint-like flow｜colorA colorB stops colorSpace scale frequency contrast balance seed speed⏱
- **Godrays** 体积光｜生成｜Volumetric light rays emanating from a point｜center density intensity spotty speed⏱ rayColor backgroundColor
- **Grid** 线框网格｜生成｜Simple grid lines pattern with adjustable thickness and rotation｜color cellColor cells thickness rotation softness variation colorSpace
- **HexGrid** 蜂窝网格｜生成｜Honeycomb hexagonal grid pattern｜colorA colorB cells thickness rotation softness variation colorSpace
- **IsometricCubes** 等距立方｜生成｜Isometric tumbling-blocks tiling — a 3D cube illusion (rhombille pattern)｜colorA colorB lineColor cells thickness rotation softness colorVariation colorSpace
- **LinearGradient** 线性渐变｜生成｜Create smooth linear color gradients｜colorA colorB stops start end angle edges colorSpace
- **Marble** 大理石｜生成｜Classic marble swirl and vein texture using noise-warped sine waves｜colorA colorB colorC scale turbulence speed⏱ seed colorSpace
- **MeshGradient** 网格渐变｜生成｜Flowing mesh gradient of soft drifting color swaths whose seams wrap through the palette｜colorA colorB stops colorSpace count smoothness variation swirl drift wrapping speed⏱ seed
- **MultiPointGradient** 多点渐变｜生成｜Five individually placed color points blended together by proximity — drag each point to shape the gradient｜colorA positionA colorB positionB colorC positionC colorD positionD colorE positionE colorSpace smoothness
- **PerlinNoise** 柏林噪声｜生成｜Smooth gradient noise that morphs over time｜colorA colorB stops colorSpace scale contrast balance seed speed⏱
- **Plasma** 等离子｜生成｜Animated effect of glowing plasma｜density speed⏱ intensity warp contrast balance colorA colorB stops colorSpace
- **Prism** 棱镜｜生成｜A beam of light that fans out and splits into a slowly-rotating rainbow past a controllable point.｜position beamWidth intensity beamColor startFalloff endFalloff splitPosition spread softness saturation speed⏱
- **RadialGradient** 径向渐变｜生成｜Radial gradient radiating from a center point｜colorA colorB stops center radius repeat aspect skewAngle colorSpace
- **Ripples** 波纹｜生成｜Concentric animated ripples emanating from a point｜center colorA colorB speed⏱ frequency softness thickness phase
- **Scratches** 划痕｜生成｜Fine hairline scratches, like a worn film or scratched surface｜colorA colorB scale thickness seed speed⏱
- **SimplexNoise** 单形噪声｜生成｜Organic noise with animated movement｜colorA colorB stops colorSpace scale balance contrast seed speed⏱
- **SineWave** 正弦波｜生成｜Animated wave with thickness and softness｜color amplitude frequency speed⏱ angle position thickness softness
- **SolidColor** 纯色｜生成｜Fill the canvas with a single solid color｜color
- **Spiral** 螺旋｜生成｜Rotating spiral pattern with animated movement｜colorA colorB strokeWidth strokeFalloff softness speed⏱ center scale colorSpace
- **Strands** 光丝｜生成｜Flowing ribbons of light with a multi-color gradient｜speed⏱ amplitude frequency lineCount lineWidth softness spread pinEdges stops colorSpace colorScale colorVariance colorSpeed start end
- **Stripes** 条纹｜生成｜Alternating colored stripes with animation｜colorA colorB angle density balance softness speed⏱ offset colorSpace
- **StudioBackground** 影棚背景｜生成｜Multi-light studio background with ambient motion.｜color keyColor keyIntensity keySoftness fillColor fillIntensity fillSoftness fillAngle backColor backIntensity backSoftness brightness vignette center lightTarget wallCurvature ambientIntensity ambientSpeed seed
- **SunBurst** 放射光芒｜生成｜Radial sunburst rays emanating from a center point｜color background center rayCount softness radius feather speed⏱
- **Swirl** 旋涡｜生成｜Flowing swirl pattern with multi-layered noise｜colorA colorB stops speed⏱ detail blend colorSpace
- **TriangularGrid** 三角网格｜生成｜Tiling grid of equilateral triangles with optional animated row offsets｜colorA colorB cells thickness rotation softness variation speed⏱ speedVariance colorSpace
- **Truchet** 特鲁谢拼贴｜生成｜Quarter-circle arc tiles that connect to form organic, maze-like flowing curves｜colorA colorB cells thickness rotation softness seed colorSpace
- **Voronoi** 泰森多边形｜生成｜Cellular pattern where each pixel is colored by its distance to the nearest of many scattered points｜colorA colorB stops colorBorder scale speed⏱ seed edgeIntensity edgeSoftness colorSpace
- **Waveform** 波形｜生成｜Audio-visualizer waveform — equalizer bars, a filled wave, an oscilloscope line, or a dot matrix — driven by a simulated signal whose amp…｜style colorA colorB stops colorSpace from to amplitude frequency height align count barWidth rounding dotSize lineWidth softness speed⏱ seed
- **WaveletNoise** 小波噪声｜生成｜Rotating banded wavelets that ripple as they animate｜colorA colorB stops colorSpace scale detail contrast balance seed speed⏱
- **Weave** 编织｜生成｜Interlaced textile weave pattern with two thread colors going over and under each other｜colorA colorB cells gap rotation
- **WorleyNoise** 细胞噪声｜生成｜Cellular noise field — distance-based, with selectable feature combinations and fractal octaves｜colorA colorB colorSpace scale mode distance octaves lacunarity persistence jitter contrast balance seed speed⏱

## 图形（Shapes）

- **Arc** 扇形｜生成｜Pie sector (arc wedge) with adjustable radius and aperture angle｜origin color center radius aperture rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Circle** 圆形｜生成｜Generate a circle with adjustable size and softness｜origin color radius softness center strokeThickness strokeColor strokePosition colorSpace
- **Crescent** 月牙｜生成｜Crescent moon shape — an outer circle with an inner circle subtracted｜origin color center radius innerRatio offset rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Cross** 十字｜生成｜Plus / cross shape with adjustable arm length, width, and rounding｜origin color center radius thickness rounding rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Ellipse** 椭圆｜生成｜Ellipse with independently adjustable horizontal and vertical radii｜origin color center radiusX radiusY rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Flower** 花瓣｜生成｜Petal shape with N lobes and adjustable inner-to-outer radius ratio｜origin color center radius sides innerRatio rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Heart** 心形｜生成｜Heart shape with adjustable size｜origin color center radius rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Line** 线条｜生成｜Draw a straight line between two points with color, thickness, and solid, dashed, or dotted styles｜color pointA pointB thickness style dashLength gapLength capStart capEnd
- **Parallelogram** 平行四边形｜生成｜Parallelogram with adjustable width, height and skew｜origin color center width height skew rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Polygon** 正多边形｜生成｜Regular polygon with adjustable sides and corner rounding｜origin color center radius sides rounding rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Ring** 圆环｜生成｜Annular ring (donut) with adjustable radius and band thickness｜origin color center radius thickness softness strokeThickness strokeColor strokePosition colorSpace
- **RoundedRect** 圆角矩形｜生成｜Rounded rectangle with adjustable width, height, and corner rounding｜origin color center width height rounding rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Star** 星形｜生成｜Classic star polygon with straight sides and sharp pointed tips｜origin color center radius sides innerRatio rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Teardrop** 水滴｜生成｜Teardrop — a rounded bulb tapering to a sharp point｜origin color center radius height rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Trapezoid** 梯形｜生成｜Trapezoid with adjustable top and bottom widths and height｜origin color center bottomWidth topWidth height rotation softness strokeThickness strokeColor strokePosition colorSpace
- **Vesica** 双圆交集｜生成｜Vesica piscis (lens shape) formed by the intersection of two overlapping circles｜origin color center radius spread rotation softness strokeThickness strokeColor strokePosition colorSpace

## 材质（作用于形状）（Shape Effects）

- **BrushedMetal** 拉丝金属｜生成｜Photorealistic brushed metal — a satin anodised surface combed with fine directional grain that smears the reflected studio and key light…｜origin center scale rotation lightColor darkColor brushAngle anisotropy grain grainScale roughness environment envRotation lightAngle speed⏱ bevelWidth bevelShape edgeSoftness shape
- **CarbonFiber** 碳纤维｜生成｜Photorealistic woven carbon fibre — interlaced tows whose anisotropic sheen flips ninety degrees cell to cell, raised into a quilted weav…｜origin center scale rotation lightColor darkColor weaveStyle weaveScale weaveAngle relief fiberSheen roughness clearcoat environment envRotation lightAngle bevelWidth bevelShape edgeSoftness shape
- **Chrome** 镜面铬｜生成｜Studio-lit mirror chrome — a precision-machined shape with a controllable polished bevel, softly convex faces and a photographic studio r…｜origin center scale rotation tint warmColor coolColor bevelWidth bevelShape curvature waviness environment envRotation softness spectral dispersion shadows speed⏱ edgeSoftness shape
- **Crystal** 水晶｜滤镜｜Diamond-like crystal lens with faceted refraction.｜origin center scale rotation cutout refraction dispersion facets fresnel fresnelSoftness fresnelColor edgeSoftness innerZoom lightAngle highlights shadows brightness tintColor tintIntensity tintPreserveLuminosity shape
- **Emboss** 浮雕｜滤镜｜Embossed / debossed relief shading on top of child content, driven by a custom shape｜origin center scale rotation depth lightAngle lightIntensity shadowIntensity shape
- **Frost** 冰霜｜生成｜Photoreal frozen ice — thickness-driven subsurface scattering that reads as a solid block, with fine frost crystals creeping in from the …｜origin center scale rotation iceColor ambient edgeSoftness density absorption scatter frostAmount frostDepth frostScale frostRoughness sparkle gloss fresnel lightAngle speed⏱ shape
- **Glass** 玻璃透镜｜滤镜｜Optically realistic glass lens driven in a custom shape｜origin center scale rotation cutout refraction edgeSoftness blur thickness aberration innerZoom lightAngle highlight highlightColor highlightSoftness fresnel fresnelSoftness fresnelColor tintColor tintIntensity tintPreserveLuminosity shape
- **Goo** 液体｜生成｜Photoreal wet liquid — animated 3D metaball blobs that merge and bulge to loosely form the shape, with sliding wet highlights, a clearcoa…｜origin center scale rotation gooColor translucency absorb containment edgeSoftness blobScale spread merge bulge threshold lightAngle wetness fresnel specColor ambient speed⏱ wobble breathe seed shape
- **Heatmap** 热成像｜生成｜Thermal-camera heat flowing through any 2D, SVG, or 3D shape.｜origin center scale rotation colorA colorB stops colorSpace innerGlow outerGlow contour angle speed⏱ shape
- **Hologram** 全息投影｜生成｜Volumetric sci-fi hologram — a translucent emissive projection of the shape with fresnel-lit edges, depth scan-lines that wrap 3D forms, …｜origin center scale rotation color brightness edgeSoftness fill edgeGlow depthLines depthScale scanlines scanlineScale scanlineSpeed sweep flicker distortion grain speed⏱ shape
- **Holographic** 镭射贴纸｜生成｜Iridescent holographic foil sticker with animated rainbow sheen and glitter flakes｜origin center scale rotation hueShift foilScale saturation roughness speed⏱ crinkle crinkleScale sparkle edgeSoftness shape
- **LightEdge** 边缘流光｜生成｜Glowing, pulsing light racing around the edge of any 2D, SVG, or 3D shape.｜origin center scale rotation colorA colorB stops colorSpace thickness softness intensity bloom spots spotSize pulse smoke smokeSize speed⏱ seed shape
- **LiquidMetal** 液态金属｜生成｜Flowing liquid chrome — a molten reflective surface that wraps the shape, sweeping a procedural studio reflection across animated folds w…｜origin center scale rotation lightColor darkColor turbulence ripple warp speed⏱ environment envRotation sharpness dispersion lightAngle bevelWidth bevelShape edgeSoftness shape
- **Nebula** 星云｜生成｜A volumetric gas nebula sealed inside polished glass; billowing emission clouds with hollow dark cavities and hot glowing cores, star fie…｜origin center scale rotation coreColor gasColor veilColor colorSpace density cavity dust gasScale billow glow seed stars starScale twinkle refraction environment highlight highlightSoftness lightAngle edgeSoftness speed⏱ shape
- **Neon** 霓虹灯管｜生成｜Photorealistic neon tube / 3D pipe effect driven by a custom shape｜origin center scale rotation color secondaryColor secondaryBlend glowColor tubeThickness intensity hotCoreIntensity glowIntensity glowRadius lightAngle specularIntensity specularSize cornerSmoothing flickerSpeed flickerAmount flowSpeed flowAmount shape
- **Obsidian** 黑曜石｜生成｜Dark tinted glass whose faces stay near-black while every surface turning away from the viewer ignites with a flowing iridescent gradient…｜origin center scale rotation bodyColor colorA colorB stops colorSpace iridescence rimWidth rimSoftness flowAngle flowScale speed⏱ gloss envRotation bevelWidth bevelShape edgeSoftness shape
- **Plastic** 塑料｜生成｜Glossy molded plastic with photorealistic studio reflections, driven in a custom shape｜origin center scale rotation colorA colorB stops gradientAngle colorSpace thickness roughness reflectivity crumple crumpleScale crumpleCoverage seed edgeSoftness lightAngle speed⏱ shading rim rimColor shape
- **ThinFilm** 薄膜虹彩｜生成｜Iridescent thin-film edge｜origin center scale rotation intensity rimWidth edgeSoftness thickness dispersion saturation hueShift lightAngle mode colorA colorB colorC colorSpace speed⏱ shape
- **Voxels** 体素｜生成｜Rebuild any shape out of voxels — a flat shape becomes chunky pixel art, a 3D shape a lit voxel model with smooth ambient occlusion, cast…｜origin center scale rotation voxelSize voxelShape voxelScale fill bevel depth gridSpace colorA colorB colorMode colorVariation colorSpace lightAngle lightElevation lightColor lightIntensity ambientColor ambient shadows shadowSoftness ao glossiness specular seams shape
- **Water** 水体｜生成｜Translucent water — a refractive, light-absorbing body that deepens to its color with thickness, wrapped in a wind-driven wave surface th…｜origin center scale rotation waterColor clarity depth shallows caustics causticScale choppiness waveScale swirl speed⏱ reflection envRotation sharpness lightAngle foam edgeSoftness shape

## 模糊（Blurs）

- **AngularBlur** 旋转模糊｜滤镜｜Radial motion blur rotating around a center point｜intensity center
- **Blur** 高斯模糊（着色器）｜滤镜｜A simple Gaussian blur effect｜intensity
- **BokehBlur** 镜头虚化｜滤镜｜Photographic lens blur where bright highlights bloom into aperture-shaped discs｜radius highlightGain highlightThreshold bladeShape bladeCount bladeRotation chromaticFringe
- **ChannelBlur** 分通道模糊｜滤镜｜Independent blur for red, green, and blue channels｜redIntensity greenIntensity blueIntensity
- **DiffuseBlur** 扩散模糊｜滤镜｜Grain-like pixel displacement at random｜intensity edges
- **LinearBlur** 方向模糊（着色器）｜滤镜｜Directional motion blur in a specific angle｜intensity angle
- **ProgressiveBlur** 渐进模糊｜滤镜｜Blur that increases progressively in one direction｜intensity angle center falloff
- **TiltShift** 移轴｜滤镜｜Selective focus blur mimicking tilt-shift photography｜intensity width falloff angle center
- **ZoomBlur** 缩放模糊（着色器）｜滤镜｜Radial zoom blur expanding from a center point｜intensity center

## 扭曲变形（Distortions）

- **BarShift** 条带错位｜滤镜｜Slices content into parallel bars, each offset independently for a fractured or glitch-like effect｜count angle intensity seed speed⏱ edges
- **Bend** 弯曲屏｜滤镜｜Bends the ends of the frame toward you like a curved display — content at the edges swells closer under real perspective, or curls away w…｜strength falloff angle edges
- **Bulge** 膨胀收缩｜滤镜｜Magnify or pinch content around a center point｜center strength radius falloff edges
- **ConcentricSpin** 同心旋转｜滤镜｜Concentric rings that each rotate the underlying image by different amounts｜intensity rings smoothness seed speed⏱ speedRandomness edges center
- **CornerPin** 边角定位｜滤镜｜Pin each corner of the content to an arbitrary position for a free perspective warp｜topLeft topRight bottomLeft bottomRight amount edges
- **DisplacementMap** 置换贴图｜滤镜｜Distorts child content using another layer's pixels as a displacement map｜source amount channelMode angle edges
- **Flip** 翻转｜滤镜｜Mirror content horizontally, vertically, or both｜flipX flipY
- **FlowField** 流场扭曲｜滤镜｜Fluid-like distortion with constant smooth motion｜strength detail speed⏱ evolutionSpeed seed edges
- **FlutedGlass** 条纹玻璃｜滤镜｜Full-screen fluted glass effect — refracts content through repeating cylindrical bars｜shape angle frequency softness waveAmplitude waveFrequency speed⏱ refraction aberration lightAngle highlight highlightSoftness highlightColor edges
- **Form3D** 立体包裹｜滤镜｜Wraps child content onto a 3D raymarched shape with lighting.｜shape3d center zoom glossiness lighting uvMode speed⏱
- **GlassTiles** 玻璃砖｜滤镜｜Refraction-like distortion in a tile grid pattern｜intensity tileCount rotation roundness
- **Kaleidoscope** 万花筒｜滤镜｜Create a kaleidoscope effect with radial mirrored segments｜center segments angle edges
- **Mirror** 镜像｜滤镜｜Mirror content across a line defined by center point and angle｜center angle edges
- **Perspective** 透视旋转｜滤镜｜Rotate the plane in 3D space with pan and tilt｜center pan tilt fov zoom offset edges
- **PolarCoordinates** 极坐标｜滤镜｜Convert rectangular coordinates to polar space｜center wrap radius intensity edges
- **RectangularCoordinates** 直角坐标｜滤镜｜Convert polar coordinates back to rectangular space｜center scale intensity edges
- **Repeater** 重复阵列｜滤镜｜Repeat the child content in grid, radial or linear layouts with per-instance variation｜mode cropLeft cropRight cropTop cropBottom columns rows gapX gapY stagger flip count radius startAngle sweep faceCenter direction spacing instanceScale instanceRotation instanceOpacity hueShift phase zOrder jitterPosition jitterRotation jitterScale jitterOpacity seed
- **Spherize** 球面化｜滤镜｜Map content onto a 3D sphere surface with depth distortion｜radius depth center lightPosition lightIntensity lightSoftness lightColor
- **Stretch** 拉伸｜滤镜｜Stretch content towards a direction from a center point｜center strength angle falloff edges
- **Twirl** 旋转扭曲｜滤镜｜Rotate and twist content around a center point｜center intensity edges
- **WaveDistortion** 波浪扭曲｜滤镜｜Wave-based distortion with multiple waveform types｜strength frequency speed⏱ angle waveType edges

## 调色（Adjustments）

- **BrightnessContrast** 亮度与对比度（着色器）｜滤镜｜Adjust brightness and contrast of the image｜brightness contrast
- **Duotone** 双色调｜滤镜｜Map colors to two tones based on luminance｜colorA colorB blend colorSpace
- **Exposure** 曝光（着色器）｜滤镜｜Multiplicative exposure (gain) on the child.｜exposure
- **FilmStock** 胶片模拟｜滤镜｜Real analog film color from measured film-emulation LUTs — ten classic stock looks with emulsion halation and projector gate weave｜stock strength halation halationRadius weave
- **Grayscale** 黑白｜滤镜｜Convert colors to black and white｜
- **HueShift** 色相旋转｜滤镜｜Rotate hue around the color wheel｜shift
- **Invert** 反相｜滤镜｜Invert RGB colors while preserving alpha｜
- **Posterize** 色调分离｜滤镜｜Reduce color depth to create a poster effect｜intensity
- **Saturation** 饱和度（着色器）｜滤镜｜Adjust color saturation intensity｜intensity
- **Sharpness** 锐度｜滤镜｜Adjust image sharpness using a convolution kernel｜sharpness
- **Solarize** 负感｜滤镜｜Inverts tones above a luminance threshold — a classic darkroom and photo effect｜threshold strength
- **Tint** 着色｜滤镜｜Apply a color tint to the image｜color amount preserveLuminosity
- **Tritone** 三色调｜滤镜｜Map colors to three tones: shadows, midtones, highlights｜colorA colorB colorC blendMid colorSpace
- **Vibrance** 自然饱和度｜滤镜｜Selective saturation adjustment protecting skin tones｜intensity

## 风格化（Stylize）

- **Chalkboard** 黑板粉笔｜滤镜｜Renders content as a chalk drawing on a blackboard, with edge strokes and cross-hatch shading｜boardColor chalkColor edgeSensitivity edgeThickness shading hatchScale grain
- **ChromaticAberration** 镜头色差｜滤镜｜Separate RGB channels for a prismatic distortion effect｜strength angle redOffset greenOffset blueOffset
- **CompressionArtifacts** 压缩失真｜滤镜｜Simulates lossy JPEG compression — 8×8 DCT block quantization, blockiness, ringing and color bleed｜quality
- **ContourLines** 等高线｜滤镜｜Draw topographical contour lines based on luminance or alpha｜levels lineWidth softness gamma invert source colorMode lineColor backgroundColor
- **CRTScreen** 显像管屏幕｜滤镜｜Retro CRT monitor simulation with scanlines｜pixelSize colorShift scanlineIntensity scanlineFrequency brightness contrast vignetteIntensity vignetteRadius
- **Dither** 抖动｜滤镜｜Dithering effect with multiple pattern options｜pattern pixelSize threshold spread colorMode colorA colorB
- **DropShadow** 投影｜滤镜｜Adds a soft shadow behind the child content based on its alpha silhouette｜color distance angle blur intensity cutout
- **Engraving** 铜版雕刻｜滤镜｜Copper-plate line engraving — the image is redrawn as flowing line work whose weight swells with darkness, lines displaced by the form li…｜style frequency angle center relief waviness contrast inkColor paperColor
- **FilmGrain** 胶片颗粒（着色器）｜滤镜｜Analog film grain texture overlay, weighted toward darker areas｜strength bias animated
- **Glitch** 故障｜滤镜｜Digital glitch that melts pixels and distorts colors｜intensity speed rgbShift blockDensity colorBarIntensity mirrorAmount scanlineIntensity
- **Glow** 柔光｜滤镜｜Soft glow effect with adjustable intensity｜intensity threshold size
- **GradientMap** 渐变映射｜滤镜｜Maps source luminance through an animated color gradient (Photoshop-style gradient map)｜palette colorLow colorMid colorHigh speed contrast blackPoint whitePoint strength colorSpace
- **Halftone** 半调网点｜滤镜｜Halftone dot pattern effect for printing aesthetics｜style frequency angle cyanAngle magentaAngle yellowAngle blackAngle misprint misprintAngle paperColor cyanColor magentaColor yellowColor blackColor
- **LensDistortion** 镜头畸变｜滤镜｜Split content into shifting chromatic layers with barrel or pincushion lens warp.｜center spread angle perspective bias count dispersion dispersionShift dispersionColor focusCenter focusEdges lensBulge lensCircle swirl noise noiseFrequency noiseOffset grainMixer grainOverlay
- **LensFlare** 镜头光晕｜生成｜Realistic camera lens flare with artifacts.｜lightPosition intensity ghostIntensity ghostSpread ghostChroma haloIntensity haloRadius haloChroma haloSoftness starburstIntensity starburstPoints streakIntensity streakLength glareIntensity glareSize edgeFade speed⏱
- **LightLeak** 漏光｜滤镜｜Photorealistic film light leak — warm overexposed light bleeding in from a draggable anchor point, with streak bands, chromatic fringing,…｜position spread intensity streaks colorHot colorMid colorFringe flicker speed⏱ seed
- **Paper** 纸张质感｜滤镜｜Applies realistic paper grain and surface roughness to child content｜roughness grainScale displacement seed
- **Pixelate** 像素化｜滤镜｜Pixelation effect with adjustable cell size｜scale gap roundness
- **ReflectivePlane** 倒影地面｜滤镜｜Reflective floor that mirrors the content above it｜height distance falloff blur blurDistance edges
- **Sparkle** 闪光点｜滤镜｜Twinkling star glints over the bright parts of the layer inside｜size intensity threshold expand rayLength colorize speed⏱ seed
- **Stone** 石材浮雕｜滤镜｜Applies a marbled stone relief and surface distortion to child content｜intensity scale contrast distortion seed
- **VHS** 录像带｜滤镜｜Analog VHS tape with intermittent tape damage, chroma bleed, and per-scanline noise｜wobble scanlineNoise smear speed
- **Vignette** 暗角（着色器）｜滤镜｜Darkens or tints the edges of the frame, drawing attention toward the center｜color center radius falloff intensity
- **Watercolor** 水彩｜滤镜｜Painterly watercolor look — Kuwahara flattening, pigment edge darkening, paper grain and bleeding｜radius bleed strength paper paperColor
- **Wool** 毛织物｜滤镜｜Applies an interwoven fibrous fabric texture and distortion to child content｜intensity scale contrast distortion seed

## 转场（Transitions）

- **BarnDoors** 对开门｜转场｜Split the content along a center line and wipe outward in both directions｜progress angle feather invert
- **BlockDissolve** 方块溶解｜转场｜Dissolve the content away as a grid of blocks vanishing in random order｜progress blockSize softness invert
- **CheckerWipe** 棋盘擦除｜转场｜Wipe the content away as a checkerboard of fading squares｜progress blockSize softness invert
- **DiamondWipe** 菱形擦除｜转场｜Wipe the content away through a lattice of growing diamonds｜progress size feather invert
- **IrisWipe** 圆形揭示（着色器）｜转场｜Reveal through an expanding circle growing from a center point｜progress center feather invert
- **LinearWipe** 线性擦除｜转场｜Wipe the content away along a straight edge with a soft feathered transition｜progress angle feather invert
- **NoiseDissolve** 噪声溶解｜转场｜Dissolve the content away through an organic noise pattern｜progress scale softness seed invert
- **PagePeel** 翻页｜转场｜Curl the content up from a corner like a peeling page｜corner amount radius shading highlight highlightSoftness shadow
- **RadialWipe** 时钟擦除｜转场｜Sweep the content away in a clock-hand arc around a center point｜progress startAngle direction center feather invert
- **RandomBars** 随机条带｜转场｜Wipe the content away as parallel bars vanishing in random order｜progress angle barCount softness invert
- **RippleWipe** 涟漪擦除｜转场｜Wipe the content away in concentric rings pulsing out from a center point｜progress center rings feather invert
- **SliceWipe** 切片擦除｜转场｜Slice the content into strips that slide away in alternating directions｜progress angle sliceCount
- **VenetianBlinds** 百叶窗｜转场｜Wipe the content away behind a set of parallel closing strips｜progress angle stripCount feather invert

## 工具（Utilities）

- **Group** 分组｜分组｜Container for organizing and composing child effects — supports flex-like flow layout (column/row stacking via the flow prop)｜
