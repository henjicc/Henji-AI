// 由 scripts/generate-author-effects.ts 生成，请修改效果登记后重新生成。
export interface BlurParams {
  /** 模糊度；画面糊得多厉害。0 不模糊；10 轻微柔化；40（默认）背景虚化，约为画面高度的 1%；70 只剩大块颜色。各方式下糊的程度相近；旋转按转过的角度算，40 约 18°，100 约 45°。可以输入更大的值。；默认 40；常用 0–100；硬范围 0–450；单位 strength；可动画 true */
  readonly amount?: number
  /** 方式；均匀（默认）整体柔化；方向沿一个角度拉出拖影；放射从中心向四周拉丝；旋转让画面绕中心转着糊开，像转盘、车轮；镜头像失焦，亮点散成圆形光斑。；默认 "uniform"；可动画 true */
  readonly mode?: "uniform" | "directional" | "radial" | "spin" | "lens"
  /** 模糊方向；只往哪个方向糊。水平和垂直（默认）各方向一样；只选水平或垂直时，另一个方向保持清楚。；默认 "both"；显隐 {"all":[{"param":"mode","in":["uniform"]},{"param":"range","equals":"full"}]}；可动画 true */
  readonly axis?: "both" | "horizontal" | "vertical"
  /** 角度；拖影的方向。0（默认）左右拉，90 上下拉，45 斜着拉。；默认 0；硬范围 -180–180；单位 degrees；显隐 {"param":"mode","in":["directional"]}；可动画 true */
  readonly angle?: number
  /** 中心（水平）；放射、旋转的中心。默认在画面正中；挪到主体上，主体保持清楚，四周向外拉丝或绕着它转。；默认 50；硬范围 0–100；单位 percent；显隐 {"param":"mode","in":["radial","spin"]}；可动画 true */
  readonly center_x?: number
  /** 中心（垂直）；中心的上下位置，0 在顶边，100 在底边。；默认 50；硬范围 0–100；单位 percent；显隐 {"param":"mode","in":["radial","spin"]}；可动画 true */
  readonly center_y?: number
  /** 亮点加亮；亮点散开后有多亮。0 亮点和其他地方一样被抹平；50（默认）亮点散成明显的圆形光斑；100 光斑更亮更醒目。；默认 50；硬范围 0–100；单位 strength；显隐 {"param":"mode","in":["lens"]}；可动画 true */
  readonly highlights?: number
  /** 重复边缘像素；画面边缘外面当作什么来糊。打开（默认）沿用边缘的颜色，整幅画面的四边不会发黑变透明；关闭时外面当作透明，给文字、图形加模糊时边缘自然淡出。；默认 true；可动画 true */
  readonly repeat_edges?: boolean
  /** 范围；哪里糊、哪里清楚。整幅（默认）处处一样；渐进从“位置”开始沿“角度”越来越糊；移轴只留一条清楚的带，两边渐糊，像微缩模型。；默认 "full"；分组 范围；显隐 {"param":"mode","in":["uniform","lens"]}；可动画 true */
  readonly range?: "full" | "progressive" | "tilt"
  /** 位置（水平）；渐进从哪里开始变糊，移轴清楚带的中心。50%、50%（默认）在正中；可以输入画面外的值。；默认 50；常用 0–100；硬范围 -100–200；单位 percent；分组 范围；显隐 {"all":[{"param":"mode","in":["uniform","lens"]},{"param":"range","notEquals":"full"}]}；可动画 true */
  readonly range_x?: number
  /** 位置（垂直）；位置的上下，0% 在顶边，100% 在底边。；默认 50；常用 0–100；硬范围 -100–200；单位 percent；分组 范围；显隐 {"all":[{"param":"mode","in":["uniform","lens"]},{"param":"range","notEquals":"full"}]}；可动画 true */
  readonly range_y?: number
  /** 角度；越来越糊的方向。90°（默认）渐进往下加重、移轴是一条水平带；0° 往右加重、带是竖的。；默认 90；硬范围 -180–180；单位 degrees；分组 范围；显隐 {"all":[{"param":"mode","in":["uniform","lens"]},{"param":"range","notEquals":"full"}]}；可动画 true */
  readonly range_angle?: number
  /** 清晰范围；移轴时清楚的带有多宽。30%（默认）约画面高度的三成；10% 只剩一窄条，微缩感最强。；默认 30；硬范围 0–100；单位 percent；分组 范围；显隐 {"all":[{"param":"mode","in":["uniform","lens"]},{"param":"range","equals":"tilt"}]}；可动画 true */
  readonly range_width?: number
  /** 过渡；从清楚到最糊经过多远。40%（默认）柔和；10% 很快糊到底；100% 拉满整个画面慢慢变。；默认 40；硬范围 0–100；单位 percent；分组 范围；显隐 {"all":[{"param":"mode","in":["uniform","lens"]},{"param":"range","notEquals":"full"}]}；可动画 true */
  readonly range_falloff?: number
}

export interface SharpenParams {
  /** 锐化量；边缘加强多少。0 不锐化；30（默认）自然的清晰度；60 明显锐利；100 以上容易出白边和噪点，可以输入到 200。；默认 30；常用 0–100；硬范围 0–200；单位 strength；可动画 true */
  readonly amount?: number
  /** 半径；加强多粗的细节。30（默认）只加强细小纹理；0 连发丝和噪点一起加强；70 以上加强大块明暗，画面更有立体感。；默认 30；硬范围 0–100；单位 strength；分组 细节；可动画 true */
  readonly radius?: number
  /** 阈值；明暗差多小的地方不锐化。0（默认）全部锐化；10–20 天空、皮肤这类平坦处不出噪点，只加强真正的边缘。；默认 0；硬范围 0–100；单位 strength；分组 细节；可动画 true */
  readonly threshold?: number
}

