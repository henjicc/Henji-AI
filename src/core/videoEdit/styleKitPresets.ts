import { styleKitSchema, type StyleKit } from './styleKit'
import { VIDEO_EDIT_STYLE_PALETTES, VIDEO_EDIT_STYLE_STATUS_COLORS } from '../theme/colorTokens'
import { SIGNATURE_OVERLAYS, SIGNATURE_TITLES } from './styleKitSignatures'

type Color = readonly [number, number, number, number]
const hex = (color: Color): string => `#${color.slice(0, 3).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
type Literal = number | string | boolean | readonly number[] | { [key: string]: Literal }
const literal = (value: Literal): string => typeof value === 'number' ? String(Math.round(value * 10000) / 10000)
  : typeof value === 'string' ? JSON.stringify(value) : typeof value === 'boolean' ? String(value)
    : Array.isArray(value) ? `[${value.map(channel => literal(channel)).join(', ')}]` : `{ ${Object.entries(value).map(([key, member]) => `${key}: ${literal(member)}`).join(', ')} }`
/**
 * The examples are written against a local `s` table. Each example declares only the values it reads, as plain
 * constants at the top of render — the same habit the guide asks the assistant to follow in new work.
 */
function bake(source: string, values: Record<string, Record<string, Literal>>): string {
  const used = new Map<string, Set<string>>()
  for (const match of source.matchAll(/\bs\.([a-zA-Z]+)\.([a-zA-Z0-9]+)/g)) { if (!used.has(match[1])) used.set(match[1], new Set()); used.get(match[1])!.add(match[2]) }
  const table = [...used].map(([group, keys]) => `${group}: { ${[...keys].map(key => { if (values[group]?.[key] === undefined) throw new Error(`示例缺少取值 ${group}.${key}`); return `${key}: ${literal(values[group][key])}` }).join(', ')} }`).join(', ')
  return source.replace('const s = ctx.style;', `const s = { ${table} };`)
}
function typeScale(ratio: number): Record<string, number> {
  const base = 36 / 1080
  return Object.fromEntries(['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'display'].map((key, index) => [key, base * ratio ** (index - 2)]))
}

interface Built { name: string; guide: string; signature: keyof typeof SIGNATURE_TITLES; values: Record<string, Record<string, Literal>> }
function presetValues(palette: readonly Color[], display: { family: string; weight: number }, ratio: number, motion: Record<string, Literal>, strokeWidth: number, safeMargin: number): Built['values'] {
  const [bg, surface, fg, muted, accent, accent2] = palette
  return {
    palette: { bg, surface, fg, muted, accent, accent2, positive: VIDEO_EDIT_STYLE_STATUS_COLORS.positive, negative: VIDEO_EDIT_STYLE_STATUS_COLORS.negative },
    fonts: { display, body: { family: 'Source Han Sans SC', weight: 400 }, mono: { family: 'JetBrains Mono', weight: 500 } },
    typeScale: typeScale(ratio), motion, shape: { strokeWidth }, layout: { safeMargin },
  }
}

const minimal = VIDEO_EDIT_STYLE_PALETTES[0]; const tech = VIDEO_EDIT_STYLE_PALETTES[1]; const variety = VIDEO_EDIT_STYLE_PALETTES[3]
const BUILT: Built[] = [
  {
    name: '克制高级', signature: 'minimal',
    values: presetValues(minimal, { family: 'Source Han Sans SC', weight: 600 }, 1.333, { enterDuration: .7, exitDuration: .45, emphasisDuration: .4, transitionDuration: .6, stagger: .08, enterEase: 'expoOut', exitEase: 'cubicIn', emphasisEase: 'quartOut', transitionEase: 'cubicInOut', travel: .03 }, .002, .08),
    guide: `## 定位
少而精的高级感：大面积留白、精确对齐、粗细对比，一个强调色，动作落地即静止。适合品牌片、产品发布、高端访谈。

## 核心理念
- 留白：画面不满，主体有呼吸空间。做到的标准：同屏只有一个视觉焦点；文字与图形合计不超过画面的 35%；离画边至少 8% 画高。
- 克制：动作少、幅度小，靠节奏取胜而不是特效。做到的标准：同一时刻最多两个元素在动；位移不超过画高 4%；没有回弹、没有持续漂浮。

## 视觉语言
- 配色：底色 ${hex(minimal[0])}，面板 ${hex(minimal[1])}，正文 ${hex(minimal[2])}，次要文字 ${hex(minimal[3])}。强调色 ${hex(minimal[4])}，必须只用在一个焦点上；辅助色 ${hex(minimal[5])} 尽量只做细线或小标签。
- 字体：标题与正文都用一款现代中文黑体，首选 Source Han Sans SC（思源黑体），本机没有时用已安装的最接近的黑体；靠字重（600 对 400）和字号拉开层级，不靠换颜色；英文小标签用宽字距大写。
- 版式：左对齐为主，元素落在 12 列网格上；细线（约 0.2% 画高）可以作为唯一装饰。
- 质感：极轻的投影只为保证可读，不做发光、渐变和描边。

