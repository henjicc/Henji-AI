import { styleKitSchema, type StyleKit, type StyleKitContent, type StyleConcept, type StyleRule } from './styleKit'
import { VIDEO_EDIT_STYLE_PALETTES, VIDEO_EDIT_STYLE_STATUS_COLORS } from '../theme/colorTokens'
import { fontMatchesName, type FontFaceInfo } from '../fonts/catalog'
import { SIGNATURE_OVERLAYS, SIGNATURE_TITLES } from './styleKitSignatures'

const palettes = VIDEO_EDIT_STYLE_PALETTES
const header = (name: string, duration = 5): string => `export default { apiVersion: 1, languageVersion: 3, name: "${name}", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: ${duration}, seed: 42,`
const param = (key: string, title: string, value: string, max = 200): string => `${key}: { type: "text", title: "${title}", default: "${value}", maxLength: ${max} }`
/** Every built-in style renders this same board, so styles are compared on identical content. */
export const STYLE_BOARD_KINDS = ['title', 'lower_third', 'chapter', 'emphasis', 'data', 'caption'] as const
export type StyleBoardKind = typeof STYLE_BOARD_KINDS[number]
const BOARD_NAMES: Record<StyleBoardKind, string> = { title: '标题', lower_third: '人名条', chapter: '章节卡', emphasis: '强调字', data: '数据卡', caption: '字幕' }
/** These are real v3 sources: all visual styling and timing read the injected tokens. */
export function makeStyleKitSample(kind: StyleBoardKind): string {
  if (kind === 'chapter') return `${header('chapter')}
  parameters: { ${param('index', '序号', '01', 8)}, ${param('title', '章节', '从一个问题开始', 120)} },
  render(ctx) {
    const s = ctx.style; const m = s.layout.safeMargin * ctx.height;
    const bar = tween(ctx.time, 0.1, s.motion.transitionDuration, 0, 1, s.motion.transitionEase);
    const p = tween(ctx.time, 0.1 + s.motion.stagger * 2, s.motion.enterDuration, 0, 1, s.motion.enterEase);
    const out = tween(ctx.time, 4.3, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const lift = (1 - p) * s.motion.travel * ctx.height;
    return [group({ id: "chapter", x: m * 1.5, y: ctx.height * 0.42, opacity: clamp(out, 0, 1) }, [
      rect({ id: "rule", x: 0, y: 0, width: ctx.width * 0.5 * clamp(bar, 0, 1), height: s.shape.strokeWidth * ctx.height * 2, fill: s.palette.accent }),
      text({ id: "index", x: 0, y: s.shape.spacing2 * ctx.height + lift, text: ctx.params.index, fontFamily: s.fonts.mono.family, fontWeight: s.fonts.mono.weight, fontSize: s.typeScale.md * ctx.height, color: s.palette.accent, baseline: "top", opacity: clamp(p, 0, 1) }),
      text({ id: "title", x: 0, y: s.shape.spacing3 * ctx.height + s.typeScale.md * ctx.height * 1.4 + lift, text: ctx.params.title, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: s.typeScale.xxl * ctx.height, color: s.palette.fg, baseline: "top", maxWidth: ctx.width * 0.7, maxLines: 1, opacity: clamp(p, 0, 1) })
    ])];
  }
}`
  if (kind === 'emphasis') return `${header('emphasis', 4)}
  parameters: { ${param('word', '强调词', '关键一步', 40)} },
  render(ctx) {
    const s = ctx.style; const size = s.typeScale.display * ctx.height;
    const pop = tween(ctx.time, 0.2, s.motion.emphasisDuration, 0.6, 1, s.motion.emphasisEase);
    const grow = tween(ctx.time, 0.2 + s.motion.emphasisDuration, s.motion.enterDuration, 0, 1, s.motion.moveEase);
    const out = tween(ctx.time, 3.3, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const box = measureText({ text: ctx.params.word, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: size });
    return [group({ id: "emphasis", x: ctx.width / 2, y: ctx.height / 2, scale: max(pop, 0), opacity: clamp(out, 0, 1) * clamp(pop * 2.5 - 1.5, 0, 1) }, [
      text({ id: "word", x: 0, y: 0, text: ctx.params.word, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: size, color: s.palette.fg, align: "center", baseline: "middle" }),
      rect({ id: "underline", x: -box.width / 2, y: size * 0.62, width: box.width * clamp(grow, 0, 1), height: s.shape.strokeWidth * ctx.height * 4, fill: s.palette.accent, radius: s.shape.strokeWidth * ctx.height * 2 })
    ])];
  }
}`
  if (kind === 'caption') return `${header('caption', 4)}
  parameters: { ${param('line', '字幕', '风格统一以后，每一帧都像出自同一双手')} },
  render(ctx) {
    const s = ctx.style; const size = s.typeScale.md * ctx.height; const pad = s.shape.spacing1 * ctx.height;
    const p = tween(ctx.time, 0.1, s.motion.enterDuration * 0.6, 0, 1, s.motion.enterEase);
    const out = tween(ctx.time, 3.5, s.motion.exitDuration * 0.6, 1, 0, s.motion.exitEase);
    const box = measureText({ text: ctx.params.line, fontFamily: s.fonts.body.family, fontWeight: s.fonts.body.weight, fontSize: size, maxWidth: ctx.width * 0.8 });
    return [group({ id: "caption", x: ctx.width / 2, y: ctx.height * (1 - s.layout.safeMargin) - box.height, opacity: clamp(p, 0, 1) * clamp(out, 0, 1) }, [
      rect({ id: "plate", x: -box.width / 2 - pad * 2, y: -pad, width: box.width + pad * 4, height: box.height + pad * 2, fill: s.palette.surface, radius: s.shape.radius * ctx.height, opacity: 0.85 }),
      text({ id: "line", x: 0, y: 0, text: ctx.params.line, fontFamily: s.fonts.body.family, fontWeight: s.fonts.body.weight, fontSize: size, color: s.palette.fg, align: "center", baseline: "top", maxWidth: ctx.width * 0.8 })
    ])];
  }
}`
  const title = kind === 'title' ? '让创作保持一致' : kind === 'lower_third' ? '林远 · 创作者' : '128'
  const subtitle = kind === 'title' ? '一个想法，一种表达' : kind === 'lower_third' ? '影像与设计' : '每一次进步，都看得见'
  const x = kind === 'lower_third' ? 's.layout.safeMargin * ctx.height' : 'ctx.width * 0.12'
  const y = kind === 'lower_third' ? 'ctx.height * 0.72' : 'ctx.height * 0.32'
  return `${header(kind)}
  parameters: { ${param('title', '标题', title, 160)}, ${param('subtitle', '说明', subtitle)} },
  render(ctx) {
    const s = ctx.style;
    const inset = s.shape.spacing2 * ctx.height;
    const p = tween(ctx.time, 0.15, s.motion.enterDuration, 0, 1, s.motion.enterEase);
    const out = tween(ctx.time, 4.2, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const alpha = clamp(p, 0, 1) * clamp(out, 0, 1);
    const size = s.typeScale.${kind === 'data' ? 'display' : kind === 'title' ? 'xl' : 'lg'} * ctx.height;
    return [group({ id: "component", x: ${x}, y: ${y} + (1 - p) * s.motion.travel * ctx.height, opacity: alpha }, [
      rect({ id: "plate", x: 0, y: 0, width: ctx.width * 0.72, height: ctx.height * ${kind === 'lower_third' ? '.2' : '.32'}, fill: s.palette.surface, radius: s.shape.radius * ctx.height }),
      rect({ id: "accent", x: 0, y: 0, width: s.shape.strokeWidth * ctx.height * 2, height: ctx.height * ${kind === 'lower_third' ? '.2' : '.32'}, fill: s.palette.accent }),
      text({ id: "title", x: inset, y: inset, text: ctx.params.title, fontFamily: s.fonts.${kind === 'data' ? 'mono' : 'display'}.family, fontWeight: s.fonts.${kind === 'data' ? 'mono' : 'display'}.weight, fontSize: size, color: s.palette.${kind === 'data' ? 'accent' : 'fg'}, baseline: "top", maxWidth: ctx.width * 0.72 - inset * 2, wrap: true, maxLines: 1 }),
      text({ id: "subtitle", x: inset, y: inset + size * 1.25, text: ctx.params.subtitle, fontFamily: s.fonts.body.family, fontWeight: s.fonts.body.weight, fontSize: s.typeScale.sm * ctx.height, color: s.palette.muted, baseline: "top", maxWidth: ctx.width * 0.72 - inset * 2, wrap: true, maxLines: 1 })
    ])];
  }
}`
}
/** A style's packaging set: its own opener, lower third and emphasis when it has a signature, shared components otherwise. */
export function styleBoardSamples(signature?: StyleSignature): StyleKitContent['samples'] {
  return STYLE_BOARD_KINDS.map(kind => {
    const own = signature && (kind === 'title' ? SIGNATURE_TITLES[signature] : kind === 'lower_third' ? SIGNATURE_OVERLAYS[signature].lowerThird : kind === 'emphasis' ? SIGNATURE_OVERLAYS[signature].emphasis : undefined)
    return { id: kind, name: BOARD_NAMES[kind], kind, source: own ?? makeStyleKitSample(kind) }
  })
}
export type StyleSignature = keyof typeof SIGNATURE_TITLES