export interface ColorGradeParams {
  /** 色温；白平衡校正（开尔文）：写入画面光源的色温即可让白色物体还原中性。6500 不变；数值越低画面越冷（校正钨丝灯 3200 K 的暖光写 3200），越高越暖（阴天/阴影 7500–9000）。常用 2800–10000。先调白平衡与曝光，再调反差和色彩。；默认 6500；硬范围 2000–20000；单位 kelvin；可动画 true */
  readonly temperature_kelvin?: number
  /** 色调；正值偏洋红，负值偏绿；0 不变。用于校正荧光灯偏绿等绿-洋红偏色，常用 ±20。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly tint?: number
  /** 曝光；线性曝光（EV 档）：0 不变，+1 亮度翻倍，-1 减半；常用 ±1.5。中灰偏暗/偏亮先用它校正，再用高光/阴影/白色/黑色收尾。；默认 0；硬范围 -4–4；单位 stops；可动画 true */
  readonly exposure?: number
  /** 对比度；围绕 18% 中灰改变明暗反差，只作用于亮度、不改色相；正值增强，负值减弱。+100 斜率 3 倍，-100 完全压平；常用 ±30。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly contrast?: number
  /** 高光；调整亮部（中灰以上）；负值恢复高光细节，正值提亮。常用 ±40。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly highlights?: number
  /** 阴影；调整暗部（中灰以下）；正值提亮暗部细节，负值压暗。常用 ±40。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly shadows?: number
  /** 白色；调整最亮端（白点）；高光溢出时用负值压回，画面发灰时用正值拉开。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly whites?: number
  /** 黑色；调整最暗端（黑点）；正值抬起黑色，负值加深黑色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly blacks?: number
  /** 饱和度；均匀改变所有颜色的彩度（OkLCh，色相不变）；-100 黑白，0 不变，+100 彩度翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly saturation?: number
  /** 自然饱和度；优先提升低饱和颜色并保护肤色，比饱和度更自然；负值优先降低低饱和颜色。常用 +10–30。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly vibrance?: number
  /** 曲线高光；参数曲线：亮度 75–100% 区间整体提亮或压暗，端点不动。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly tone_highlights?: number
  /** 曲线亮部；参数曲线：亮度 50–75% 区间整体提亮或压暗。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly tone_lights?: number
  /** 曲线暗部；参数曲线：亮度 25–50% 区间整体提亮或压暗。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly tone_darks?: number
  /** 曲线阴影；参数曲线：亮度 0–25% 区间整体提亮或压暗，端点不动。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly tone_shadows?: number
  /** 淡化胶片；抬起黑色并压缩反差；0 不变。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly faded_film?: number
  /** 锐化；增强边缘细节；0 不变，20 轻微提清晰度。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly sharpen?: number
  /** RGB 主曲线 · 0%；兼容旧锚点：输入亮度 0% 的输出亮度；默认 0%；单调三次样条。curve_master_points 非空时由自由点覆盖。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_master_0?: number
  /** RGB 主曲线 · 25%；兼容旧锚点：输入亮度 25% 的输出亮度；默认 25%；单调三次样条。curve_master_points 非空时由自由点覆盖。；默认 25；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_master_1?: number
  /** RGB 主曲线 · 50%；兼容旧锚点：输入亮度 50% 的输出亮度；默认 50%；单调三次样条。curve_master_points 非空时由自由点覆盖。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_master_2?: number
  /** RGB 主曲线 · 75%；兼容旧锚点：输入亮度 75% 的输出亮度；默认 75%；单调三次样条。curve_master_points 非空时由自由点覆盖。；默认 75；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_master_3?: number
  /** RGB 主曲线 · 100%；兼容旧锚点：输入亮度 100% 的输出亮度；默认 100%；单调三次样条。curve_master_points 非空时由自由点覆盖。；默认 100；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_master_4?: number
  /** 红曲线 · 0%；兼容旧锚点：输入亮度 0% 的输出亮度；默认 0%；单调三次样条。curve_red_points 非空时由自由点覆盖。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_red_0?: number
  /** 红曲线 · 25%；兼容旧锚点：输入亮度 25% 的输出亮度；默认 25%；单调三次样条。curve_red_points 非空时由自由点覆盖。；默认 25；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_red_1?: number
  /** 红曲线 · 50%；兼容旧锚点：输入亮度 50% 的输出亮度；默认 50%；单调三次样条。curve_red_points 非空时由自由点覆盖。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_red_2?: number
  /** 红曲线 · 75%；兼容旧锚点：输入亮度 75% 的输出亮度；默认 75%；单调三次样条。curve_red_points 非空时由自由点覆盖。；默认 75；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_red_3?: number
  /** 红曲线 · 100%；兼容旧锚点：输入亮度 100% 的输出亮度；默认 100%；单调三次样条。curve_red_points 非空时由自由点覆盖。；默认 100；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_red_4?: number
  /** 绿曲线 · 0%；兼容旧锚点：输入亮度 0% 的输出亮度；默认 0%；单调三次样条。curve_green_points 非空时由自由点覆盖。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_green_0?: number
  /** 绿曲线 · 25%；兼容旧锚点：输入亮度 25% 的输出亮度；默认 25%；单调三次样条。curve_green_points 非空时由自由点覆盖。；默认 25；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_green_1?: number
  /** 绿曲线 · 50%；兼容旧锚点：输入亮度 50% 的输出亮度；默认 50%；单调三次样条。curve_green_points 非空时由自由点覆盖。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_green_2?: number
  /** 绿曲线 · 75%；兼容旧锚点：输入亮度 75% 的输出亮度；默认 75%；单调三次样条。curve_green_points 非空时由自由点覆盖。；默认 75；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_green_3?: number
  /** 绿曲线 · 100%；兼容旧锚点：输入亮度 100% 的输出亮度；默认 100%；单调三次样条。curve_green_points 非空时由自由点覆盖。；默认 100；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_green_4?: number
  /** 蓝曲线 · 0%；兼容旧锚点：输入亮度 0% 的输出亮度；默认 0%；单调三次样条。curve_blue_points 非空时由自由点覆盖。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_blue_0?: number
  /** 蓝曲线 · 25%；兼容旧锚点：输入亮度 25% 的输出亮度；默认 25%；单调三次样条。curve_blue_points 非空时由自由点覆盖。；默认 25；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_blue_1?: number
  /** 蓝曲线 · 50%；兼容旧锚点：输入亮度 50% 的输出亮度；默认 50%；单调三次样条。curve_blue_points 非空时由自由点覆盖。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_blue_2?: number
  /** 蓝曲线 · 75%；兼容旧锚点：输入亮度 75% 的输出亮度；默认 75%；单调三次样条。curve_blue_points 非空时由自由点覆盖。；默认 75；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_blue_3?: number
  /** 蓝曲线 · 100%；兼容旧锚点：输入亮度 100% 的输出亮度；默认 100%；单调三次样条。curve_blue_points 非空时由自由点覆盖。；默认 100；硬范围 0–100；单位 strength；可动画 true */
  readonly curve_blue_4?: number
  /** RGB 主控制点；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y为输出亮度，空字符串沿用旧curve_master_0至_4五点（及其关键帧）。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_master_points?: string
  /** 红控制点；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y为输出亮度，空字符串沿用旧curve_red_0至_4五点（及其关键帧）。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_red_points?: string
  /** 绿控制点；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y为输出亮度，空字符串沿用旧curve_green_0至_4五点（及其关键帧）。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_green_points?: string
  /** 蓝控制点；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y为输出亮度，空字符串沿用旧curve_blue_0至_4五点（及其关键帧）。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_blue_points?: string
  /** 色相与饱和度；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y=50不变，0/100为最大减弱/增强；色相横轴0红、17黄、33绿、50青、67蓝、83洋红、100红（按感知色相测量），两端y必须相等。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_hue_sat_points?: string
  /** 色相与色相；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y=50不变，0/100为最大减弱/增强；色相横轴0红、17黄、33绿、50青、67蓝、83洋红、100红（按感知色相测量），两端y必须相等。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_hue_hue_points?: string
  /** 色相与亮度；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y=50不变，0/100为最大减弱/增强；色相横轴0红、17黄、33绿、50青、67蓝、83洋红、100红（按感知色相测量），两端y必须相等。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_hue_luma_points?: string
  /** 亮度与饱和度；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y=50不变，0/100为最大减弱/增强；色相横轴0红、17黄、33绿、50青、67蓝、83洋红、100红（按感知色相测量），两端y必须相等。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_luma_sat_points?: string
  /** 饱和度与饱和度；至少2个{x,y}控制点的JSON数组（编码不超过4096字符），x/y为0–100百分比，x严格递增。y=50不变，0/100为最大减弱/增强；色相横轴0红、17黄、33绿、50青、67蓝、83洋红、100红（按感知色相测量），两端y必须相等。 新曲线整体关键帧仅支持hold；旧五点数值动画保持原插值。；默认 ""；可动画 true */
  readonly curve_sat_sat_points?: string
  /** 输入 LUT；引用video_edit.document.color_luts中的id，禁止文件路径；空字符串关闭。；默认 ""；可动画 true */
  readonly input_lut?: string
  /** 输入 LUT 强度；0保持原色，100完全应用LUT。；默认 100；硬范围 0–100；单位 strength；可动画 true */
  readonly input_lut_strength?: number
  /** 创意 Look；引用video_edit.document.color_luts中的id，禁止文件路径；空字符串关闭。；默认 ""；可动画 true */
  readonly look_lut?: string
  /** Look 强度；0保持原色，100完全应用LUT。；默认 100；硬范围 0–100；单位 strength；可动画 true */
  readonly look_lut_strength?: number
  /** 色轮模式；grading 为 Lightroom 式色彩分级（阴影/中间调/高光/全局染色与亮度，配合混合与平衡）；primary 为 Lift/Gamma/Gain/Offset 一级校色（阴影轮=Lift、中间调=Gamma、高光=Gain、全局=Offset），适合视频按通道校正。；默认 "grading"；可动画 false */
  readonly wheel_mode?: "grading" | "primary"
  /** 阴影色相；染色色相角：0 红、60 黄、120 绿、180 青、240 蓝、300 洋红；与对应 strength 一起写入。；默认 0；硬范围 0–360；单位 degrees；可动画 true */
  readonly shadow_hue?: number
  /** 阴影染色；色轮离中心越远染色越强；0 不染色，常用 5–25。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly shadow_strength?: number
  /** 阴影亮度；正值提亮这个明暗范围，负值压暗；0 不变。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly shadow_luminance?: number
  /** 中间调色相；染色色相角：0 红、60 黄、120 绿、180 青、240 蓝、300 洋红；与对应 strength 一起写入。；默认 0；硬范围 0–360；单位 degrees；可动画 true */
  readonly midtone_hue?: number
  /** 中间调染色；色轮离中心越远染色越强；0 不染色，常用 5–25。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly midtone_strength?: number
  /** 中间调亮度；正值提亮这个明暗范围，负值压暗；0 不变。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly midtone_luminance?: number
  /** 高光色相；染色色相角：0 红、60 黄、120 绿、180 青、240 蓝、300 洋红；与对应 strength 一起写入。；默认 0；硬范围 0–360；单位 degrees；可动画 true */
  readonly highlight_hue?: number
  /** 高光染色；色轮离中心越远染色越强；0 不染色，常用 5–25。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly highlight_strength?: number
  /** 高光亮度；正值提亮这个明暗范围，负值压暗；0 不变。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly highlight_luminance?: number
  /** 全局色相；染色色相角：0 红、60 黄、120 绿、180 青、240 蓝、300 洋红；与对应 strength 一起写入。；默认 0；硬范围 0–360；单位 degrees；可动画 true */
  readonly global_hue?: number
  /** 全局染色；色轮离中心越远染色越强；0 不染色，常用 5–25。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly global_strength?: number
  /** 全局亮度；正值提亮这个明暗范围，负值压暗；0 不变。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly global_luminance?: number
  /** 分级混合；分级模式下阴影、中间调、高光三区的重叠程度；50 为默认过渡，越大越柔和。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly grade_blending?: number
  /** 分级平衡；分级模式下阴影与高光的分界；正值让高光区扩大，负值让阴影区扩大。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly grade_balance?: number
  /** 红色色相；把红色推向相邻颜色；±100 约偏移 30°。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_red_hue?: number
  /** 红色饱和度；只改变红色的彩度；-100 去色，+100 翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_red_saturation?: number
  /** 红色明亮度；只改变红色的明暗，不影响灰色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_red_luminance?: number
  /** 橙色色相；把橙色推向相邻颜色；±100 约偏移 30°。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_orange_hue?: number
  /** 橙色饱和度；只改变橙色的彩度；-100 去色，+100 翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_orange_saturation?: number
  /** 橙色明亮度；只改变橙色的明暗，不影响灰色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_orange_luminance?: number
  /** 黄色色相；把黄色推向相邻颜色；±100 约偏移 30°。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_yellow_hue?: number
  /** 黄色饱和度；只改变黄色的彩度；-100 去色，+100 翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_yellow_saturation?: number
  /** 黄色明亮度；只改变黄色的明暗，不影响灰色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_yellow_luminance?: number
  /** 绿色色相；把绿色推向相邻颜色；±100 约偏移 30°。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_green_hue?: number
  /** 绿色饱和度；只改变绿色的彩度；-100 去色，+100 翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_green_saturation?: number
  /** 绿色明亮度；只改变绿色的明暗，不影响灰色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_green_luminance?: number
  /** 浅绿色相；把浅绿推向相邻颜色；±100 约偏移 30°。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_aqua_hue?: number
  /** 浅绿饱和度；只改变浅绿的彩度；-100 去色，+100 翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_aqua_saturation?: number
  /** 浅绿明亮度；只改变浅绿的明暗，不影响灰色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_aqua_luminance?: number
  /** 蓝色色相；把蓝色推向相邻颜色；±100 约偏移 30°。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_blue_hue?: number
  /** 蓝色饱和度；只改变蓝色的彩度；-100 去色，+100 翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_blue_saturation?: number
  /** 蓝色明亮度；只改变蓝色的明暗，不影响灰色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_blue_luminance?: number
  /** 紫色色相；把紫色推向相邻颜色；±100 约偏移 30°。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_purple_hue?: number
  /** 紫色饱和度；只改变紫色的彩度；-100 去色，+100 翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_purple_saturation?: number
  /** 紫色明亮度；只改变紫色的明暗，不影响灰色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_purple_luminance?: number
  /** 洋红色相；把洋红推向相邻颜色；±100 约偏移 30°。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_magenta_hue?: number
  /** 洋红饱和度；只改变洋红的彩度；-100 去色，+100 翻倍。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_magenta_saturation?: number
  /** 洋红明亮度；只改变洋红的明暗，不影响灰色。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly mixer_magenta_luminance?: number
  /** 色相起点；HSL 色相角顺时针选区；start>end 跨 0° 回绕，0/360 为全部。肤色常用15–50°，天空190–250°，红340–20°，需按画面微调。；默认 0；硬范围 0–360；单位 degrees；可动画 true */
  readonly hsl_hue_start?: number
  /** 色相终点；HSL 色相角顺时针选区；start>end 跨 0° 回绕，0/360 为全部。肤色常用15–50°，天空190–250°，红340–20°，需按画面微调。；默认 360；硬范围 0–360；单位 degrees；可动画 true */
  readonly hsl_hue_end?: number
  /** 色相柔和度；键控色相外侧羽化；0硬边，100相当于180°的过渡宽度，常用5–20。；默认 0；硬范围 0–100；单位 percent；可动画 true */
  readonly hsl_hue_feather?: number
  /** 饱和度起点；HSL 饱和度百分比，0–100；start<=end，默认全选。；默认 0；硬范围 0–100；单位 percent；可动画 true */
  readonly hsl_saturation_start?: number
  /** 饱和度终点；HSL 饱和度百分比，0–100；start<=end，默认全选。；默认 100；硬范围 0–100；单位 percent；可动画 true */
  readonly hsl_saturation_end?: number
  /** 饱和度柔和度；键控饱和度外侧羽化；0硬边，100相当于整个归一化范围的过渡宽度，常用5–20。；默认 0；硬范围 0–100；单位 percent；可动画 true */
  readonly hsl_saturation_feather?: number
  /** 亮度起点；HSL 亮度百分比，0–100；start<=end，默认全选。；默认 0；硬范围 0–100；单位 percent；可动画 true */
  readonly hsl_luminance_start?: number
  /** 亮度终点；HSL 亮度百分比，0–100；start<=end，默认全选。；默认 100；硬范围 0–100；单位 percent；可动画 true */
  readonly hsl_luminance_end?: number
  /** 亮度柔和度；键控亮度外侧羽化；0硬边，100相当于整个归一化范围的过渡宽度，常用5–20。；默认 0；硬范围 0–100；单位 percent；可动画 true */
  readonly hsl_luminance_feather?: number
  /** 反向；反转联合 HSL 键控蒙版，true 校正选区外，false 校正选区内。；默认 false；可动画 true */
  readonly hsl_invert?: boolean
  /** 显示蒙版；以灰度显示当前 HSL 选区，供用户及助手观察确认；检查完成写false恢复。此开关不设关键帧，开启时导出同样显示蒙版。；默认 false；可动画 false */
  readonly hsl_show_mask?: boolean
  /** 键控去噪；平滑细碎的键控噪点；0关闭，100的高斯标准差为画面高度的0.5%。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly hsl_denoise?: number
  /** 键控模糊；柔化选区边缘；0关闭，100的高斯标准差为画面高度的2%。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly hsl_blur?: number
  /** 选区色温；选区内正值偏暖、负值偏冷；0不变，常用±20。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly hsl_temperature?: number
  /** 选区色调；选区内正值偏洋红、负值偏绿；0不变。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly hsl_tint?: number
  /** 选区对比度；选区内增强或减弱明暗反差；0不变，在线性光中调整。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly hsl_contrast?: number
  /** 选区锐化；只增强选区内细节；0不变，20轻微增强，半径相对画面高度。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly hsl_sharpen?: number
  /** 选区饱和度；只调整选区饱和度；-100黑白，0不变，100翻倍，在线性光中调整。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly hsl_saturation?: number
  /** 选区色轮色相；染色色相角：0 红、60 黄、120 绿、180 青、240 蓝、300 洋红；与对应 strength 一起写入。；默认 0；硬范围 0–360；单位 degrees；可动画 true */
  readonly hsl_grade_hue?: number
  /** 选区色轮强度；选区内的中间调染色强度，0不染色；色相角单独改变不会启用校正。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly hsl_grade_strength?: number
  /** 选区色轮亮度；只调整选区内中间调亮度，0不变。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly hsl_grade_luminance?: number
  /** 晕影数量；负值压暗四周，正值提亮；0 不变。；默认 0；硬范围 -100–100；单位 strength；可动画 true */
  readonly vignette_amount?: number
  /** 晕影中点；越大，中心不受影响的范围越大。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly vignette_midpoint?: number
  /** 晕影圆度；0 跟随画面比例，100 为圆形。；默认 0；硬范围 0–100；单位 strength；可动画 true */
  readonly vignette_roundness?: number
  /** 晕影羽化；越大，边缘过渡越柔和。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly vignette_feather?: number
}

export interface BlackWhiteParams {
}

export interface InvertParams {
}

export interface GradientMapParams {
  /** 方式；用几种颜色。双色（默认）从暗部颜色过渡到亮部颜色；三色在中间多一个中间调颜色。；默认 "two"；可动画 true */
  readonly mode?: "two" | "three"
  /** 暗部颜色；最暗处换成的颜色。黑色（默认）配白色的亮部，就是按人眼明暗变成黑白；换成深蓝、深棕，暗部就带上这种色调。；默认 "#000000"；可动画 true */
  readonly dark_color?: string
  /** 亮部颜色；最亮处换成的颜色。白色（默认）；换成暖白、浅黄，高光和亮部就偏暖。；默认 "#ffffff"；可动画 true */
  readonly light_color?: string
  /** 中间调颜色；中等明暗处换成的颜色。灰色（默认）与黑白两端一起就是黑白；换成彩色，中间调就是这个颜色。；默认 "#808080"；分组 渐变；显隐 {"param":"mode","in":["three"]}；可动画 true */
  readonly mid_color?: string
  /** 中间调位置；中间调颜色落在多亮的地方。50%（默认）正中；30% 偏暗处，更多画面接近亮部颜色；70% 偏亮处，更多画面接近暗部颜色。；默认 50；硬范围 0–100；单位 percent；分组 渐变；显隐 {"param":"mode","in":["three"]}；可动画 true */
  readonly mid_point?: number
  /** 插值；颜色之间怎么过渡。感知（默认）过渡均匀，两种彩色之间不发灰发脏；标准与网页 CSS 渐变一致。；默认 "perceptual"；分组 渐变；可动画 true */
  readonly interpolation?: "perceptual" | "srgb"
  /** 黑场；比它还暗的地方都用暗部颜色。0%（默认）只有纯黑才是暗部颜色；调到 20%，暗部更实、反差更大。；默认 0；硬范围 0–100；单位 percent；分组 色阶；可动画 true */
  readonly black_point?: number
  /** 白场；比它还亮的地方都用亮部颜色。100%（默认）只有纯白才是亮部颜色；调到 80%，亮部更通透。；默认 100；硬范围 0–100；单位 percent；分组 色阶；可动画 true */
  readonly white_point?: number
}