## 动效语言
- 入场 0.6–0.8 秒，强减速（expoOut，约 cubic-bezier(.16,1,.3,1)），从下方 3% 画高处轻抬淡入。
- 出场比入场快，约 0.45 秒，cubicIn。
- 多个元素错峰 0.08 秒以上，先线后字、先主后次。
- 必须落地即停：不回弹、不呼吸、不漂浮。强调只用字重、字距或颜色的缓慢变化。

## 节奏与剪辑
- 镜头 2–4 秒，切在语句结束处。
- 转场优先匹配切（动作或形状衔接），其次短叠化；不用花哨转场。
- 不用音效；配乐在人声时压低。

## 文字与字幕
- 开场：一根细线先画出，眉题、主标题、说明错峰出现后静止。
- 人名条：没有底板，一根竖线加姓名与身份两行左对齐。
- 强调词：单个词放大，宽字距慢慢收拢显影，下方细线配合。
- 字幕：白字细描边加轻投影，居中偏下，不加底框。

## 必须
- 一个画面只有一个强调色焦点。
- 所有动作落地即停，不使用回弹、弹性或跳动曲线。
- 文字和画边保持至少 8% 画高的距离。

## 避免
- 满屏信息卡、多处强调色同时出现。
- 发光、粗描边、贴纸、彩色渐变。
- 文字逐字蹦出或旋转入场。

## 可以自由发挥
- 运动方向随语义变化（上抬、左移都可以），时长可在 ±20% 内浮动。
- 衬线体可以用在引言或数字上制造对比。
- 留白的位置和构图每次可以不同。

## 画面生成提示
极简高级的画面：大面积干净留白，低饱和冷灰色调，柔和侧光，构图克制，主体居于三分线。`,
  },
  {
    name: '科技信息', signature: 'tech',
    values: presetValues(tech, { family: 'HarmonyOS Sans SC', weight: 600 }, 1.333, { enterDuration: .5, exitDuration: .32, emphasisDuration: .3, transitionDuration: .4, stagger: .08, enterEase: 'quartOut', exitEase: 'cubicIn', emphasisEase: 'quartOut', transitionEase: 'quartInOut', travel: .03 }, .0015, .06),
    guide: `## 定位
信息清晰的科技语言：深色底、细线网格、等宽数字、亮色只标当前焦点，像一块精密的仪表盘。适合科技教程、数码评测、数据讲解。

## 核心理念
- 精确：一切对齐到网格，同类元素规格一致。做到的标准：元素左边缘落在网格列上；同类线宽和圆角一致；数字一律等宽。
- 信息优先：装饰服务于信息，不抢主体。做到的标准：网格、角标等装饰亮度明显低于正文；每一拍只出现一个新信息；数字和界面都是真实内容。

## 视觉语言
- 配色：底色 ${hex(tech[0])}，面板 ${hex(tech[1])}（约 88% 不透明），正文 ${hex(tech[2])}，次要 ${hex(tech[3])}。强调色 ${hex(tech[4])} 只标当前项；第二强调 ${hex(tech[5])} 用于对比数据。正向数据用 ${hex(VIDEO_EDIT_STYLE_STATUS_COLORS.positive)}，负向用 ${hex(VIDEO_EDIT_STYLE_STATUS_COLORS.negative)}，职责固定。
- 字体：标题用几何感的现代中文黑体 600，首选 HarmonyOS Sans SC，本机没有时用已安装的最接近的黑体；数字、编号、标签一律等宽字体，首选 JetBrains Mono，没有时用本机任意等宽字体。
- 版式：16×9 细网格作为底纹（约 18% 不透明度）；信息区用四角括号框出；小圆角或直角。
- 质感：强调色可以带一点辉光（半径约 1–2% 画高），其他元素不发光。

## 动效语言
- 入场 0.5 秒左右，quartOut 利落减速；出场 0.32 秒，cubicIn。
- 文字逐字打出（像终端输出），框线从两侧夹紧，扫描线扫过一次。
- 不回弹；动作干脆，停住就停住。

## 节奏与剪辑
- 镜头 1.5–3 秒，按信息拍切；转场以硬切为主。
- 少量短促的电子音效标记新信息出现；人声时压低配乐。

## 文字与字幕
- 开场：网格底纹上四角括号框住标题，标题逐字打出，旁边一行等宽状态标签和数据角标。
- 人名条：半透明深色底板，左侧一根发光亮条，上方等宽编号，姓名逐字出现。
- 强调词：方括号框从两侧收紧套住关键词，旁边一行等宽注释（如涨幅）。
- 字幕：深色半透明底板加白字，底板圆角很小。

## 必须
- 数字一律使用等宽字体。
- 语义色职责固定：正向绿、负向红、强调色只标当前项。
- 网格和角标不压在正文上，亮度低于正文。

