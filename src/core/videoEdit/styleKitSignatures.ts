/**
 * Reference examples of the three built-in styles: each style's own opener, lower third and emphasis. They read a
 * local `s` table; styleKitPresets bakes each style's concrete values into it, so every example is self-contained.
 */
const head = (name: string, seconds = 5): string => `export default { apiVersion: 1, languageVersion: 3, name: "${name}", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: ${seconds}, seed: 42,`
export const SIGNATURE_TITLES = {
  /** 克制：大量留白，一根细线先画出，标题与说明错峰轻抬落定，全程只有一个强调色。 */
  minimal: `${head('克制标题')}
  parameters: { eyebrow: { type: "text", title: "眉题", default: "CHAPTER ONE", maxLength: 40 }, title: { type: "text", title: "标题", default: "少即是多", maxLength: 60 }, subtitle: { type: "text", title: "说明", default: "把注意力留给真正重要的东西", maxLength: 120 }, hold: { type: "number", title: "退场时间", default: 4.2, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const W = ctx.width; const m = s.layout.safeMargin * H * 1.6;
    const rule = tween(ctx.time, 0.2, s.motion.transitionDuration * 1.4, 0, 1, s.motion.transitionEase);
    const p = tween(ctx.time, 0.55, s.motion.enterDuration, 0, 1, s.motion.enterEase);
    const q = tween(ctx.time, 0.55 + s.motion.stagger * 3, s.motion.enterDuration, 0, 1, s.motion.enterEase);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const size = s.typeScale.display * H * 1.35; const lift = s.motion.travel * H;
    return [
      rect({ id: "bg", x: 0, y: 0, width: W, height: H, fill: s.palette.bg }),
      group({ id: "block", x: m, y: H * 0.4, opacity: clamp(out, 0, 1) }, [
        text({ id: "eyebrow", x: 0, y: -H * 0.035, text: ctx.params.eyebrow, fontFamily: s.fonts.body.family, fontWeight: s.fonts.body.weight, fontSize: s.typeScale.sm * H, letterSpacing: H * 0.008, color: s.palette.muted, baseline: "bottom", opacity: clamp(p, 0, 1) }),
        rect({ id: "rule", x: 0, y: 0, width: max(1, W * 0.28 * clamp(rule, 0, 1)), height: max(1, s.shape.strokeWidth * H), fill: s.palette.accent }),
        text({ id: "headline", x: 0, y: H * 0.04 + (1 - p) * lift, text: ctx.params.title, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: size, color: s.palette.fg, baseline: "top", opacity: clamp(p, 0, 1) }),
        text({ id: "sub", x: 0, y: H * 0.04 + size * 1.4 + (1 - q) * lift, text: ctx.params.subtitle, fontFamily: s.fonts.body.family, fontWeight: s.fonts.body.weight, fontSize: s.typeScale.md * H, color: s.palette.muted, baseline: "top", opacity: clamp(q, 0, 1) })
      ])
    ];
  }
}`,
  /** 科技：细网格底纹、四角括号框出信息区，扫描线扫过，标题逐字打出，等宽数据角标。 */
  tech: `${head('科技标题')}
  parameters: { title: { type: "text", title: "标题", default: "数据驱动决策", maxLength: 40 }, label: { type: "text", title: "标签", default: "SYS · ONLINE", maxLength: 40 }, data: { type: "text", title: "数据", default: "128 FPS", maxLength: 20 }, hold: { type: "number", title: "退场时间", default: 4.3, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const W = ctx.width;
    const open = tween(ctx.time, 0.1, s.motion.transitionDuration, 0, 1, s.motion.transitionEase);
    const typed = progress(ctx.time, 0.5, 0.9);
    const scan = progress(ctx.time, 0.3, 1.6);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const x0 = W * 0.2; const y0 = H * 0.3; const w = W * 0.6; const h = H * 0.4; const c = H * 0.05; const t = max(2, s.shape.strokeWidth * H * 1.5); const pad = (1 - open) * H * 0.06;
    return [
      rect({ id: "bg", x: 0, y: 0, width: W, height: H, fill: s.palette.bg }),
      group({ id: "grid", opacity: 0.18 }, [
        repeat(17, i => rect({ id: "gx", x: i * W / 16, y: 0, width: 1, height: H, fill: s.palette.muted })),
        repeat(10, i => rect({ id: "gy", x: 0, y: i * H / 9, width: W, height: 1, fill: s.palette.muted }))
      ]),
      group({ id: "hud", opacity: clamp(out, 0, 1) }, [
        rect({ id: "tl1", x: x0 - pad, y: y0 - pad, width: c, height: t, fill: s.palette.accent }), rect({ id: "tl2", x: x0 - pad, y: y0 - pad, width: t, height: c, fill: s.palette.accent }),
        rect({ id: "tr1", x: x0 + w + pad - c, y: y0 - pad, width: c, height: t, fill: s.palette.accent }), rect({ id: "tr2", x: x0 + w + pad - t, y: y0 - pad, width: t, height: c, fill: s.palette.accent }),
        rect({ id: "bl1", x: x0 - pad, y: y0 + h + pad - t, width: c, height: t, fill: s.palette.accent }), rect({ id: "bl2", x: x0 - pad, y: y0 + h + pad - c, width: t, height: c, fill: s.palette.accent }),
        rect({ id: "br1", x: x0 + w + pad - c, y: y0 + h + pad - t, width: c, height: t, fill: s.palette.accent }), rect({ id: "br2", x: x0 + w + pad - t, y: y0 + h + pad - c, width: t, height: c, fill: s.palette.accent }),
        rect({ id: "scan", x: x0, y: y0 + h * scan, width: w, height: max(2, H * 0.003), fill: s.palette.accent, opacity: 0.6 * (1 - scan), glow: { radius: H * 0.02, intensity: 2, color: s.palette.accent } }),
        text({ id: "label", x: x0, y: y0 - H * 0.03, text: ctx.params.label, fontFamily: s.fonts.mono.family, fontWeight: s.fonts.mono.weight, fontSize: s.typeScale.sm * H, letterSpacing: H * 0.004, color: s.palette.muted, baseline: "bottom", opacity: clamp(open, 0, 1) }),
        text({ id: "data", x: x0 + w, y: y0 - H * 0.03, text: ctx.params.data, fontFamily: s.fonts.mono.family, fontWeight: s.fonts.mono.weight, fontSize: s.typeScale.md * H, color: s.palette.accent, align: "right", baseline: "bottom", opacity: clamp(open, 0, 1) }),
        text({ id: "headline", x: W / 2, y: H / 2, text: ctx.params.title, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: s.typeScale.display * H * 1.3, color: s.palette.fg, align: "center", baseline: "middle",
          perChar: (i, n) => ({ opacity: clamp(typed * n - i, 0, 1) }) })
      ])
    ];
  }
}`,
  /** 综艺：撞色爆炸贴纸垫底，粗字描边加硬投影、整体歪一点，逐字弹出，彩点散落，再补一句吐槽小标签。 */
  variety: `${head('综艺标题')}
  parameters: { title: { type: "text", title: "花字", default: "太离谱了吧", maxLength: 20 }, tag: { type: "text", title: "吐槽", default: "笑不活了", maxLength: 20 }, hold: { type: "number", title: "退场时间", default: 4.4, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const W = ctx.width;
    const burst = tween(ctx.time, 0.05, s.motion.emphasisDuration * 1.4, 0, 1, s.motion.emphasisEase);
    const tag = tween(ctx.time, 0.9, s.motion.emphasisDuration, 0, 1, s.motion.emphasisEase);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const size = s.typeScale.display * H * 1.15;
    return [
      rect({ id: "bg", x: 0, y: 0, width: W, height: H, fill: s.palette.bg }),
      repeat(24, i => ellipse({ id: "dot", x: W * random(i), y: H * random(i + 40) + sin(ctx.time * 2 + i) * H * 0.02, width: H * (0.01 + 0.015 * random(i + 80)), height: H * (0.01 + 0.015 * random(i + 80)), fill: mix(s.palette.accent, s.palette.accent2, random(i + 120)), opacity: 0.8 })),
      group({ id: "sticker", x: W / 2, y: H / 2, rotation: -6, scale: max(burst, 0), opacity: clamp(out, 0, 1) }, [
        ellipse({ id: "burst", x: -W * 0.3, y: -H * 0.24, width: W * 0.6, height: H * 0.48, fill: s.palette.accent2 }),
        rect({ id: "band", x: -W * 0.33, y: -H * 0.07, width: W * 0.66, height: H * 0.14, fill: s.palette.accent, radius: H * 0.03 }),
        text({ id: "headline", x: 0, y: 0, text: ctx.params.title, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: size, color: s.palette.fg, align: "center", baseline: "middle",
          stroke: s.palette.bg, strokeWidth: H * 0.014, shadow: { x: H * 0.008, y: H * 0.012, blur: 0, color: s.palette.bg },
          perChar: (i, n) => ({ scale: max(0, tween(ctx.time, 0.2 + stagger(i, s.motion.stagger), s.motion.emphasisDuration, 0, 1, s.motion.emphasisEase)) }) })
      ]),
      group({ id: "tag", x: W * 0.66, y: H * 0.72, rotation: 8, scale: max(tag, 0), opacity: clamp(out, 0, 1) }, [
        rect({ id: "chip", x: -H * 0.16, y: -H * 0.05, width: H * 0.32, height: H * 0.1, fill: s.palette.fg, radius: H * 0.05 }),
        text({ id: "tagText", x: 0, y: 0, text: ctx.params.tag, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: s.typeScale.md * H, color: s.palette.bg, align: "center", baseline: "middle" })
      ])
    ];
  }
}`,
} as const
/** Overlays that sit on footage: lower thirds and emphasis words, one design language per style. */
export const SIGNATURE_OVERLAYS = {
  minimal: {
    /** 克制人名条：一根竖线先出，姓名与身份左对齐错峰，没有底板，只靠留白和轻投影保证可读。 */
    lowerThird: `${head('克制人名条', 4)}
  parameters: { name: { type: "text", title: "姓名", default: "林远", maxLength: 40 }, role: { type: "text", title: "身份", default: "独立设计师", maxLength: 60 }, hold: { type: "number", title: "退场时间", default: 3.4, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const m = s.layout.safeMargin * H * 1.4;
    const bar = tween(ctx.time, 0.1, s.motion.transitionDuration, 0, 1, s.motion.transitionEase);
    const p = tween(ctx.time, 0.35, s.motion.enterDuration, 0, 1, s.motion.enterEase);
    const q = tween(ctx.time, 0.35 + s.motion.stagger * 3, s.motion.enterDuration, 0, 1, s.motion.enterEase);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const shade = { x: 0, y: H * 0.003, blur: H * 0.012, color: [0, 0, 0, 0.45] };
    return [group({ id: "lower", x: m, y: H * 0.74, opacity: clamp(out, 0, 1) }, [
      rect({ id: "bar", x: 0, y: 0, width: max(1, s.shape.strokeWidth * H), height: H * 0.13 * clamp(bar, 0, 1), fill: s.palette.accent }),
      text({ id: "name", x: H * 0.025, y: (1 - p) * s.motion.travel * H, text: ctx.params.name, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: s.typeScale.xxl * H, color: s.palette.fg, baseline: "top", opacity: clamp(p, 0, 1), shadow: shade }),
      text({ id: "role", x: H * 0.025, y: H * 0.08 + (1 - q) * s.motion.travel * H, text: ctx.params.role, fontFamily: s.fonts.body.family, fontWeight: s.fonts.body.weight, fontSize: s.typeScale.md * H, color: s.palette.fg, baseline: "top", opacity: 0.75 * clamp(q, 0, 1), shadow: shade })
    ])];
  }
}`,
    /** 克制强调：一个词，宽字距慢慢显影，下方细线收拢，不放大不跳。 */
    emphasis: `${head('克制强调', 3)}
  parameters: { word: { type: "text", title: "强调词", default: "专注", maxLength: 20 }, hold: { type: "number", title: "退场时间", default: 2.4, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const W = ctx.width;
    const p = tween(ctx.time, 0.1, s.motion.enterDuration * 1.3, 0, 1, s.motion.enterEase);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    return [group({ id: "emphasis", x: W / 2, y: H * 0.45, opacity: clamp(p, 0, 1) * clamp(out, 0, 1) }, [
      text({ id: "word", x: 0, y: 0, text: ctx.params.word, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: s.typeScale.display * H, letterSpacing: H * (0.04 - 0.02 * p), color: s.palette.fg, align: "center", baseline: "middle", shadow: { x: 0, y: H * 0.004, blur: H * 0.02, color: [0, 0, 0, 0.4] } }),
      rect({ id: "rule", x: -W * 0.06 * p, y: H * 0.1, width: max(1, W * 0.12 * p), height: max(1, s.shape.strokeWidth * H), fill: s.palette.accent })
    ])];
  }
}`,
  },
  tech: {
    /** 科技人名条：半透明深色底板加左侧亮条，等宽编号，姓名逐字打出，右侧小数据格。 */
    lowerThird: `${head('科技人名条', 4)}
  parameters: { name: { type: "text", title: "姓名", default: "林远", maxLength: 40 }, role: { type: "text", title: "身份", default: "AI 工程师", maxLength: 60 }, code: { type: "text", title: "编号", default: "ID-0427", maxLength: 20 }, hold: { type: "number", title: "退场时间", default: 3.5, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const W = ctx.width; const m = s.layout.safeMargin * H;
    const open = tween(ctx.time, 0.05, s.motion.transitionDuration, 0, 1, s.motion.transitionEase);
    const typed = progress(ctx.time, 0.3, 0.6);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const w = W * 0.4 * clamp(open, 0, 1); const h = H * 0.16;
    return [group({ id: "lower", x: m, y: H * 0.72, opacity: clamp(out, 0, 1) }, [
      rect({ id: "plate", x: 0, y: 0, width: max(1, w), height: h, fill: s.palette.surface, opacity: 0.88 }),
      rect({ id: "edge", x: 0, y: 0, width: max(2, H * 0.005), height: h, fill: s.palette.accent, glow: { radius: H * 0.012, intensity: 1.5, color: s.palette.accent } }),
      text({ id: "code", x: H * 0.03, y: H * 0.018, text: ctx.params.code, fontFamily: s.fonts.mono.family, fontWeight: s.fonts.mono.weight, fontSize: s.typeScale.sm * H, color: s.palette.accent, baseline: "top", opacity: clamp(open, 0, 1) }),
      text({ id: "name", x: H * 0.03, y: H * 0.05, text: ctx.params.name, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: s.typeScale.xxl * H, color: s.palette.fg, baseline: "top", perChar: (i, n) => ({ opacity: clamp(typed * n - i, 0, 1) }) }),
      text({ id: "role", x: w - H * 0.03, y: h - H * 0.02, text: ctx.params.role, fontFamily: s.fonts.mono.family, fontWeight: s.fonts.mono.weight, fontSize: s.typeScale.sm * H, color: s.palette.muted, align: "right", baseline: "bottom", opacity: clamp(typed, 0, 1) })
    ])];
  }
}`,
    /** 科技强调：关键词套进方括号框，框从两侧夹紧，词带辉光，旁边一行等宽注释。 */
    emphasis: `${head('科技强调', 3)}
  parameters: { word: { type: "text", title: "强调词", default: "关键指标", maxLength: 20 }, note: { type: "text", title: "注释", default: "+37% QoQ", maxLength: 30 }, hold: { type: "number", title: "退场时间", default: 2.5, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const W = ctx.width;
    const p = tween(ctx.time, 0.1, s.motion.emphasisDuration * 1.4, 0, 1, s.motion.emphasisEase);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const size = s.typeScale.xxl * H; const half = W * (0.26 - 0.08 * p); const t = max(2, H * 0.004); const arm = H * 0.04;
    return [group({ id: "emphasis", x: W / 2, y: H * 0.45, opacity: clamp(p * 2, 0, 1) * clamp(out, 0, 1) }, [
      rect({ id: "l1", x: -half, y: -size * 0.7, width: t, height: size * 1.4, fill: s.palette.accent }), rect({ id: "l2", x: -half, y: -size * 0.7, width: arm, height: t, fill: s.palette.accent }), rect({ id: "l3", x: -half, y: size * 0.7 - t, width: arm, height: t, fill: s.palette.accent }),
      rect({ id: "r1", x: half - t, y: -size * 0.7, width: t, height: size * 1.4, fill: s.palette.accent }), rect({ id: "r2", x: half - arm, y: -size * 0.7, width: arm, height: t, fill: s.palette.accent }), rect({ id: "r3", x: half - arm, y: size * 0.7 - t, width: arm, height: t, fill: s.palette.accent }),
      text({ id: "word", x: 0, y: 0, text: ctx.params.word, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: size, color: s.palette.fg, align: "center", baseline: "middle", glow: { radius: H * 0.015, intensity: 1.2, color: s.palette.accent } }),
      text({ id: "note", x: half, y: size * 0.95, text: ctx.params.note, fontFamily: s.fonts.mono.family, fontWeight: s.fonts.mono.weight, fontSize: s.typeScale.sm * H, color: s.palette.positive, align: "right", baseline: "top", opacity: clamp(p, 0, 1) })
    ])];
  }
}`,
  },
  variety: {
    /** 综艺人名条：歪着的撞色胶囊弹进来，粗字描边，名字后跟一个小贴纸标签。 */
    lowerThird: `${head('综艺人名条', 4)}
  parameters: { name: { type: "text", title: "姓名", default: "林远", maxLength: 40 }, role: { type: "text", title: "身份", default: "气氛担当", maxLength: 60 }, hold: { type: "number", title: "退场时间", default: 3.5, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const m = s.layout.safeMargin * H;
    const pop = tween(ctx.time, 0.05, s.motion.emphasisDuration, 0, 1, s.motion.emphasisEase);
    const tag = tween(ctx.time, 0.35, s.motion.emphasisDuration, 0, 1, s.motion.emphasisEase);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    return [group({ id: "lower", x: m + H * 0.22, y: H * 0.8, rotation: -4, scale: max(pop, 0), opacity: clamp(out, 0, 1) }, [
      rect({ id: "pill", x: -H * 0.22, y: -H * 0.055, width: H * 0.44, height: H * 0.11, fill: s.palette.accent, radius: H * 0.055 }),
      text({ id: "name", x: 0, y: 0, text: ctx.params.name, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: s.typeScale.xl * H, color: s.palette.fg, align: "center", baseline: "middle", stroke: s.palette.bg, strokeWidth: H * 0.008 }),
      group({ id: "tag", x: H * 0.27, y: -H * 0.07, rotation: 10, scale: max(tag, 0) }, [
        rect({ id: "chip", x: -H * 0.1, y: -H * 0.032, width: H * 0.2, height: H * 0.064, fill: s.palette.accent2, radius: H * 0.032 }),
        text({ id: "role", x: 0, y: 0, text: ctx.params.role, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: s.typeScale.sm * H, color: s.palette.bg, align: "center", baseline: "middle" })
      ])
    ])];
  }
}`,
    /** 综艺强调：大字逐个弹跳落地，硬投影加描边，周围一圈放射小点炸开。 */
    emphasis: `${head('综艺强调', 3)}
  parameters: { word: { type: "text", title: "强调词", default: "绝了", maxLength: 12 }, hold: { type: "number", title: "退场时间", default: 2.5, min: 0.3, max: 60, step: 0.1 } },
  render(ctx) {
    const s = ctx.style; const H = ctx.height; const W = ctx.width;
    const ring = progress(ctx.time, 0.15, 0.5);
    const out = tween(ctx.time, ctx.params.hold, s.motion.exitDuration, 1, 0, s.motion.exitEase);
    const size = s.typeScale.display * H * 1.4;
    return [group({ id: "emphasis", x: W / 2, y: H * 0.42, opacity: clamp(out, 0, 1) }, [
      repeat(10, i => ellipse({ id: "spark", x: cos(i * 0.628) * H * (0.1 + 0.22 * ring) - H * 0.012, y: sin(i * 0.628) * H * (0.1 + 0.22 * ring) - H * 0.012, width: H * 0.024, height: H * 0.024, fill: mix(s.palette.accent, s.palette.accent2, random(i)), opacity: clamp(1 - ring, 0, 1) })),
      text({ id: "word", x: 0, y: 0, text: ctx.params.word, fontFamily: s.fonts.display.family, fontWeight: s.fonts.display.weight, fontSize: size, color: s.palette.accent, align: "center", baseline: "middle", stroke: s.palette.fg, strokeWidth: H * 0.012, shadow: { x: H * 0.01, y: H * 0.014, blur: 0, color: s.palette.bg },
        perChar: (i, n) => ({ scale: max(0, tween(ctx.time, stagger(i, 0.08), s.motion.emphasisDuration, 0, 1, s.motion.emphasisEase)), rotation: (i - (n - 1) / 2) * 6 }) })
    ])];
  }
}`,
  },
} as const