export interface PosterizeParams {
  /** 色阶；每个颜色留几级。2 只剩最亮最暗；6（默认）明显的色块；16 接近原画。可以输入到 64。；默认 6；常用 2–16；硬范围 2–64；单位 value；可动画 true */
  readonly levels?: number
  /** 分离方式；分哪些。按通道（默认）颜色和明暗都分级，色块颜色更少更纯；按亮度只分明暗，保留原来的色相。；默认 "channels"；可动画 true */
  readonly by?: "channels" | "luminance"
  /** 平滑；台阶之间硬切还是柔和过渡。0%（默认）硬边；50% 色块边缘柔一些；100% 台阶之间连成柔和的起伏。；默认 0；硬范围 0–100；单位 percent；可动画 true */
  readonly smooth?: number
}

export interface GlowParams {
  /** 强度；光晕有多亮。0 不发光；20 含蓄的柔光；40（默认）明显的光晕；70 以上是强烈的霓虹辉光。；默认 40；硬范围 0–100；单位 strength；可动画 true */
  readonly strength?: number
  /** 半径；光晕能散多远。0 只贴着边缘一圈；60（默认）约为画面高度的 8%；100 能铺满大半个画面。只改变散开的距离，中心亮度基本不变。；默认 60；硬范围 0–100；单位 strength；可动画 true */
  readonly radius?: number
  /** 方式；什么发光。亮部（默认）按画面亮度，亮的地方发光、光的颜色跟着原画；轮廓按文字和图形的形状发光，深色的字也能发出光，光的颜色由“着色”组的内圈、外圈颜色决定。；默认 "bright"；可动画 true */
  readonly mode?: "bright" | "shape"
  /** 阈值；画面里多亮的地方才发光。0 所有内容都发光（给文字加外发光时用）；60（默认）只有明显的亮部；85 以上只剩灯光、反光这类最亮处。；默认 60；硬范围 0–100；单位 strength；分组 输入；显隐 {"param":"mode","in":["bright"]}；可动画 true */
  readonly threshold?: number
  /** 阈值平滑度；阈值附近是一刀切还是慢慢过渡。0 刚过阈值才发光，边界生硬；30（默认）自然；100 接近阈值的部分也微微发光。；默认 30；硬范围 0–100；单位 strength；分组 输入；显隐 {"param":"mode","in":["bright"]}；可动画 true */
  readonly threshold_smoothness?: number
  /** 拖尾；远处的光留得多少。0 光集中在近处，很快消失；70（默认）自然的光雾；100 远处留下大片淡光，最像真实镜头。；默认 70；硬范围 0–100；单位 strength；分组 光晕；可动画 true */
  readonly falloff?: number
  /** 核心发白；很亮的彩色光，中心有多容易变白，像曝光过度。0 保持原来的颜色；50（默认）自然；100 强光中心明显发白。；默认 50；硬范围 0–100；单位 strength；分组 光晕；可动画 true */
  readonly core_white?: number
  /** 混合模式；光晕怎样叠到画面上。相加（默认）像真实的光，亮处更亮、强光会变白；滤色更柔和，不容易过曝。；默认 "add"；分组 光晕；可动画 true */
  readonly blend?: "add" | "screen"
  /** 长宽比；把光晕拉成横向或竖向的光带，像宽银幕镜头。0（默认）圆形；往正调横向拉长，50 约 3 倍、100 拉成 8 倍长的光条；往负调竖向拉长。；默认 0；硬范围 -100–100；单位 strength；分组 长宽比；可动画 true */
  readonly aspect?: number
  /** 角度；把拉长的方向再转一个角度，用来斜着拉。0（默认）不转。长宽比为 0 时不起作用。；默认 0；硬范围 -180–180；单位 degrees；分组 长宽比；可动画 true */
  readonly angle?: number
  /** 数量；颜色错开多远，只作用在光晕上。0（默认）没有色差；20 轻微的镜头感；60 明显的彩边；100 约为画面高度的 2%。；默认 0；硬范围 0–100；单位 strength；分组 色差；可动画 true */
  readonly aberration_amount?: number
  /** 方式；从中心向外（默认）像真实镜头，越靠近画面边缘错得越开；固定方向让整个画面朝同一个方向错开，更像故障效果。；默认 "radial"；分组 色差；可动画 true */
  readonly aberration_mode?: "radial" | "directional"
  /** 角度；固定方向时颜色错开的方向。0（默认）左右错开，90 上下错开。；默认 0；硬范围 -180–180；单位 degrees；分组 色差；显隐 {"param":"aberration_mode","in":["directional"]}；可动画 true */
  readonly aberration_angle?: number
  /** 通道；哪两种颜色分开：前一种往外偏，后一种往里偏，第三种不动。红与蓝（默认）外红内蓝，最像真实镜头。；默认 "red_blue"；分组 色差；可动画 true */
  readonly aberration_channels?: "red_blue" | "red_green" | "green_blue"
  /** 柔和度；彩边是清楚的三层重影还是柔和的彩虹过渡。0 三层颜色硬分开，像数码故障；50（默认）柔和；100 拉成连续的彩虹色带。；默认 50；硬范围 0–100；单位 strength；分组 色差；可动画 true */
  readonly aberration_smoothness?: number
  /** 着色量；把光晕换成下面的颜色的程度。0（默认）保持发光内容本来的颜色；100 完全换成从内圈到外圈的颜色。白字配彩色光晕时设 100。；默认 0；硬范围 0–100；单位 strength；分组 着色；显隐 {"param":"mode","in":["bright"]}；可动画 true */
  readonly tint?: number
  /** 内圈颜色；靠近发光内容的光晕颜色。亮部方式下着色量为 0 时不起作用；轮廓方式下光就是这个颜色。；默认 "#ffffff"；分组 着色；可动画 true */
  readonly tint_inner?: string
  /** 外圈颜色；远处光晕的颜色，从内圈颜色渐变过来；和内圈颜色相同就是单色光晕。亮部方式下着色量为 0 时不起作用；轮廓方式下光就是这个颜色。；默认 "#ffffff"；分组 着色；可动画 true */
  readonly tint_outer?: string
  /** 分辨率；光晕按画面多大的分辨率计算。50%（默认）又快又好；100% 贴近内容的光更细腻，细小亮点在运动中更稳，计算量约为默认的三倍；25% 最快，近处的光略糊。亮度和光晕大小不随它变。；默认 50；硬范围 25–100；单位 percent；分组 质量；可动画 false */
  readonly resolution?: number
  /** 抖动；给光晕加极细的噪点，盖住平滑渐变里一圈圈的色带。0 关闭；50（默认）刚好看不出噪点；100 色带最少，但暗处能看到细微的颗粒。；默认 50；硬范围 0–100；单位 strength；分组 质量；可动画 true */
  readonly dither?: number
  /** 单色抖动；抖动的噪点只改变明暗、不带颜色。默认关闭，彩色噪点更不容易被看出来。；默认 false；分组 质量；可动画 true */
  readonly dither_mono?: boolean
  /** 原画不透明度；原来的画面还保留多少。100%（默认）光晕加在原画上；0% 只留下光晕，适合单独放一层再叠加。；默认 100；硬范围 0–100；单位 percent；分组 输出；可动画 true */
  readonly source_opacity?: number
  /** 视图；最终效果（默认）显示加了光晕的画面；发光来源只显示会发光的部分（轮廓方式下是白色剪影），用来检查阈值调得对不对。；默认 "final"；分组 输出；可动画 true */
  readonly view?: "final" | "source"
}