type Concept = Omit<StyleConcept, 'id' | 'exceptions'> & { exceptions?: string }
type Rule = Omit<StyleRule, 'id' | 'scope'> & { scope?: string }
interface Preset {
  /** Index into the shared content palettes; also keeps the built-in id stable. */
  palette: number; signature: StyleSignature; name: string; summary: string; scenarios: string[]; concepts: Concept[]; rules: Rule[]
  rhythm: Partial<StyleKitContent['rhythm']>; motion: Partial<StyleKitContent['tokens']['motion']>
  display: string; heavy?: boolean; ratio: number; radius: number; grain: number; vignette?: number; glow?: number; notes: string
}
/** Captions are part of the packaging: clean outlined ink, an information plate, or a pop sticker. */
const CAPTION_TREATMENT: Record<StyleSignature, StyleKitContent['caption']['treatment']> = { minimal: 'outline', tech: 'plate', variety: 'pop' }
const PRESETS: Preset[] = [
  {
    palette: 0, signature: 'minimal', name: '克制高级', summary: '少而精：留白、精确对齐与粗细对比，单一强调色，落地即静止。', scenarios: ['品牌片', '产品发布', '高端访谈'],
    concepts: [
      { name: '留白', meaning: '画面不满，主体有呼吸空间。', criteria: ['同屏只有一个视觉焦点', '文字与图形合计不超过画面 35%', '元素与画边的距离不小于安全边距'], tendencies: '入场用慢档强减速；错峰 0.08 秒以上；字号拉开层级而不是加装饰。', positive: '大面积底色上一行左对齐标题，下方一行小字说明。', negative: '满屏信息卡、多处强调色同时出现。', strength: 'must' },
      { name: '克制', meaning: '动作少、幅度小，靠节奏而不是特效取胜。', criteria: ['同一时刻运动的元素不超过两个', '没有回弹和持续漂浮', '位移不超过画高 4%'], tendencies: '位移幅度 3% 画高；强调只用颜色或字重变化。', positive: '标题从下方 3% 处淡入落定后完全静止。', negative: '标题弹跳入场后仍在缓慢浮动。', strength: 'must' },
    ],
    rules: [
      { kind: 'keep', text: '强调色只用于一个焦点。', strength: 'must' },
      { kind: 'dont', text: '不使用回弹、弹性或跳动曲线。', strength: 'must' },
      { kind: 'do', text: '标题与正文用粗细和字号对比区分，不靠换颜色。', strength: 'prefer' },
      { kind: 'vary', text: '运动方向随语义变化，时长可在 ±20% 内浮动。', strength: 'flexible' },
    ],
    rhythm: { shotSeconds: { min: 2, max: 4 }, cutOn: 'speech', transition: 'match', sfx: 'none', musicDucking: 'on' },
    motion: { enterDuration: .7, exitDuration: .45, emphasisDuration: .4, transitionDuration: .6, stagger: .08, enterEase: 'expoOut', exitEase: 'cubicIn', moveEase: 'cubicInOut', emphasisEase: 'quartOut', transitionEase: 'cubicInOut', travel: .03, readingSpeed: 5, minHold: 1.5 },
    display: 'Source Han Sans SC', ratio: 1.333, radius: .018, grain: .02, notes: '推荐标题 Source Han Sans SC 粗细对照，或宋体主标题；投影极轻。',
  },
  {
    palette: 1, signature: 'tech', name: '科技信息', summary: '信息清晰的科技语言：等宽数字、细线网格作底纹、亮色只标焦点。', scenarios: ['科技教程', '数码评测', '数据讲解'],
    concepts: [
      { name: '精确', meaning: '一切对齐到网格，同类元素规格一致。', criteria: ['元素左边缘落在网格列上', '同类线宽和圆角一致', '数字使用等宽字体'], tendencies: '圆角偏小；线宽统一；利落减速 0.4–0.6 秒。', positive: '三张数据卡等宽等距排开，数字右对齐。', negative: '卡片宽度随意、数字跳动导致宽度抖动。', strength: 'must' },
      { name: '信息优先', meaning: '装饰服务于信息，不抢主体。', criteria: ['网格、HUD 等装饰亮度低于正文', '每个信息拍只出现一个新信息', '数字和界面都是真实内容'], tendencies: '装饰用辅助色低不透明度；信息拍 1.5–3 秒。', positive: '暗色网格上一个亮色数字。', negative: '满屏闪烁的假界面和随机数字。', strength: 'prefer' },
    ],
    rules: [
      { kind: 'keep', text: '语义色职责固定：正向绿、负向红、强调色只标当前项。', strength: 'must' },
      { kind: 'do', text: '数字一律使用等宽字体。', strength: 'must' },
      { kind: 'dont', text: '网格和 HUD 不压在正文上。', strength: 'must' },
      { kind: 'vary', text: '信息拍时长按内容长短在 1.5–3 秒之间调整。', strength: 'prefer' },
    ],
    rhythm: { shotSeconds: { min: 1.5, max: 3 }, cutOn: 'speech', transition: 'cut', sfx: 'sparse', musicDucking: 'on' },
    motion: { enterDuration: .5, exitDuration: .32, emphasisDuration: .3, transitionDuration: .4, stagger: .08, enterEase: 'quartOut', exitEase: 'cubicIn', moveEase: 'cubicInOut', emphasisEase: 'quartOut', transitionEase: 'quartInOut', travel: .03, readingSpeed: 6, minHold: 1 },
    display: 'HarmonyOS Sans SC', ratio: 1.333, radius: .012, grain: .01, glow: .2, notes: '推荐清晰黑体，数字 JetBrains Mono；界面用真实截图。',
  },
  {
    palette: 3, signature: 'variety', name: '综艺花字', summary: '热闹的综艺花字：粗圆体、撞色、一次回弹，强调词配短音效。', scenarios: ['vlog', '综艺剪辑', '搞笑短视频'],
    concepts: [
      { name: '有梗', meaning: '字跟着情绪和笑点走。', criteria: ['花字只出现在强调词或情绪点', '每次花字出现都有一次落点（音效或剪切）'], tendencies: '0.2–0.35 秒入场，一次过冲 8–15%；字间错峰 1–2 帧。', positive: '吐槽词弹出时配一声短音效。', negative: '整句旁白都做成花字。', strength: 'prefer' },
      { name: '收得住', meaning: '热闹但不吵。', criteria: ['花字落地后停住，不抖动', '同屏花字不超过两处', '不遮挡人脸和原字幕'], tendencies: '出场比入场快；回弹只有一次。', positive: '花字弹出后停留一秒干净收走。', negative: '花字循环闪烁、满屏乱飞。', strength: 'must' },
    ],
    rules: [
      { kind: 'do', text: '强调词使用一次回弹入场。', strength: 'prefer' },
      { kind: 'dont', text: '花字不持续抖动或循环闪烁。', strength: 'must' },
      { kind: 'keep', text: '情绪配色固定：开心用强调色，吐槽用次强调色。', strength: 'prefer' },
      { kind: 'vary', text: '花字位置随人物和构图变化。', strength: 'flexible' },
    ],
    rhythm: { shotSeconds: { min: .8, max: 2.5 }, cutOn: 'action', transition: 'cut', sfx: 'rich', musicDucking: 'on' },
    motion: { enterDuration: .3, exitDuration: .2, emphasisDuration: .25, transitionDuration: .3, stagger: .045, enterEase: 'backOut', exitEase: 'cubicIn', moveEase: 'cubicInOut', emphasisEase: 'backOut', transitionEase: 'quartOut', allowOvershoot: true, travel: .06, readingSpeed: 7, minHold: .6 },
    display: 'Noto Sans SC', heavy: true, ratio: 1.5, radius: .03, grain: 0, notes: '可选已安装开源圆体作标题；有限描边、硬投影；避免无许可字体。',
  },
]
const FONT_NOTE = '字体均为常见开源可商用字体；使用实际安装样式，缺失时回退可用中文字体或 sans-serif，数字回退 monospace。参数参考 frameflow design/styles、color、type、motion/timing。'
/** Three deliberately different built-ins: enough to compare and debug, personal styles do the rest. */
export const BUILTIN_STYLE_KITS: readonly StyleKit[] = PRESETS.map(preset => {
  const [bg, surface, fg, muted, accent, accent2] = palettes[preset.palette]
  return styleKitSchema.parse({
    id: `builtin:style:${preset.palette}`, name: preset.name,
    profile: { summary: preset.summary, scenarios: preset.scenarios, concepts: preset.concepts.map((concept, i) => ({ id: `concept-${i + 1}`, ...concept })) },
    tokens: {
      palette: { bg, surface, fg, muted, accent, accent2, ...VIDEO_EDIT_STYLE_STATUS_COLORS },
      fonts: { display: { family: preset.display, weight: preset.heavy ? 900 : 600 }, body: { family: 'Source Han Sans SC', weight: 400 }, mono: { family: 'JetBrains Mono', weight: 500 } },
      typeScale: { baseSize: 36 / 1080, ratio: preset.ratio }, shape: { radius: preset.radius }, motion: preset.motion,
      texture: { grain: preset.grain, vignette: preset.vignette ?? 0, glowIntensity: preset.glow ?? 0 },
    },
    rhythm: preset.rhythm, rules: preset.rules.map((rule, i) => ({ id: `rule-${i + 1}`, ...rule })),
    caption: { treatment: CAPTION_TREATMENT[preset.signature] },
    notes: `${preset.notes}\n\n${FONT_NOTE}`, samples: styleBoardSamples(preset.signature),
  })
})
/** Resolve recommendations to t63's available font catalog before making a personal copy. */
export function availableStyleKitFonts(kit: StyleKit, faces: readonly FontFaceInfo[]): StyleKit {
  const value = structuredClone(kit)
  for (const role of ['display', 'body', 'mono'] as const) {
    const requested = value.tokens.fonts[role]
    const matching = faces.filter(face => fontMatchesName(face, requested.family)).sort((a, b) => Math.abs(a.weight - requested.weight) - Math.abs(b.weight - requested.weight))
    const fallback = faces.find(face => face.supportsCjk && face.category === (role === 'display' && requested.family.includes('Serif') ? 'serif' : 'sans-serif'))
    const chosen = matching[0] ?? (role === 'mono' ? undefined : fallback)
    value.tokens.fonts[role] = chosen ? { family: chosen.fullName, weight: chosen.weight } : { family: role === 'mono' ? 'monospace' : 'sans-serif', weight: requested.weight }
  }
  return value
}
