import { styleKitSchema, type StyleKit } from './styleKit'
import { VIDEO_EDIT_STYLE_PALETTES, VIDEO_EDIT_STYLE_STATUS_COLORS } from '../theme/colorTokens'
import { fontMatchesName, type FontFaceInfo } from '../fonts/catalog'

const palettes = VIDEO_EDIT_STYLE_PALETTES
/** These are real v3 sources: all visual styling reads the injected tokens. */
export function makeStyleKitSample(kind: 'title' | 'lower_third' | 'data'): string {
  const title = kind === 'title' ? '让创作保持一致' : kind === 'lower_third' ? '林远 · 创作者' : '128'
  const subtitle = kind === 'title' ? '一个想法，一种表达' : kind === 'lower_third' ? '影像与设计' : '每一次进步，都看得见'
  const x = kind === 'lower_third' ? 's.layout.safeMargin * ctx.height' : 'ctx.width * 0.12'
  const y = kind === 'lower_third' ? 'ctx.height * 0.72' : 'ctx.height * 0.32'
  return `export default { apiVersion: 1, languageVersion: 3, name: "${kind}", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 5, seed: 42,
  parameters: { title: { type: "text", title: "标题", default: "${title}", maxLength: 160 }, subtitle: { type: "text", title: "说明", default: "${subtitle}", maxLength: 200 } },
  render(ctx) {
    const s = ctx.style;
    const inset = s.shape.spacing2 * ctx.height;
    const p = tween(ctx.time, 0.15, s.motion.enterDuration, 0, 1, s.motion.enterEase);
    const out = tween(ctx.time, 4.2, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const alpha = clamp(p, 0, 1) * clamp(out, 0, 1);
    const size = s.typeScale.${kind === 'data' ? 'display' : kind === 'title' ? 'xl' : 'lg'} * ctx.height;
    return [group({ id: "component", x: ${x}, y: ${y} + (1 - p) * ctx.height * 0.035, opacity: alpha }, [
      rect({ id: "plate", x: 0, y: 0, width: ctx.width * 0.72, height: ctx.height * ${kind === 'lower_third' ? '.2' : '.32'}, fill: s.palette.surface, radius: s.shape.radius * ctx.height }),
      rect({ id: "accent", x: 0, y: 0, width: s.shape.strokeWidth * ctx.height * 2, height: ctx.height * ${kind === 'lower_third' ? '.2' : '.32'}, fill: s.palette.accent }),
      text({ id: "title", x: inset, y: inset, text: ctx.params.title, fontFamily: s.fonts.${kind === 'data' ? 'mono' : 'display'}.family, fontWeight: s.fonts.${kind === 'data' ? 'mono' : 'display'}.weight, fontSize: size, color: s.palette.${kind === 'data' ? 'accent' : 'fg'}, baseline: "top", maxWidth: ctx.width * 0.72 - inset * 2, wrap: true, maxLines: 1 }),
      text({ id: "subtitle", x: inset, y: inset + size * 1.25, text: ctx.params.subtitle, fontFamily: s.fonts.body.family, fontWeight: s.fonts.body.weight, fontSize: s.typeScale.sm * ctx.height, color: s.palette.muted, baseline: "top", maxWidth: ctx.width * 0.72 - inset * 2, wrap: true, maxLines: 1 })
    ])];
  }
}`
}
const names = ['克制高级', '科技信息', '知识讲解', '综艺花字', '电商促销', '温暖纪实']
const directions = ['留白、精确对齐和粗细对比；不堆特效，落地静止，单一强调。', '数字用等宽字；线框和网格只作底纹，不抢信息主体。', '一句一画，按讲解出现；关键词高亮，正文先保证可读。', '粗圆标题、撞色和一次回弹；花字落地后停留，不持续抖动。', '大数字、清楚的价格标签和一次冲击；同一时刻只有一个行动焦点。', '暖灰、衬线标题、轻颗粒与轻暗角；慢入慢出，让素材先说话。']
const entries = [
  { display: 'Source Han Sans SC', body: 'Source Han Sans SC', enter: .7, ease: 'expoOut', ratio: 1.333, radius: .018, grain: .02 },
  { display: 'HarmonyOS Sans SC', body: 'Source Han Sans SC', enter: .5, ease: 'quartOut', ratio: 1.333, radius: .012, grain: .01 },
  { display: 'Alibaba PuHuiTi', body: 'Source Han Sans SC', enter: .5, ease: 'cubicOut', ratio: 1.333, radius: .022, grain: 0 },
  { display: 'Noto Sans SC', body: 'Source Han Sans SC', enter: .3, ease: 'backOut', ratio: 1.5, radius: .03, grain: 0 },
  { display: 'Alibaba PuHuiTi', body: 'Source Han Sans SC', enter: .4, ease: 'quintOut', ratio: 1.5, radius: .012, grain: 0 },
  { display: 'Source Han Serif SC', body: 'Source Han Sans SC', enter: 1.1, ease: 'sineInOut', ratio: 1.25, radius: .008, grain: .035 },
]
export const BUILTIN_STYLE_KITS: readonly StyleKit[] = entries.map((entry, index) => {
  const [bg, surface, fg, muted, accent, accent2] = palettes[index]
  return styleKitSchema.parse({ id: `builtin:style:${index}`, name: names[index], tokens: {
    palette: { bg, surface, fg, muted, accent, accent2, ...VIDEO_EDIT_STYLE_STATUS_COLORS },
    fonts: { display: { family: entry.display, weight: index === 3 || index === 4 ? 900 : 600 }, body: { family: entry.body, weight: 400 }, mono: { family: 'JetBrains Mono', weight: 500 } },
    typeScale: { baseSize: 36 / 1080, ratio: entry.ratio }, shape: { radius: entry.radius },
    motion: { enterDuration: entry.enter, exitDuration: entry.enter * .65, stagger: index === 3 ? .045 : .08, enterEase: entry.ease, exitEase: 'cubicIn', moveEase: index === 5 ? 'sineInOut' : 'cubicInOut', allowOvershoot: index === 3 || index === 4 }, texture: { grain: entry.grain, vignette: index === 5 ? .12 : 0, glowIntensity: index === 1 ? .2 : 0 },
  }, rules: `# ${names[index]}\n${directions[index]}\n\n## 做\n使用 ctx.style 的配色、字号阶梯、字体、间距和缓动；每刻一个焦点，留足阅读时间，静止阶段保持稳定。\n\n## 不做\n不硬编码另一套颜色或字体；不拉伸字体；不持续漂浮；闪烁每秒不超过三次。\n\n## 参考与字体\n参数参考 frameflow design/styles、color、type、motion/timing。推荐标题 ${entry.display}，正文 ${entry.body}，数字 JetBrains Mono，均为常见开源可商用字体；使用实际安装样式，缺失时回退可用中文字体或 sans-serif，数字回退 monospace。综艺可自行选择已安装开源圆体，避免无许可字体。`, samples: (['title', 'lower_third', 'data'] as const).map((kind, i) => ({ id: `${kind}`, name: ['标题', '人名条', '数据卡'][i], kind, source: makeStyleKitSample(kind) })) })
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