export interface LightSweepParams {
  /** 进度；光扫到哪里。0% 光还在内容外面没进来，100% 已经完全扫出去；50%（默认）在正中。打两个关键帧从 0% 到 100% 就是完整扫一遍，首尾都不会多出光。；默认 50；硬范围 0–100；单位 percent；可动画 true */
  readonly progress?: number
  /** 宽度；光带有多宽。0 一条细亮线；40 约为画面高度的 2.5%；70（默认）约 10%，一道清楚的光带；100 约 40%，一大片柔光掠过。；默认 70；硬范围 0–100；单位 strength；可动画 true */
  readonly width?: number
  /** 角度；光往哪个方向扫，光带和它垂直。0° 从左往右、光带竖直；30°（默认）往右下扫、光带向右倾斜；90° 从上往下扫。；默认 30；硬范围 -180–180；单位 degrees；可动画 true */
  readonly angle?: number
  /** 颜色；光的颜色。白色（默认）；金色、淡蓝做出金属或冷光的质感。；默认 "#ffffff"；分组 光；可动画 true */
  readonly color?: string
  /** 亮度；光有多亮。0 没有光；50 含蓄的高光；100（默认）明显的高光，彩色的字中心发白；200 以上接近曝光过度。可以输入到 400。；默认 100；常用 0–100；硬范围 0–400；单位 strength；分组 光；可动画 true */
  readonly intensity?: number
  /** 边缘柔和；光带两边利落还是渐隐。0% 边缘清楚的光条；60%（默认）中间亮、两边柔和地暗下去；100% 整条都是渐变。；默认 60；硬范围 0–100；单位 percent；分组 光；可动画 true */
  readonly feather?: number
  /** 强度；从扫过的光里散出的光晕有多亮。0 不加光晕；40（默认）光带经过处贴着笔画的一圈亮边，纯白的字靠它看出光扫过；70 以上明显的辉光。；默认 40；硬范围 0–100；单位 strength；分组 发光；可动画 true */
  readonly glow_strength?: number
  /** 半径；光晕能散多远。0 只贴着内容；12（默认）约为画面高度的 0.7%，紧贴笔画；40 约 3%，柔和的光雾；100 能铺满大半个画面。；默认 12；硬范围 0–100；单位 strength；分组 发光；可动画 true */
  readonly glow_radius?: number
}

export interface LensFlareParams {
  /** 亮度；光源有多亮。0 没有光；30 柔和的一点灯光；60（默认）明显的强光，中心发白；100 以上中心大片发白，可以输入到 400。；默认 60；常用 0–100；硬范围 0–400；单位 strength；可动画 true */
  readonly brightness?: number
  /** 光源位置（水平）；光源在画面里左右的位置。0% 在左边缘，100% 在右边缘，25%（默认）偏左；可以输入画外的值，例如 120%，光从右边漏进来。；默认 25；常用 0–100；硬范围 -100–200；单位 percent；可动画 true */
  readonly light_x?: number
  /** 光源位置（垂直）；光源上下的位置。0% 在顶边，100% 在底边，25%（默认）偏上；输入负数光源到画面上方。；默认 25；常用 0–100；硬范围 -100–200；单位 percent；可动画 true */
  readonly light_y?: number
  /** 颜色；光的颜色，光晕、星芒、拉丝和鬼影一起变。白色（默认）；暖黄像夕阳，淡蓝像冷光灯。很亮时中心仍会发白。；默认 "#ffffff"；可动画 true */
  readonly color?: string
  /** 光晕大小；光晕散多远，和发光的半径同一把尺子。0 只剩贴着光源的一小团；30 约为画面高度的 2%；60（默认）约 8%，四周一圈柔和的光雾；100 能铺满大半个画面。；默认 60；常用 0–100；硬范围 0–150；单位 strength；分组 光芒；可动画 true */
  readonly size?: number
  /** 星芒；光源周围放射的细光线有多明显。0 没有；20（默认）淡淡的几道；60 以上清楚的星形光芒。；默认 20；硬范围 0–100；单位 strength；分组 光芒；可动画 true */
  readonly rays?: number
  /** 星芒数量；星芒有几道。4 是十字；6（默认）像六叶光圈拍出的星芒；8 以上更细密。星芒为 0 时不起作用。；默认 6；常用 2–16；硬范围 2–32；单位 value；分组 光芒；可动画 false */
  readonly ray_count?: number
  /** 横向拉丝；一条横贯画面的细长光线，像宽银幕镜头。0 没有；30（默认）淡淡一条；70 以上明显的光条，亮度越高拉得越长。；默认 30；硬范围 0–100；单位 strength；分组 光芒；可动画 true */
  readonly streak?: number
  /** 鬼影；沿光源和画面中心的连线排开的一串淡淡的圆形光斑，像老镜头里的反射。0（默认）没有；30 隐约可见；70 以上很明显。；默认 0；硬范围 0–100；单位 strength；分组 鬼影；可动画 true */
  readonly ghosts?: number
  /** 色散；鬼影边缘的彩虹色。0 没有彩边；30（默认）淡淡的一圈；100 明显的彩虹边。鬼影为 0 时不起作用。；默认 30；硬范围 0–100；单位 strength；分组 鬼影；可动画 true */
  readonly ghost_dispersion?: number
}

export interface LightLeakParams {
  /** 强度；漏光有多亮。0 没有；50（默认）一角明显泛暖；100 以上大半个画面被光冲淡，可以输入到 200。；默认 50；常用 0–100；硬范围 0–200；单位 strength；可动画 true */
  readonly amount?: number
  /** 方向；光从哪边渗进来。左上（默认）从左上角斜着进来；上、下、左、右从一条边进来，光沿着这条边铺开。；默认 "top_left"；可动画 true */
  readonly side?: "top_left" | "top" | "top_right" | "right" | "bottom_right" | "bottom" | "bottom_left" | "left"
  /** 范围；光往画面里铺得多深。50%（默认）约到画面三分之一；20% 只贴着边缘一小片；100% 铺过大半个画面。；默认 50；硬范围 0–100；单位 percent；分组 光；可动画 true */
  readonly spread?: number
  /** 条纹；顺着光进来的方向的明暗条纹，像光从缝里透进来。0 一整片柔光；30（默认）隐约的几道；80 以上清楚的光带。；默认 30；硬范围 0–100；单位 strength；分组 光；可动画 true */
  readonly streaks?: number
  /** 中心颜色；光最亮处的颜色，暖白（默认）。很亮时还会更接近白色。；默认 "#ffe8c8"；分组 颜色；可动画 true */
  readonly hot_color?: string
  /** 边缘颜色；光渐渐变淡处的颜色，橙色（默认）；换成玫红、品红是更浓的胶片味。；默认 "#ff8a4a"；分组 颜色；可动画 true */
  readonly edge_color?: string
  /** 闪烁；亮度一明一暗地起伏。0% 稳定不变；20%（默认）轻轻地呼吸；70% 以上明显地跳动。；默认 20；硬范围 0–100；单位 percent；分组 变化；可动画 true */
  readonly flicker?: number
  /** 速度；光形慢慢流动的快慢。0% 静止；30%（默认）几秒里缓缓变化；100% 流动得很明显。；默认 30；硬范围 0–100；单位 percent；分组 变化；可动画 false */
  readonly speed?: number
  /** 随机种子；换一个数，光的形状和起伏就换一种，亮度和范围不变。同一部片子几处都用漏光时各填不同的数。；默认 0；硬范围 0–9999；单位 value；分组 变化；可动画 false */
  readonly seed?: number
}

