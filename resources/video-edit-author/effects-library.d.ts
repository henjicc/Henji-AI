// 由 scripts/generate-author-effects.ts 生成，请修改效果登记后重新生成。
export interface GaussianBlurParams {
  /** 模糊尺度；高斯标准差占完整文档或序列画面高度的比例。0 无模糊；0.003 轻微柔化；0.009 背景虚化；0.03 强烈虚化。与视口、瓦片及预览缩放无关。；默认 0.009；硬范围 0–1.7976931348623157e+308；单位 fraction_height；可动画 true */
  readonly sigma_fraction_height?: number
  /** 模糊方向；both 同时模糊两轴；horizontal 只水平；vertical 只垂直。；默认 "both"；可动画 true */
  readonly axis?: "both" | "horizontal" | "vertical"
  /** 边缘处理；clamp 使用最近的画面边缘像素；transparent 把画面外视为透明。瓦片接缝始终读取真实相邻像素。；默认 "clamp"；可动画 true */
  readonly edge_mode?: "clamp" | "transparent"
}

export interface DirectionalBlurParams {
  /** 方向；拖影方向角度：0 水平，90 垂直，45 斜向；正负 180 等价。；默认 0；硬范围 -180–180；单位 degrees；可动画 true */
  readonly direction?: number
  /** 模糊长度；拖影长度：0 无；30 ≈ 画面高度的 3% 的轻微动感；100 ≈ 画面高度的 10% 的强烈拖影。；默认 30；硬范围 0–100；单位 strength；可动画 true */
  readonly length?: number
}

export interface ZoomBlurParams {
  /** 强度；0 无；20 ≈ 轻微冲刺感；50 ≈ 明显放射；100 ≈ 边缘几乎完全拉丝（约 20% 的缩放拖影）。；默认 30；硬范围 0–100；单位 strength；可动画 true */
  readonly strength?: number
  /** 中心水平位置；放射中心的水平位置：0 左边缘，50 居中，100 右边缘。；默认 50；硬范围 0–100；单位 percent；可动画 true */
  readonly center_x?: number
  /** 中心垂直位置；放射中心的垂直位置：0 上边缘，50 居中，100 下边缘。；默认 50；硬范围 0–100；单位 percent；可动画 true */
  readonly center_y?: number
}

export interface SharpenParams {
  /** 锐化量；0 无；20 ≈ 轻微提清晰度；50 ≈ 明显锐利；100 ≈ 很强，容易出现白边。；默认 30；硬范围 0–100；单位 strength；可动画 true */
  readonly amount?: number
}

export interface LensBlurParams {
  /** 半径；半径占逻辑画幅高度的比例，不随图层 bounds 改变。；默认 0.009；硬范围 0–1.7976931348623157e+308；单位 fraction_height；可动画 true */
  readonly radius_fraction_height?: number
}

export interface BlackWhiteParams {
}