## 避免
- 满屏闪烁的假界面、随机跳动的数字。
- 多种强调色混用、彩虹渐变。
- 圆润卡通的形状和弹跳动作。

## 可以自由发挥
- 网格密度、括号样式、扫描方向可以按画面调整。
- 信息拍时长按内容长短在 1.5–3 秒之间变化。
- 可以加入真实界面截图、图表、代码片段作为主体。

## 画面生成提示
科技感画面：深蓝黑色调，冷青色点光，精密干净的产品或界面特写，浅景深，细腻反光。`,
  },
  {
    name: '综艺花字', signature: 'variety',
    values: presetValues(variety, { family: 'Noto Sans SC', weight: 900 }, 1.5, { enterDuration: .3, exitDuration: .2, emphasisDuration: .25, transitionDuration: .3, stagger: .045, enterEase: 'backOut', exitEase: 'cubicIn', emphasisEase: 'backOut', transitionEase: 'quartOut', travel: .06 }, .002, .06),
    guide: `## 定位
热闹的综艺花字：粗字撞色、贴纸感、一次回弹，字跟着情绪和笑点走。适合 vlog、综艺剪辑、搞笑短视频。

## 核心理念
- 有梗：字跟着情绪和笑点走。做到的标准：花字只出现在强调词或情绪点；每次花字出现都有一个落点（音效或剪切）。
- 收得住：热闹但不吵。做到的标准：花字落地后停住；同屏花字不超过两处；不遮挡人脸和原字幕。

## 视觉语言
- 配色：底色 ${hex(variety[0])}，面板 ${hex(variety[1])}，主字色 ${hex(variety[2])}。强调色 ${hex(variety[4])} 用于开心、高能；第二强调 ${hex(variety[5])} 用于吐槽、反转，情绪配色固定。
- 字体：最粗一档的中文黑体，首选 Noto Sans SC 900，本机没有时用已安装的最粗黑体；花字加深色粗描边（约 1–1.5% 画高）和不模糊的硬投影。
- 版式：贴纸化——胶囊、爆炸形、色块垫底，整体可以歪 4–10 度；周围可点缀少量彩点。
- 质感：纯色平涂，不做写实光影。

## 动效语言
- 入场 0.25–0.35 秒，backOut 一次回弹（过冲 8–15%）；出场更快，约 0.2 秒。
- 逐字弹出，字间错峰 1–2 帧；强调时可以有一圈小点炸开。
- 回弹只有一次，落地后停住，不持续抖动。

## 节奏与剪辑
- 镜头 0.8–2.5 秒，切在动作和笑点上；以硬切为主，偶尔用快速缩放冲切。
- 音效丰富：花字出现配短促音效（“咚”“叮”“嗖”）；人声时压低配乐。

## 文字与字幕
- 开场：撞色爆炸贴纸垫底，粗字花字歪着弹出，旁边一句吐槽小标签。
- 人名条：歪着的撞色胶囊弹入，名字后面跟一个身份小贴纸。
- 强调词：大字逐个弹跳落地，硬投影加描边，周围一圈小点炸开。
- 字幕：粗黑体白字，深色粗描边加强调色硬投影，字号比普通字幕大三成。

## 必须
- 回弹只有一次，落地后停住。
- 同屏花字不超过两处，不遮挡人脸和原字幕。
- 情绪配色固定：开心用强调色，吐槽用第二强调色。

## 避免
- 整句旁白都做成花字。
- 花字循环闪烁、满屏乱飞、持续抖动。
- 细字体、低对比、写实光影。

## 可以自由发挥
- 贴纸形状（胶囊、爆炸、对话框）和倾斜角度随画面变化。
- 花字位置跟着人物和构图走。
- 可以加入表情符号式的小图形，只要不抢人脸。

## 画面生成提示
综艺感画面：高饱和暖色，明亮均匀的打光，人物表情夸张生动，背景干净有色彩。`,
  },
]

/** Three deliberately different built-ins; each example is the style's own opener, lower third and emphasis. */
export const BUILTIN_STYLE_KITS: readonly StyleKit[] = BUILT.map((preset, index) => {
  const overlays = SIGNATURE_OVERLAYS[preset.signature]
  return styleKitSchema.parse({
    id: `builtin:style:${index}`, name: preset.name, guide: preset.guide,
    examples: [
      { id: 'opener', title: '开场标题', note: '演示视觉语言的配色与字体层级、动效语言的错峰入场，以及“文字与字幕”里的开场写法。', source: bake(SIGNATURE_TITLES[preset.signature], preset.values) },
      { id: 'lower-third', title: '人名条', note: '演示人名条的版式与入场节奏；用在人物首次出现。', source: bake(overlays.lowerThird, preset.values) },
      { id: 'emphasis', title: '强调词', note: '演示强调的动作语言与“必须”里的落地规矩。', source: bake(overlays.emphasis, preset.values) },
    ],
  })
})