export interface DropShadowParams {
  /** 不透明度；影子有多深。0 没有投影；40%（默认）淡淡的影子，像纸片稍稍离开桌面；80% 以上是浓重的影子。；默认 40；硬范围 0–100；单位 percent；可动画 true */
  readonly opacity?: number
  /** 距离；影子离内容多远。0 影子正好在内容正下方，只露出四周一圈；20（默认）约为画面高度的 1%；100 约 5%，像悬得很高。可以输入到 400。；默认 20；常用 0–100；硬范围 0–400；单位 strength；可动画 true */
  readonly distance?: number
  /** 柔和度；影子的边缘有多虚。0 边缘清楚的硬影；40（默认）柔和，虚化约为画面高度的 1%；80 以上散成一大片淡影。和“模糊”的模糊度是同一把尺子，可以输入到 200。；默认 40；常用 0–100；硬范围 0–200；单位 strength；可动画 true */
  readonly softness?: number
  /** 方向；影子往哪边落。90°（默认）落在正下方，像光从正上方照下来；45° 右下；0° 正右；−90° 正上方。；默认 90；硬范围 -180–180；单位 degrees；可动画 true */
  readonly direction?: number
  /** 颜色；影子的颜色。黑色（默认）最自然；在有颜色的背景上用背景色的深色，比纯黑更像真实的影子。；默认 "#000000"；分组 外观；可动画 true */
  readonly color?: string
  /** 扩展；影子的实心部分有多大。0%（默认）完全按柔和度渐变；50% 影子更实、更大一圈；100% 变成放大了一圈的硬边影子。；默认 0；硬范围 0–100；单位 percent；分组 外观；可动画 true */
  readonly spread?: number
  /** 原画不透明度；内容本身保留多少。100%（默认）；0% 只留下影子，相当于 AE 的“仅阴影”，可以单独放一层再叠。；默认 100；硬范围 0–100；单位 percent；分组 外观；可动画 true */
  readonly source_opacity?: number
}

export interface StrokeParams {
  /** 粗细；边有多粗。0 没有描边；20 发丝细线；50（默认）约为画面高度的 0.4%，常规字幕描边；100 约 4%，粗壮的贴纸边。可以输入到 120。；默认 50；常用 0–100；硬范围 0–120；单位 strength；可动画 true */
  readonly width?: number
  /** 颜色；边的颜色。黑色（默认）让浅色字在亮画面上也看得清；白色做贴纸边。；默认 "#000000"；可动画 true */
  readonly color?: string
  /** 位置；边描在轮廓的哪一侧。外侧（默认）不遮住内容，字形不变；内侧描在内容里面，外形不变大；居中跨在轮廓线上。；默认 "outside"；分组 边缘；可动画 true */
  readonly position?: "outside" | "inside" | "center"
  /** 柔和度；边的外缘清楚还是发虚。0%（默认）清楚利落；30% 微微发虚；100% 整条边都在渐变，像一层柔光。；默认 0；硬范围 0–100；单位 percent；分组 边缘；可动画 true */
  readonly softness?: number
  /** 不透明度；边有多实。100%（默认）实色；50% 半透明，透出后面的画面。；默认 100；硬范围 0–100；单位 percent；分组 边缘；可动画 true */
  readonly opacity?: number
  /** 原画不透明度；内容本身保留多少。100%（默认）；0% 只留下描边，做空心字。；默认 100；硬范围 0–100；单位 percent；分组 边缘；可动画 true */
  readonly source_opacity?: number
}

export interface VignetteParams {
  /** 数量；四周变化多少。0 没有暗角；30（默认）柔和的电影暗角；70 浓重；100 四周完全变成所选颜色。；默认 30；硬范围 0–100；单位 strength；可动画 true */
  readonly amount?: number
  /** 大小；中间不受影响的区域有多大。50%（默认）；调小暗角往里收，100% 只压最角落。；默认 50；硬范围 0–100；单位 percent；可动画 true */
  readonly midpoint?: number
  /** 羽化；暗角边缘过渡得多柔和。0% 边缘很硬，像一个圈；50%（默认）柔和；100% 从中心起就慢慢过渡。；默认 50；硬范围 0–100；单位 percent；可动画 true */
  readonly feather?: number
  /** 颜色；四周变成什么颜色。黑色（默认）是普通暗角；白色是四周提亮，适合梦境、回忆。；默认 "#000000"；可动画 true */
  readonly color?: string
}

export interface ChromaticAberrationParams {
  /** 数量；颜色错开多远。0 没有色差；20（默认）轻微的镜头感；60 明显的彩边；100 约为画面高度的 2%，故障风。；默认 20；硬范围 0–100；单位 strength；可动画 true */
  readonly amount?: number
  /** 方式；从中心向外（默认）像真实镜头，越靠近画面边缘错得越开；固定方向让整个画面朝同一个方向错开，更像故障效果。；默认 "radial"；可动画 true */
  readonly mode?: "radial" | "directional"
  /** 角度；固定方向时颜色错开的方向。0（默认）左右错开，90 上下错开。；默认 0；硬范围 -180–180；单位 degrees；显隐 {"param":"mode","in":["directional"]}；可动画 true */
  readonly angle?: number
  /** 通道；哪两种颜色分开：前一种往外偏，后一种往里偏，第三种不动。红与蓝（默认）外红内蓝，最像真实镜头。；默认 "red_blue"；可动画 true */
  readonly channels?: "red_blue" | "red_green" | "green_blue"
  /** 柔和度；彩边是清楚的三层重影还是柔和的彩虹过渡。0 三层颜色硬分开，像数码故障；50（默认）柔和；100 拉成连续的彩虹色带。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly smoothness?: number
}

export interface FilmGrainParams {
  /** 强度；颗粒有多明显。0 没有颗粒；15 隐约的质感；30（默认）明显的胶片感；60 以上很粗糙。；默认 30；硬范围 0–100；单位 strength；可动画 true */
  readonly amount?: number
  /** 大小；颗粒的粗细。0 最细，约一个像素；30（默认）；100 粗颗粒，约为画面高度的 0.4%。；默认 30；硬范围 0–100；单位 strength；可动画 true */
  readonly size?: number
  /** 单色；颗粒只改变明暗、不带颜色（默认打开），像黑白胶片；关闭后每种颜色各自起伏，像彩色胶片或高感光度的数码噪点。；默认 true；可动画 true */
  readonly monochrome?: boolean
}

export interface HalftoneParams {
  /** 网点大小；每个网点格子多大。0 细到接近原画；40（默认）约为画面高度的 0.9%；100 约 8%，一颗颗大圆点。；默认 40；硬范围 0–100；单位 strength；可动画 true */
  readonly size?: number
  /** 方式；单色（默认）一层网点；彩色印刷用青、品红、黄、黑四色网点按印刷网角叠印在白纸上，近看有玫瑰斑。；默认 "mono"；可动画 true */
  readonly mode?: "mono" | "cmyk"
  /** 形状；圆点（默认）；线条是一排排粗细随明暗变化的横线，彩色印刷时四色线条各斜一个网角。；默认 "dot"；分组 网点；可动画 true */
  readonly shape?: "dot" | "line"
  /** 对比度；网点大小随明暗变化得多明显。50（默认）照原画明暗；调高暗处更实、亮处更空；调低网点大小更接近，画面发灰。；默认 50；硬范围 0–100；单位 strength；分组 网点；可动画 true */
  readonly contrast?: number
  /** 颜色；原色（默认）网点用原画颜色，亮处网点大，网点之间透明，适合暗底；双色是墨印在纸上，暗处墨点大。；默认 "original"；分组 颜色；显隐 {"param":"mode","equals":"mono"}；可动画 true */
  readonly color_mode?: "original" | "duo"
  /** 墨色；双色时网点的颜色。黑色（默认）像报纸；换成深蓝、深红就是单色套印。；默认 "#000000"；分组 颜色；显隐 {"all":[{"param":"mode","equals":"mono"},{"param":"color_mode","equals":"duo"}]}；可动画 true */
  readonly ink?: string
  /** 纸色；双色时网点下面的纸是什么颜色。白色（默认）；设成透明只留下墨点，可以叠在别的画面上。；默认 "#ffffff"；分组 颜色；显隐 {"all":[{"param":"mode","equals":"mono"},{"param":"color_mode","equals":"duo"}]}；可动画 true */
  readonly paper?: string
  /** 套色偏移；四色版错开多远，像没对准的印刷。0（默认）对齐；10 约为画面高度的 0.5%，边上露出彩边；100 约 5%。；默认 0；硬范围 0–100；单位 strength；分组 颜色；显隐 {"param":"mode","equals":"cmyk"}；可动画 true */
  readonly misregister?: number
}

export interface DitherPatternParams {
  /** 像素大小；每个点多大。0 约为画面高度的 0.1%，最细的点；20（默认）约 0.2%；100 约 3%，大颗马赛克点。；默认 20；硬范围 0–100；单位 strength；可动画 true */
  readonly pixel_size?: number
  /** 图案；点怎么排。方格（默认）整齐的网纹，像老游戏机；蓝噪声细碎均匀、没有纹路。；默认 "bayer"；可动画 true */
  readonly pattern?: "bayer" | "blue_noise"
  /** 色阶；每种颜色留几级。2（默认）只有暗色和亮色；4 多出两级中间色；8 以上接近原画的明暗。；默认 2；常用 2–8；硬范围 2–16；单位 value；分组 颜色；可动画 true */
  readonly levels?: number
  /** 颜色；双色（默认）只用暗色与亮色；原色按原画的颜色分级，色阶 2 时只剩红绿蓝、青品黄和黑白八种颜色。；默认 "duo"；分组 颜色；可动画 true */
  readonly color_mode?: "duo" | "original"
  /** 暗色；双色时暗处点的颜色。黑色（默认）；换成深绿、深蓝像老掌机的屏幕。；默认 "#000000"；分组 颜色；显隐 {"param":"color_mode","equals":"duo"}；可动画 true */
  readonly dark?: string
  /** 亮色；双色时亮处点的颜色。白色（默认）；换成浅绿、米黄像老掌机的屏幕。；默认 "#ffffff"；分组 颜色；显隐 {"param":"color_mode","equals":"duo"}；可动画 true */
  readonly light?: string
  /** 阈值；整体偏暗还是偏亮。50%（默认）照原画；调高更多点变暗；调低更多点变亮。；默认 50；硬范围 0–100；单位 percent；分组 颜色；可动画 true */
  readonly threshold?: number
}

export interface PaperParams {
  /** 强度；纸纹多明显。0 没有；40（默认）近看才看得出；80 像粗糙的水彩纸。深色处纸纹本来就淡。；默认 40；硬范围 0–100；单位 strength；可动画 true */
  readonly amount?: number
  /** 纹理大小；纤维与颗粒有多粗。50（默认）约为画面高度的 1.3%；20 细密的打印纸；90 粗糙的手工纸。；默认 50；硬范围 0–100；单位 strength；可动画 true */
  readonly scale?: number
  /** 粗糙度；偏细纤维还是偏颗粒。0% 顺滑的纤维；50%（默认）两者都有；100% 粗颗粒。；默认 50；硬范围 0–100；单位 percent；分组 纸纹；可动画 true */
  readonly roughness?: number
  /** 边缘毛糙；内容边缘被纸纹带得多不齐。10（默认）几乎看不出；60 像印在粗纸上的字边。只动轮廓，内容内部不变。；默认 10；硬范围 0–100；单位 strength；分组 纸纹；可动画 true */
  readonly edge?: number
  /** 随机种子；换一个数，纤维和颗粒就换一种排法，粗细和明显程度不变。同一画面上几张卡片各填不同的数，纸纹不会一模一样。；默认 0；硬范围 0–9999；单位 value；分组 纸纹；可动画 false */
  readonly seed?: number
}