export interface MosaicParams {
  /** 块大小；0 无；10 ≈ 细小方块（画面高度的 1%）；30 ≈ 常规打码（3%）；100 ≈ 很大的色块（10%）。；默认 30；硬范围 0–100；单位 strength；可动画 true */
  readonly block_size?: number
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

export interface GlowParams {
  /** 强度；光晕有多亮。0 不发光；20 含蓄的柔光；40（默认）明显的光晕；70 以上是强烈的霓虹辉光。；默认 40；硬范围 0–100；单位 strength；可动画 true */
  readonly strength?: number
  /** 半径；光晕能散多远。0 只贴着边缘一圈；60（默认）约为画面高度的 8%；100 能铺满大半个画面。只改变散开的距离，中心亮度基本不变。；默认 60；硬范围 0–100；单位 strength；可动画 true */
  readonly radius?: number
  /** 阈值；画面里多亮的地方才发光。0 所有内容都发光（给文字加外发光时用）；60（默认）只有明显的亮部；85 以上只剩灯光、反光这类最亮处。；默认 60；硬范围 0–100；单位 strength；分组 输入；可动画 true */
  readonly threshold?: number
  /** 阈值平滑度；阈值附近是一刀切还是慢慢过渡。0 刚过阈值才发光，边界生硬；30（默认）自然；100 接近阈值的部分也微微发光。；默认 30；硬范围 0–100；单位 strength；分组 输入；可动画 true */
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
  /** 数量；颜色错开多远。0 没有色差；20（默认）轻微的镜头感；60 明显的彩边；100 约为画面高度的 2%，故障风。；默认 0；硬范围 0–100；单位 strength；分组 色差；可动画 true */
  readonly aberration_amount?: number
  /** 方式；从中心向外（默认）像真实镜头，越靠近画面边缘错得越开；固定方向让整个画面朝同一个方向错开，更像故障效果。；默认 "radial"；分组 色差；可动画 true */
  readonly aberration_mode?: "radial" | "directional"
  /** 角度；固定方向时颜色错开的方向。0（默认）左右错开，90 上下错开。；默认 0；硬范围 -180–180；单位 degrees；分组 色差；显隐 {"param":"aberration_mode","in":["directional"]}；可动画 true */
  readonly aberration_angle?: number
  /** 通道；哪两种颜色分开：前一种往外偏，后一种往里偏，第三种不动。红与蓝（默认）外红内蓝，最像真实镜头。；默认 "red_blue"；分组 色差；可动画 true */
  readonly aberration_channels?: "red_blue" | "red_green" | "green_blue"
  /** 柔和度；彩边是清楚的三层重影还是柔和的彩虹过渡。0 三层颜色硬分开，像数码故障；50（默认）柔和；100 拉成连续的彩虹色带。；默认 50；硬范围 0–100；单位 strength；分组 色差；可动画 true */
  readonly aberration_smoothness?: number
  /** 着色量；把光晕换成下面的颜色的程度。0（默认）保持发光内容本来的颜色；100 完全换成从内圈到外圈的颜色。白字配彩色光晕时设 100。；默认 0；硬范围 0–100；单位 strength；分组 着色；可动画 true */
  readonly tint?: number
  /** 内圈颜色；靠近发光内容的光晕颜色。着色量为 0 时不起作用。；默认 "#ffffff"；分组 着色；可动画 true */
  readonly tint_inner?: string
  /** 外圈颜色；远处光晕的颜色，从内圈颜色渐变过来；和内圈颜色相同就是单色光晕。着色量为 0 时不起作用。；默认 "#ffffff"；分组 着色；可动画 true */
  readonly tint_outer?: string
  /** 分辨率；光晕按画面多大的分辨率计算。50%（默认）又快又好；100% 贴近内容的光更细腻，细小亮点在运动中更稳，计算量约为默认的三倍；25% 最快，近处的光略糊。亮度和光晕大小不随它变。；默认 50；硬范围 25–100；单位 percent；分组 质量；可动画 false */
  readonly resolution?: number
  /** 抖动；给光晕加极细的噪点，盖住平滑渐变里一圈圈的色带。0 关闭；50（默认）刚好看不出噪点；100 色带最少，但暗处能看到细微的颗粒。；默认 50；硬范围 0–100；单位 strength；分组 质量；可动画 true */
  readonly dither?: number
  /** 单色抖动；抖动的噪点只改变明暗、不带颜色。默认关闭，彩色噪点更不容易被看出来。；默认 false；分组 质量；可动画 true */
  readonly dither_mono?: boolean
  /** 原画不透明度；原来的画面还保留多少。100%（默认）光晕加在原画上；0% 只留下光晕，适合单独放一层再叠加。；默认 100；硬范围 0–100；单位 percent；分组 输出；可动画 true */
  readonly source_opacity?: number
  /** 视图；最终效果（默认）显示加了光晕的画面；发光来源只显示过了阈值、会发光的部分，用来检查阈值调得对不对。；默认 "final"；分组 输出；可动画 true */
  readonly view?: "final" | "source"
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
export type BuiltinLayerEffectDescriptor =
  | { readonly id: 'gaussian_blur'; readonly params?: GaussianBlurParams }
  | { readonly id: 'directional_blur'; readonly params?: DirectionalBlurParams }
  | { readonly id: 'zoom_blur'; readonly params?: ZoomBlurParams }
  | { readonly id: 'sharpen'; readonly params?: SharpenParams }
  | { readonly id: 'lens_blur'; readonly params?: LensBlurParams }
  | { readonly id: 'black_white'; readonly params?: BlackWhiteParams }
  | { readonly id: 'mosaic'; readonly params?: MosaicParams }
  | { readonly id: 'chromatic_aberration'; readonly params?: ChromaticAberrationParams }
  | { readonly id: 'glow'; readonly params?: GlowParams }
  | { readonly id: 'color_grade'; readonly params?: ColorGradeParams }
export interface LookDescriptor { readonly id: 'look'; readonly params: { readonly name: string } }
export type EffectDescriptor = BuiltinLayerEffectDescriptor | LookDescriptor
export type BlurParams = (GaussianBlurParams & { readonly mode?: 'gaussian' }) | (DirectionalBlurParams & { readonly mode: 'directional' }) | (ZoomBlurParams & { readonly mode: 'radial' }) | (LensBlurParams & { readonly mode: 'lens' })
export declare function sharpen(params?: SharpenParams): { readonly id: 'sharpen'; readonly params: SharpenParams }
export declare function blackWhite(params?: BlackWhiteParams): { readonly id: 'black_white'; readonly params: BlackWhiteParams }
export declare function mosaic(params?: MosaicParams): { readonly id: 'mosaic'; readonly params: MosaicParams }
export declare function chromaticAberration(params?: ChromaticAberrationParams): { readonly id: 'chromatic_aberration'; readonly params: ChromaticAberrationParams }
export declare function glow(params?: GlowParams): { readonly id: 'glow'; readonly params: GlowParams }
export declare function colorGrade(params?: ColorGradeParams): { readonly id: 'color_grade'; readonly params: ColorGradeParams }
export declare function blur(params?: BlurParams): BuiltinLayerEffectDescriptor
export declare function look(name: string, knobs?: Readonly<Record<string, never>>): LookDescriptor