export interface ScratchesParams {
  /** 数量；同时有多少条。0 没有；30（默认）偶尔几条；80 满屏划痕。；默认 30；硬范围 0–100；单位 strength；可动画 true */
  readonly amount?: number
  /** 不透明度；划痕多显眼。50%（默认）清楚但不抢画面；100% 亮划痕接近纯白、暗划痕接近纯黑。；默认 50；硬范围 0–100；单位 percent；可动画 true */
  readonly opacity?: number
  /** 粗细；划痕多粗。20（默认）约为画面高度的 0.07%，发丝细；60 约 0.2%；100 约 0.6%，像粗的划伤。；默认 20；硬范围 0–100；单位 strength；分组 划痕；可动画 true */
  readonly width?: number
  /** 停留；一条划痕停多久。0% 每帧换位置；30%（默认）约停 4 帧；80% 约 50 帧；100% 一直不动。；默认 30；硬范围 0–100；单位 percent；分组 划痕；可动画 true */
  readonly hold?: number
  /** 颜色；亮（默认）是胶片上白色的划伤；暗是黑色的脏线。；默认 "light"；分组 划痕；可动画 true */
  readonly tone?: "light" | "dark"
  /** 随机种子；换一个数，划痕出现的位置和先后就换一种排法，数量和节奏不变。；默认 0；硬范围 0–9999；单位 value；分组 划痕；可动画 false */
  readonly seed?: number
}

export interface MosaicParams {
  /** 块大小；方块有多大。0 不打码；10 细小方块，约为画面高度的 1%；30（默认）常规打码；100 很大的色块，约 10%，可以输入到 200。；默认 30；常用 0–100；硬范围 0–200；单位 strength；可动画 true */
  readonly block_size?: number
}

export interface GlitchParams {
  /** 强度；出错有多凶。0 没有故障；40（默认）几块明显错位；100 大半个画面碎掉。数字故障超过 60 时偶尔还有一块反色。；默认 40；硬范围 0–100；单位 strength；可动画 true */
  readonly amount?: number
  /** 方式；怎么出错。数字故障（默认）一块块横向错开、红蓝分离；条带错位把画面切成平行条带各自偏移；压缩失真像码率不够时的方块与串色。；默认 "digital"；可动画 true */
  readonly mode?: "digital" | "bars" | "compression"
  /** 变化频率；多久换一种错法。0% 定住不变；60%（默认）约每 6 帧一变；100% 每帧都换。；默认 60；硬范围 0–100；单位 percent；可动画 true */
  readonly rhythm?: number
  /** 色彩分离；红、蓝两色错开多远。0 不分色；40（默认）约为画面高度的 2%；100 约 5%。只出现在错开的块和条带上。；默认 40；硬范围 0–100；单位 strength；显隐 {"param":"mode","notEquals":"compression"}；可动画 true */
  readonly rgb_split?: number
  /** 块大小；错位块或压缩方块有多大。10 约为画面高度的 0.3%，细碎；40（默认）约 0.9%；100 约 8%，大块碎片。数字故障的块是宽为高 4 倍的长条，还会混进 2 倍、4 倍大的块。；默认 40；硬范围 0–100；单位 strength；分组 块；显隐 {"param":"mode","notEquals":"bars"}；可动画 true */
  readonly block_size?: number
  /** 条带数；画面切成几条。4 几条宽带；12（默认）；40 细碎的条纹。可以输入到 200。；默认 12；常用 2–40；硬范围 2–200；单位 value；分组 块；显隐 {"param":"mode","equals":"bars"}；可动画 true */
  readonly bars?: number
  /** 角度；条带的走向。0°（默认）水平条带，左右错开；90° 竖直条带，上下错开。；默认 0；硬范围 -180–180；单位 degrees；分组 块；显隐 {"param":"mode","equals":"bars"}；可动画 true */
  readonly angle?: number
  /** 随机种子；换一个数，出错的位置和样子就换一种，强度和节奏不变。同一画面几处都用故障时各填不同的数。；默认 0；硬范围 0–9999；单位 value；分组 块；可动画 false */
  readonly seed?: number
}

export interface DissolveRevealParams {
  /** 进度；显现了多少。0% 完全看不见；50%（默认）出来一半；100% 完整显示，和没加效果一样。做消散就从 100% 调到 0%。；默认 50；硬范围 0–100；单位 percent；可动画 true */
  readonly progress?: number
  /** 方式；按什么图案显现。噪声（默认）细碎的颗粒随机冒出来，像照片显影；点阵是按方格排开的圆点各自先后长满；半调是整齐的网点一起长大，亮的地方先长满。；默认 "noise"；可动画 true */
  readonly mode?: "noise" | "dots" | "halftone"
  /** 大小；颗粒或网点有多大。0 约为画面高度的 0.2%，细得像胶片颗粒；10（默认）约 0.3%，细碎的颗粒；30 约 0.6%，噪声方式下连成斑纹；100 约 8%，大块的图案。；默认 10；硬范围 0–100；单位 strength；分组 图案；可动画 true */
  readonly size?: number
  /** 随机种子；换一个数，颗粒出现的先后就换一种排法，大小和节奏不变。同一画面上几处都用溶解时各填不同的数。；默认 0；硬范围 0–9999；单位 value；分组 图案；显隐 {"param":"mode","in":["noise","dots"]}；可动画 false */
  readonly seed?: number
  /** 柔和度；每一点是一下子出现还是慢慢浮现。0% 一下子出现，最利落；30%（默认）稍有渐显；100% 整体接近淡入，图案若隐若现。；默认 30；硬范围 0–100；单位 percent；分组 边缘；可动画 true */
  readonly softness?: number
  /** 宽度；正在显现的边缘带一圈亮边有多宽。0（默认）没有亮边，也没有光晕；20 细细的一圈；60 以上是宽的亮带，像燃烧的纸边。；默认 0；硬范围 0–100；单位 strength；分组 边缘；可动画 true */
  readonly edge_width?: number
  /** 颜色；亮边和它散出的光晕的颜色。宽度为 0 时不起作用。；默认 "#ffffff"；分组 边缘；可动画 true */
  readonly edge_color?: string
  /** 强度；光晕有多亮。0 不发光；20 含蓄的柔光；40（默认）明显的光晕；70 以上是强烈的霓虹辉光。；默认 40；硬范围 0–100；单位 strength；分组 发光；可动画 true */
  readonly glow_strength?: number
  /** 半径；光晕能散多远。0 只贴着亮边；30（默认）约为画面高度的 2%；100 能铺满大半个画面。；默认 30；硬范围 0–100；单位 strength；分组 发光；可动画 true */
  readonly glow_radius?: number
}

export interface MirrorParams {
  /** 角度；镜面朝哪个方向。0°（默认）沿竖线左右对称；90° 沿横线上下对称；45° 斜着对称。；默认 0；硬范围 -180–180；单位 degrees；可动画 true */
  readonly angle?: number
  /** 中心（水平）；镜面经过的左右位置，按内容宽度算。50%（默认）在正中；70% 时左边留得多，镜像伸出右边；30% 时左边窄的一条翻过去，再往右的地方按“边缘”补（代码图层上是透明）。；默认 50；常用 0–100；硬范围 -100–200；单位 percent；可动画 true */
  readonly center_x?: number
  /** 中心（垂直）；镜面经过的上下位置，按内容高度算，0% 在顶边，100% 在底边。角度为 0° 时不起作用。；默认 50；常用 0–100；硬范围 -100–200；单位 percent；可动画 true */
  readonly center_y?: number
  /** 保留；留下哪一半。前侧（默认）留左半边，角度 90° 时留上半边；后侧留另一半。；默认 "front"；可动画 true */
  readonly side?: "front" | "back"
  /** 边缘；变形取到画面外面时怎么办。重复边缘（默认）把最外一圈像素拉长，四边不出空缺；透明露出下面的轨道；镜像把画面翻过来接上。代码图层上外面一律透明。；默认 "clamp"；只用于调整层 adjust；可动画 true */
  readonly edges?: "transparent" | "clamp" | "mirror"
}

export interface RepeatParams {
  /** 方式；副本怎么排。网格（默认）铺成几行几列；直线沿一个方向排成一串；环形围着原来的位置排成一圈。；默认 "grid"；可动画 true */
  readonly mode?: "grid" | "linear" | "ring"
  /** 列数；网格横着排几个。3（默认）；1 只在竖直方向重复。可以输入到 100。；默认 3；常用 1–12；硬范围 1–100；单位 value；显隐 {"param":"mode","in":["grid"]}；可动画 true */
  readonly columns?: number
  /** 行数；网格竖着排几行。3（默认）；1 只在水平方向重复。可以输入到 100。；默认 3；常用 1–12；硬范围 1–100；单位 value；显隐 {"param":"mode","in":["grid"]}；可动画 true */
  readonly rows?: number
  /** 数量；一共几个副本。5（默认）；环形排 12 个像钟面。可以输入到 100，越多越慢。；默认 5；常用 1–12；硬范围 1–100；单位 value；显隐 {"param":"mode","in":["linear","ring"]}；可动画 true */
  readonly count?: number
  /** 间距；相邻副本之间空多少，按内容的宽和高算。0 紧挨着首尾相接；10%（默认）留一道窄缝；100% 空出一个内容那么宽。；默认 10；常用 0–100；硬范围 0–400；单位 percent；分组 排列；显隐 {"param":"mode","in":["grid","linear"]}；可动画 true */
  readonly spacing?: number
  /** 错位；隔一行往右错开多少，按一格的宽度算。0%（默认）上下对齐；50% 像砌砖一样错开半格。；默认 0；硬范围 0–100；单位 percent；分组 排列；显隐 {"param":"mode","in":["grid"]}；可动画 true */
  readonly stagger?: number
  /** 角度；直线往哪个方向排。0°（默认）横着排；90° 竖着排；45° 斜着排。；默认 0；硬范围 -180–180；单位 degrees；分组 排列；显隐 {"param":"mode","in":["linear"]}；可动画 true */
  readonly angle?: number
  /** 半径；环有多大，按画面高度算。30%（默认）约为画面高度的 30%；0 时副本都叠在一起。可以输入到 400%。；默认 30；常用 0–100；硬范围 0–400；单位 percent；分组 排列；显隐 {"param":"mode","in":["ring"]}；可动画 true */
  readonly radius?: number
  /** 朝向中心；副本跟着环转，底边都朝向圆心，像钟面上的刻度。默认关闭，副本都正着放。；默认 false；分组 排列；显隐 {"param":"mode","in":["ring"]}；可动画 true */
  readonly face_center?: boolean
  /** 逐个缩放；每往外一个副本放大或缩小多少。0%（默认）一样大；−20% 越往外越小；往正越往外越大，网格里最多长满一格。；默认 0；硬范围 -100–100；单位 percent；分组 递变；可动画 true */
  readonly scale_step?: number
  /** 逐个淡出；每往外一个副本淡多少。0%（默认）都不透明；30% 越往外越淡，像渐渐消失的残影。；默认 0；硬范围 0–100；单位 percent；分组 递变；可动画 true */
  readonly opacity_step?: number
}

export interface BulgeParams {
  /** 数量；鼓起或凹进多少。正数鼓起，中间被放大；负数凹进，向中心收缩；50（默认）明显鼓起，约放大两倍；0 不变形。；默认 50；硬范围 -100–100；单位 strength；可动画 true */
  readonly amount?: number
  /** 半径；变形的圆有多大，按画面高度算。30%（默认）约为画面高度的 30%；圆外的画面不动。可以输入到 200%。；默认 30；常用 0–100；硬范围 0–200；单位 percent；可动画 true */
  readonly radius?: number
  /** 中心（水平）；鼓起的中心左右位置，按内容宽度算。50%（默认）在正中。；默认 50；常用 0–100；硬范围 -100–200；单位 percent；可动画 true */
  readonly center_x?: number
  /** 中心（垂直）；鼓起的中心上下位置，按内容高度算，0% 在顶边，100% 在底边。；默认 50；常用 0–100；硬范围 -100–200；单位 percent；可动画 true */
  readonly center_y?: number
  /** 形状；鼓起的样子。平滑（默认）中间放大、向圆边柔和过渡；球面像画面贴在一个球上，越靠近圆边压得越扁。；默认 "smooth"；可动画 true */
  readonly shape?: "smooth" | "sphere"
  /** 边缘；变形取到画面外面时怎么办。重复边缘（默认）把最外一圈像素拉长，四边不出空缺；透明露出下面的轨道；镜像把画面翻过来接上。代码图层上外面一律透明。；默认 "clamp"；只用于调整层 adjust；可动画 true */
  readonly edges?: "transparent" | "clamp" | "mirror"
}

export interface TwirlParams {
  /** 角度；中心转多少度。90°（默认）明显的漩涡；正数顺时针、负数逆时针；360° 以上拧成一圈圈的螺旋，可以输入到 ±1440°。；默认 90；常用 -360–360；硬范围 -1440–1440；单位 degrees；可动画 true */
  readonly angle?: number
  /** 半径；漩涡有多大，按画面高度算。40%（默认）约为画面高度的 40%；半径以外的画面不动。可以输入到 200%。；默认 40；常用 0–100；硬范围 0–200；单位 percent；可动画 true */
  readonly radius?: number
  /** 中心（水平）；漩涡中心的左右位置，按内容宽度算。50%（默认）在正中。；默认 50；常用 0–100；硬范围 -100–200；单位 percent；可动画 true */
  readonly center_x?: number
  /** 中心（垂直）；漩涡中心的上下位置，按内容高度算，0% 在顶边，100% 在底边。；默认 50；常用 0–100；硬范围 -100–200；单位 percent；可动画 true */
  readonly center_y?: number
  /** 方式；怎么转。平滑（默认）从中心到半径连续地越转越少；同心环把圆分成一圈圈，各转各的角度。；默认 "smooth"；可动画 true */
  readonly mode?: "smooth" | "rings"
  /** 边缘；变形取到画面外面时怎么办。重复边缘（默认）把最外一圈像素拉长，四边不出空缺；透明露出下面的轨道；镜像把画面翻过来接上。代码图层上外面一律透明。；默认 "clamp"；只用于调整层 adjust；可动画 true */
  readonly edges?: "transparent" | "clamp" | "mirror"
  /** 环数；分成几圈。6（默认）；20 以上是细密的一圈圈纹路。可以输入到 100。；默认 6；常用 2–20；硬范围 2–100；单位 value；分组 同心环；显隐 {"param":"mode","in":["rings"]}；可动画 true */
  readonly rings?: number
  /** 随机；各圈转的角度差多少。0% 全都转同样的角度；50%（默认）各圈在 0 到角度之间各转各的；100% 有的正转有的反转。；默认 50；硬范围 0–100；单位 percent；分组 同心环；显隐 {"param":"mode","in":["rings"]}；可动画 true */
  readonly ring_random?: number
  /** 柔和度；相邻两圈之间是断开还是连着。0% 一刀切开，边缘利落；30%（默认）稍有过渡；100% 圈与圈连成一片。；默认 30；硬范围 0–100；单位 percent；分组 同心环；显隐 {"param":"mode","in":["rings"]}；可动画 true */
  readonly ring_softness?: number
  /** 随机种子；换一个数，各圈转的角度就换一种搭配，环数和最大角度不变。；默认 0；硬范围 0–9999；单位 value；分组 同心环；显隐 {"param":"mode","in":["rings"]}；可动画 false */
  readonly seed?: number
}

export interface WaveParams {
  /** 幅度；起伏有多大。0 不变形；20（默认）约为画面高度的 1%，轻轻荡漾；100 约 5%，大幅度扭动。可以输入到 400。；默认 20；常用 0–100；硬范围 0–400；单位 strength；可动画 true */
  readonly amount?: number
  /** 波长；一道波有多宽。0 约为画面高度的 1%，细密的波纹；40（默认）约 6%；100 约一个画面高，整幅缓缓弯曲。；默认 40；硬范围 0–100；单位 strength；可动画 true */
  readonly wavelength?: number
  /** 方式；起伏的样子。波浪（默认）一道道平行、整齐的波；流动是不规则的漩流，像隔着流水看。；默认 "wave"；可动画 true */
  readonly mode?: "wave" | "flow"
  /** 边缘；变形取到画面外面时怎么办。重复边缘（默认）把最外一圈像素拉长，四边不出空缺；透明露出下面的轨道；镜像把画面翻过来接上。代码图层上外面一律透明。；默认 "clamp"；只用于调整层 adjust；可动画 true */
  readonly edges?: "transparent" | "clamp" | "mirror"
  /** 方向；波往哪个方向走。0°（默认）往右走，画面上下起伏；90° 往下走，画面左右摆动。；默认 0；硬范围 -180–180；单位 degrees；分组 波形；显隐 {"param":"mode","in":["wave"]}；可动画 true */
  readonly direction?: number
  /** 波形；每道波的形状。正弦（默认）圆滑；三角是折线；方波一段段错开、断口整齐；锯齿缓缓推出再一下跳回。；默认 "sine"；分组 波形；显隐 {"param":"mode","in":["wave"]}；可动画 true */
  readonly waveform?: "sine" | "triangle" | "square" | "sawtooth"
  /** 细节；大漩流里再加多少细碎的小漩涡。0% 只有大而缓的流动；30%（默认）自然；100% 细碎的扭动很多。；默认 30；硬范围 0–100；单位 percent；分组 流动；显隐 {"param":"mode","in":["flow"]}；可动画 true */
  readonly detail?: number
  /** 随机种子；换一个数，流动的花样就换一种，大小和幅度不变。；默认 0；硬范围 0–9999；单位 value；分组 流动；显隐 {"param":"mode","in":["flow"]}；可动画 false */
  readonly seed?: number
  /** 相位；波走到了哪里。往大调，波浪往前推、流动往前流；转一整圈 360° 正好走过一道波。给它打关键帧让波动起来，可以输入到 ±100000°。；默认 0；常用 -180–180；硬范围 -100000–100000；单位 degrees；分组 变化；可动画 true */
  readonly phase?: number
  /** 速度；播放时波自己走多快。0（默认）不动；100 每秒走过一道波；负数反着走。；默认 0；常用 -100–100；硬范围 -400–400；单位 percent；分组 变化；可动画 false */
  readonly speed?: number
}

export interface CornerPinParams {
  /** 左上（水平）；左上角钉到的左右位置。0%（默认）就是原来的左边；按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。；默认 0；常用 -50–150；硬范围 -1000–1100；单位 percent；可动画 true */
  readonly tl_x?: number
  /** 左上（垂直）；左上角钉到的上下位置。0%（默认）就是原来的顶边；按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。；默认 0；常用 -50–150；硬范围 -1000–1100；单位 percent；可动画 true */
  readonly tl_y?: number
  /** 右上（水平）；右上角钉到的左右位置。100%（默认）就是原来的右边；按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。；默认 100；常用 -50–150；硬范围 -1000–1100；单位 percent；可动画 true */
  readonly tr_x?: number
  /** 右上（垂直）；右上角钉到的上下位置。0%（默认）就是原来的顶边；按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。；默认 0；常用 -50–150；硬范围 -1000–1100；单位 percent；可动画 true */
  readonly tr_y?: number
  /** 左下（水平）；左下角钉到的左右位置。0%（默认）就是原来的左边；按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。；默认 0；常用 -50–150；硬范围 -1000–1100；单位 percent；可动画 true */
  readonly bl_x?: number
  /** 左下（垂直）；左下角钉到的上下位置。100%（默认）就是原来的底边；按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。；默认 100；常用 -50–150；硬范围 -1000–1100；单位 percent；可动画 true */
  readonly bl_y?: number
  /** 右下（水平）；右下角钉到的左右位置。100%（默认）就是原来的右边；按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。；默认 100；常用 -50–150；硬范围 -1000–1100；单位 percent；可动画 true */
  readonly br_x?: number
  /** 右下（垂直）；右下角钉到的上下位置。100%（默认）就是原来的底边；按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。；默认 100；常用 -50–150；硬范围 -1000–1100；单位 percent；可动画 true */
  readonly br_y?: number
  /** 边缘；四个角围成的范围以外怎么办。透明（默认）露出下面的轨道，贴屏幕、贴画框时用；重复边缘把最外一圈像素拉长；镜像把画面翻过来接上，铺成透视的地面。代码图层上外面一律透明。；默认 "transparent"；只用于调整层 adjust；可动画 true */
  readonly edges?: "transparent" | "clamp" | "mirror"
}

export interface DisplaceParams {
  /** 数量；挪得多远。0 不变形；20（默认）约为画面高度的 1%；100 约 5%，扭得认不出来。可以输入到 400。；默认 20；常用 0–100；硬范围 0–400；单位 strength；可动画 true */
  readonly amount?: number
  /** 来源；按什么挪。噪声（默认）是柔和起伏的随机图案，像热空气、水面；自身亮度按画面自己的明暗挪，亮处和暗处朝相反方向。；默认 "noise"；可动画 true */
  readonly source?: "noise" | "luma"
  /** 方向；亮的地方往哪边挪，暗的地方往反方向。45°（默认）往右下；0° 往右；90° 往下。；默认 45；硬范围 -180–180；单位 degrees；显隐 {"param":"source","in":["luma"]}；可动画 true */
  readonly angle?: number
  /** 边缘；变形取到画面外面时怎么办。重复边缘（默认）把最外一圈像素拉长，四边不出空缺；透明露出下面的轨道；镜像把画面翻过来接上。代码图层上外面一律透明。；默认 "clamp"；只用于调整层 adjust；可动画 true */
  readonly edges?: "transparent" | "clamp" | "mirror"
  /** 大小；起伏的一块有多大。0 约为画面高度的 1%，细碎的抖动；50（默认）约 8%，像热空气；100 约一半画面高，大片缓慢的弯曲。；默认 50；硬范围 0–100；单位 strength；分组 噪声；显隐 {"param":"source","in":["noise"]}；可动画 true */
  readonly scale?: number
  /** 细节；大起伏里再叠多少细碎的小起伏。0% 只有平缓的大起伏；30%（默认）自然；100% 细碎、像水面的碎波。；默认 30；硬范围 0–100；单位 percent；分组 噪声；显隐 {"param":"source","in":["noise"]}；可动画 true */
  readonly detail?: number
  /** 速度；播放时起伏自己变得多快。0（默认）不动；30 像缓缓上升的热浪；100 每秒换一遍花样。；默认 0；常用 -100–100；硬范围 -400–400；单位 percent；分组 噪声；显隐 {"param":"source","in":["noise"]}；可动画 false */
  readonly speed?: number
  /** 随机种子；换一个数，起伏的花样就换一种，大小和数量不变。；默认 0；硬范围 0–9999；单位 value；分组 噪声；显隐 {"param":"source","in":["noise"]}；可动画 false */
  readonly seed?: number
}
export type BuiltinLayerEffectDescriptor =
  | { readonly id: 'blur'; readonly key?: string; readonly params?: BlurParams }
  | { readonly id: 'sharpen'; readonly key?: string; readonly params?: SharpenParams }
  | { readonly id: 'color_grade'; readonly key?: string; readonly params?: ColorGradeParams }
  | { readonly id: 'black_white'; readonly key?: string; readonly params?: BlackWhiteParams }
  | { readonly id: 'invert'; readonly key?: string; readonly params?: InvertParams }
  | { readonly id: 'gradient_map'; readonly key?: string; readonly params?: GradientMapParams }
  | { readonly id: 'posterize'; readonly key?: string; readonly params?: PosterizeParams }
  | { readonly id: 'glow'; readonly key?: string; readonly params?: GlowParams }
  | { readonly id: 'light_sweep'; readonly key?: string; readonly params?: LightSweepParams }
  | { readonly id: 'lens_flare'; readonly key?: string; readonly params?: LensFlareParams }
  | { readonly id: 'light_leak'; readonly key?: string; readonly params?: LightLeakParams }
  | { readonly id: 'drop_shadow'; readonly key?: string; readonly params?: DropShadowParams }
  | { readonly id: 'stroke'; readonly key?: string; readonly params?: StrokeParams }
  | { readonly id: 'vignette'; readonly key?: string; readonly params?: VignetteParams }
  | { readonly id: 'chromatic_aberration'; readonly key?: string; readonly params?: ChromaticAberrationParams }
  | { readonly id: 'film_grain'; readonly key?: string; readonly params?: FilmGrainParams }
  | { readonly id: 'halftone'; readonly key?: string; readonly params?: HalftoneParams }
  | { readonly id: 'dither_pattern'; readonly key?: string; readonly params?: DitherPatternParams }
  | { readonly id: 'paper'; readonly key?: string; readonly params?: PaperParams }
  | { readonly id: 'scratches'; readonly key?: string; readonly params?: ScratchesParams }
  | { readonly id: 'mosaic'; readonly key?: string; readonly params?: MosaicParams }
  | { readonly id: 'glitch'; readonly key?: string; readonly params?: GlitchParams }
  | { readonly id: 'dissolve_reveal'; readonly key?: string; readonly params?: DissolveRevealParams }
  | { readonly id: 'mirror'; readonly key?: string; readonly params?: MirrorParams }
  | { readonly id: 'repeat'; readonly key?: string; readonly params?: RepeatParams }
  | { readonly id: 'bulge'; readonly key?: string; readonly params?: BulgeParams }
  | { readonly id: 'twirl'; readonly key?: string; readonly params?: TwirlParams }
  | { readonly id: 'wave'; readonly key?: string; readonly params?: WaveParams }
  | { readonly id: 'corner_pin'; readonly key?: string; readonly params?: CornerPinParams }
  | { readonly id: 'displace'; readonly key?: string; readonly params?: DisplaceParams }
export interface LookDescriptor { readonly id: 'look'; readonly key?: string; readonly params: { readonly name: string; readonly knobs?: Readonly<Record<string, number>> } }
/** 旧版 henji-effects（1.0.0）的 blur() 产出并进“模糊”前的 ID，宿主按同一换算转成 blur；新代码直接写 blur。 */
export interface RetiredBlurDescriptor { readonly id: 'gaussian_blur' | 'directional_blur' | 'zoom_blur' | 'lens_blur'; readonly key?: string; readonly params?: object }
export type EffectDescriptor = BuiltinLayerEffectDescriptor | LookDescriptor | RetiredBlurDescriptor
export interface EffectOptions { readonly key?: string }
export declare function blur(params?: BlurParams, options?: EffectOptions): { readonly id: 'blur'; readonly key?: string; readonly params: BlurParams }
export declare function sharpen(params?: SharpenParams, options?: EffectOptions): { readonly id: 'sharpen'; readonly key?: string; readonly params: SharpenParams }
export declare function colorGrade(params?: ColorGradeParams, options?: EffectOptions): { readonly id: 'color_grade'; readonly key?: string; readonly params: ColorGradeParams }
export declare function blackWhite(params?: BlackWhiteParams, options?: EffectOptions): { readonly id: 'black_white'; readonly key?: string; readonly params: BlackWhiteParams }
export declare function invert(params?: InvertParams, options?: EffectOptions): { readonly id: 'invert'; readonly key?: string; readonly params: InvertParams }
export declare function gradientMap(params?: GradientMapParams, options?: EffectOptions): { readonly id: 'gradient_map'; readonly key?: string; readonly params: GradientMapParams }
export declare function posterize(params?: PosterizeParams, options?: EffectOptions): { readonly id: 'posterize'; readonly key?: string; readonly params: PosterizeParams }
export declare function glow(params?: GlowParams, options?: EffectOptions): { readonly id: 'glow'; readonly key?: string; readonly params: GlowParams }
export declare function lightSweep(params?: LightSweepParams, options?: EffectOptions): { readonly id: 'light_sweep'; readonly key?: string; readonly params: LightSweepParams }
export declare function lensFlare(params?: LensFlareParams, options?: EffectOptions): { readonly id: 'lens_flare'; readonly key?: string; readonly params: LensFlareParams }
export declare function lightLeak(params?: LightLeakParams, options?: EffectOptions): { readonly id: 'light_leak'; readonly key?: string; readonly params: LightLeakParams }
export declare function shadow(params?: DropShadowParams, options?: EffectOptions): { readonly id: 'drop_shadow'; readonly key?: string; readonly params: DropShadowParams }
export declare function stroke(params?: StrokeParams, options?: EffectOptions): { readonly id: 'stroke'; readonly key?: string; readonly params: StrokeParams }
export declare function vignette(params?: VignetteParams, options?: EffectOptions): { readonly id: 'vignette'; readonly key?: string; readonly params: VignetteParams }
export declare function chromaticAberration(params?: ChromaticAberrationParams, options?: EffectOptions): { readonly id: 'chromatic_aberration'; readonly key?: string; readonly params: ChromaticAberrationParams }
export declare function grain(params?: FilmGrainParams, options?: EffectOptions): { readonly id: 'film_grain'; readonly key?: string; readonly params: FilmGrainParams }
export declare function halftone(params?: HalftoneParams, options?: EffectOptions): { readonly id: 'halftone'; readonly key?: string; readonly params: HalftoneParams }
export declare function ditherPattern(params?: DitherPatternParams, options?: EffectOptions): { readonly id: 'dither_pattern'; readonly key?: string; readonly params: DitherPatternParams }
export declare function paper(params?: PaperParams, options?: EffectOptions): { readonly id: 'paper'; readonly key?: string; readonly params: PaperParams }
export declare function scratches(params?: ScratchesParams, options?: EffectOptions): { readonly id: 'scratches'; readonly key?: string; readonly params: ScratchesParams }
export declare function mosaic(params?: MosaicParams, options?: EffectOptions): { readonly id: 'mosaic'; readonly key?: string; readonly params: MosaicParams }
export declare function glitch(params?: GlitchParams, options?: EffectOptions): { readonly id: 'glitch'; readonly key?: string; readonly params: GlitchParams }
export declare function dissolve(params?: DissolveRevealParams, options?: EffectOptions): { readonly id: 'dissolve_reveal'; readonly key?: string; readonly params: DissolveRevealParams }
export declare function mirror(params?: MirrorParams, options?: EffectOptions): { readonly id: 'mirror'; readonly key?: string; readonly params: MirrorParams }
export declare function repeat(params?: RepeatParams, options?: EffectOptions): { readonly id: 'repeat'; readonly key?: string; readonly params: RepeatParams }
export declare function bulge(params?: BulgeParams, options?: EffectOptions): { readonly id: 'bulge'; readonly key?: string; readonly params: BulgeParams }
export declare function twirl(params?: TwirlParams, options?: EffectOptions): { readonly id: 'twirl'; readonly key?: string; readonly params: TwirlParams }
export declare function wave(params?: WaveParams, options?: EffectOptions): { readonly id: 'wave'; readonly key?: string; readonly params: WaveParams }
export declare function cornerPin(params?: CornerPinParams, options?: EffectOptions): { readonly id: 'corner_pin'; readonly key?: string; readonly params: CornerPinParams }
export declare function displace(params?: DisplaceParams, options?: EffectOptions): { readonly id: 'displace'; readonly key?: string; readonly params: DisplaceParams }
export declare function look(name: string, knobs?: Readonly<Record<string, number>>, options?: EffectOptions): LookDescriptor
