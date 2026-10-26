import { STYLE_SAMPLE_COLORS } from '../../theme/colorTokens'

/**
 * 新建风格自带的样片：标准分镜演示基础组件（标题 → 花字 → 图片容器与高亮 → 数据 → 人名条 → 收尾，11 秒），
 * 浅底、蓝色强调；照着改成自己的风格。颜色只取 STYLE_SAMPLE_COLORS，半透明与混色在样片代码里按它换算。
 */
export const BLANK_STYLE_SAMPLE_SOURCE = `// 风格样片：按标准分镜演示本风格的基础组件。整段时长、尺寸、锚点帧在风格的 sample 设置里。
// 改风格时先改 STYLE 里的取值和下面各组件的画法；分镜与文案保持标准，方便不同风格并排比较。
// 只能用相对导入（同目录内的文件），不访问网络、文件或 DOM；量字用 OffscreenCanvas。
//
// 分层写法（运行时据此做运动模糊，默认 180° 快门）：
// - layers() 从后到前返回若干层；没有 pose 的层是静止层，按当前时刻 t 在画面坐标里画。
// - 会动的元素各成一层：在本地坐标里画内容，bounds 给出本地内容范围，pose(t) 给出
//   { x, y, rotation, scale / scaleX / scaleY, opacity }，不可见时返回 null。内容随时间变的（计数、逐字）照常在 draw 里按 t 画。
// - 文字从遮罩里滑出这类效果：加 clip（画面坐标里的矩形），内容随 pose 移动，遮罩不跟着动。
// 尺寸都以画面高度为单位（u = 高 / 720），换分辨率不改画面。

const STYLE = {
  color: ${JSON.stringify(STYLE_SAMPLE_COLORS).replace(/,/g, ', ')},
  font: {
    title: '"HarmonyOS Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
    body: '"HarmonyOS Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
    number: '"DIN Alternate", "Bahnschrift", "Segoe UI", sans-serif',
  },
};

// 标准分镜（秒）：标题 → 花字 → 图片容器与高亮 → 数据 → 人名条 → 收尾。
// 相邻两段略有重叠：旧内容向左退到一半时新内容从右边进来，版面不会撞在一起，任何一帧也都不空。
const SCENES = { title: [0, 2.0], keyword: [1.95, 3.7], media: [3.65, 6.3], data: [6.25, 8.2], name: [8.15, 9.6], end: [9.55, 99] };
const COPY = {
  title: "把想法变成画面",
  keyword: { lead: "风格", key: "不走样" },
  media: "示意画面", // 容器里是代码画的示意，不冒充真实截图
  data: { value: 87, unit: "%", label: "一次通过率" },
  name: { name: "痕继痕迹", role: "动效设计师" },
  end: "一个风格，处处一致",
};

// —— 运动规律：全片共用 ——
const clamp = (v) => Math.max(0, Math.min(1, v));
const expoOut = (v) => (v >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(v))); // 入场、落定：冲进来，长尾减速
const cubicIn = (v) => clamp(v) ** 3; // 离场：先慢后快，干脆离开
const cubicInOut = (v) => { v = clamp(v); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };
const IN = 0.7, OUT = 0.35; // 入场 0.7 秒，离场是入场的一半
const font = (weight, size, family) => \`\${weight} \${Math.round(size)}px \${family}\`;

// 颜色只从 STYLE 换算：alpha 改透明度，mix 两色混合（渐变两端用同一 RGB 只改透明度）。
const rgb = (c) => (Array.isArray(c) ? c : [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
const alpha = (c, a) => \`rgba(\${rgb(c).join(", ")}, \${a})\`;
const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return \`rgb(\${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(", ")})\`; };
const WHITE = [255, 255, 255];

// 承载运动：整个画面以中心为原点匀速缓推（每秒约 0.8%），从第一帧跑到最后一帧，不起停；入场位移叠在上面。
const PUSH = 0.008;
function camera(t, w, h) {
  const s = 1 + PUSH * t;
  return { s, at: (x, y) => [w / 2 + (x - w / 2) * s, h / 2 + (y - h / 2) * s] };
}

// 场景进度：enter 入场（expoOut），leave 离场（cubicIn）；on 表示这一刻场景可见。
function phase(t, [a, b], delay = 0, inDur = IN, outDur = OUT) {
  return { enter: expoOut((t - a - delay) / inDur), leave: cubicIn((t - (b - outDur)) / outDur), on: t >= a + delay && t < b };
}

// 一个运动层：内容在本地坐标里画，(x, y) 是落点。入场从右侧带着速度滑进来减速落定，离场向左加速退出，
// 全片同一个方向，像镜头一直在向右走；透明度在入场前段就完成，不做原地淡入。
function mover(w, h, u, { scene, x, y, bounds, draw, delay = 0, inDur = IN, outDur = OUT, from = 56, to = 40, size }) {
  return {
    bounds, draw,
    pose: (t) => {
      const p = phase(t, scene, delay, inDur, outDur);
      if (!p.on) return null;
      const c = camera(t, w, h), k = size ? size(t) : 1;
      const [px, py] = c.at(x + ((1 - p.enter) * from - p.leave * to) * u, y);
      return { x: px, y: py, scale: c.s * k, opacity: Math.min(1, p.enter * 2.5) * (1 - p.leave) };
    },
  };
}

// 只用来量字宽（分层时还没有画布）。
let measurer = null;
function measure(text, f) {
  measurer ??= new OffscreenCanvas(1, 1).getContext("2d");
  measurer.font = f;
  return measurer.measureText(text).width;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// —— 图片与录屏容器：代码画的示意画面（一个编辑界面：预览、属性栏、时间线）——
// 本地坐标以容器中心为原点；高亮目标是右侧的“按钮”，位置由 MEDIA_TARGET 给出。
const MEDIA = { w: 760, h: 400, r: 14, bezel: 10 };
const MEDIA_TARGET = { x: 196, y: -44, w: 132, h: 34 };
function mockScreen(ctx, u) {
  const C = STYLE.color, W = MEDIA.w * u, H = MEDIA.h * u, b = MEDIA.bezel * u;
  // 外框：深色边框像一块屏幕，柔和投影让它离开台面。
  ctx.save();
  ctx.shadowColor = alpha(C.text, 0.18); ctx.shadowBlur = 36 * u; ctx.shadowOffsetY = 14 * u;
  ctx.fillStyle = C.text; roundRect(ctx, -W / 2, -H / 2, W, H, MEDIA.r * u); ctx.fill();
  ctx.restore();
  const x0 = -W / 2 + b, y0 = -H / 2 + b, iw = W - 2 * b, ih = H - 2 * b;
  ctx.save();
  roundRect(ctx, x0, y0, iw, ih, (MEDIA.r - 6) * u); ctx.clip();
  ctx.fillStyle = mix(C.bg, WHITE, 0.6); ctx.fillRect(x0, y0, iw, ih);
  // 标题栏
  ctx.fillStyle = mix(C.bg, C.line, 0.5); ctx.fillRect(x0, y0, iw, 30 * u);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = C.line; ctx.beginPath(); ctx.arc(x0 + (18 + i * 16) * u, y0 + 15 * u, 4.5 * u, 0, Math.PI * 2); ctx.fill(); }
  // 预览：一张示意风景（天空、太阳、两层山）
  const px = x0 + 18 * u, py = y0 + 46 * u, pw = iw * 0.6, ph = ih * 0.56;
  const sky = ctx.createLinearGradient(0, py, 0, py + ph);
  sky.addColorStop(0, mix(C.bg, C.accent, 0.22)); sky.addColorStop(1, mix(C.bg, WHITE, 0.5));
  ctx.fillStyle = sky; roundRect(ctx, px, py, pw, ph, 6 * u); ctx.fill();
  ctx.save(); roundRect(ctx, px, py, pw, ph, 6 * u); ctx.clip();
  ctx.fillStyle = alpha(C.accent, 0.85); ctx.beginPath(); ctx.arc(px + pw * 0.7, py + ph * 0.38, ph * 0.12, 0, Math.PI * 2); ctx.fill();
  const hill = (k, color, lift) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(px, py + ph);
    for (let i = 0; i <= 8; i++) ctx.lineTo(px + (pw * i) / 8, py + ph * (lift - 0.12 * Math.sin(i * 1.3 + k)));
    ctx.lineTo(px + pw, py + ph); ctx.closePath(); ctx.fill();
  };
  hill(0.5, mix(C.bg, C.muted, 0.35), 0.72); hill(2.1, mix(C.bg, C.text, 0.55), 0.86);
  ctx.restore();
  // 属性栏：几条文字占位与一个按钮（高亮目标）
  const sx = px + pw + 22 * u, sw = iw - pw - 58 * u;
  [0.9, 0.6, 0.75, 0.5].forEach((k, i) => { ctx.fillStyle = mix(C.bg, C.line, 0.9); roundRect(ctx, sx, py + (8 + i * 26) * u, sw * k, 9 * u, 4.5 * u); ctx.fill(); });
  const T = MEDIA_TARGET;
  ctx.fillStyle = C.accent; roundRect(ctx, T.x * u - (T.w * u) / 2, T.y * u - (T.h * u) / 2, T.w * u, T.h * u, (T.h / 2) * u); ctx.fill();
  ctx.fillStyle = alpha(WHITE, 0.85); roundRect(ctx, T.x * u - 34 * u, T.y * u - 4 * u, 68 * u, 8 * u, 4 * u); ctx.fill();
  // 时间线：三条轨道上的片段
  const ty = py + ph + 20 * u, lanes = [[0, 0.34, 0.36, 0.3], [0.08, 0.5, 0.62, 0.2], [0, 0.24, 0.28, 0.46], [0.16, 0.3, 0.5, 0.36]];
  lanes.forEach((row, i) => {
    for (let j = 0; j < row.length; j += 2) {
      ctx.fillStyle = i === 1 ? mix(C.bg, C.accent, 0.35) : mix(C.bg, C.line, 1);
      roundRect(ctx, px + (iw - 36 * u) * row[j], ty + i * 21 * u, (iw - 36 * u) * row[j + 1], 13 * u, 4 * u); ctx.fill();
    }
  });
  ctx.restore();
}

function layers(_params, w, h, _assets, info) {
  const u = h / 720, x = w * 0.1, C = STYLE.color, F = STYLE.font, out = [];
  const now = info?.time ?? 0;
  out.push({ draw: (ctx) => { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h); } });

  // —— 标题：标题框 = 强调色竖条 + 一条底线。竖条先长出来，标题从竖条后面滑出（遮罩在竖条右侧），
  // 底线随后向右展开托住标题；停留时只随缓推，离场整组向左退出。——
  const title = SCENES.title, ty = h * 0.5, titleFont = font(700, 64 * u, F.title), titleW = measure(COPY.title, titleFont);
  out.push({
    bounds: [0, -46 * u, 6 * u, 46 * u],
    pose: (t) => {
      const p = phase(t, title, 0, 0.55);
      if (!p.on || p.enter < 0.002) return null;
      const c = camera(t, w, h), [px, py] = c.at(x - p.leave * 40 * u, ty);
      return { x: px, y: py, scaleX: c.s, scaleY: c.s * p.enter, opacity: 1 - p.leave };
    },
    draw: (ctx) => { ctx.fillStyle = C.accent; ctx.fillRect(0, -46 * u, 6 * u, 92 * u); },
  });
  const tc = camera(now, w, h), [clipL, clipT] = tc.at(x + 20 * u, ty - 60 * u), [, clipB] = tc.at(0, ty + 40 * u);
  out.push({
    clip: [clipL, clipT, w, clipB],
    bounds: [0, -56 * u, titleW, 16 * u],
    pose: (t) => {
      const p = phase(t, title, 0.12, 0.8);
      if (!p.on) return null;
      const c = camera(t, w, h), [px, py] = c.at(x + 26 * u - (1 - p.enter) * (titleW * 0.5) - p.leave * 40 * u, ty + 22 * u);
      return { x: px, y: py, scale: c.s, opacity: 1 - p.leave };
    },
    draw: (ctx) => { ctx.fillStyle = C.text; ctx.font = titleFont; ctx.fillText(COPY.title, 0, 0); },
  });
  out.push({
    bounds: [0, 0, 100, 2 * u],
    pose: (t) => {
      const p = phase(t, title, 0.3, 0.9), len = (titleW + 26 * u) * p.enter;
      if (!p.on || len < 1) return null;
      const c = camera(t, w, h), [px, py] = c.at(x + 26 * u - p.leave * 40 * u, ty + 46 * u);
      return { x: px, y: py, scaleX: (len / 100) * c.s, scaleY: c.s, opacity: 1 - p.leave };
    },
    draw: (ctx) => { ctx.fillStyle = C.line; ctx.fillRect(0, 0, 100, 2 * u); },
  });

  // —— 花字与关键词：提炼成短语，“不走样”是重点：字更大更重，强调色色块从左向右垫在下半截。正着放，不倾斜。——
  const kw = SCENES.keyword, leadFont = font(500, 40 * u, F.body), keyFont = font(800, 92 * u, F.title);
  const leadW = measure(COPY.keyword.lead, leadFont), keyW = measure(COPY.keyword.key, keyFont), gap = 18 * u;
  const kx = w / 2 - (leadW + gap + keyW) / 2, ky = h * 0.6;
  out.push(mover(w, h, u, {
    scene: kw, x: kx, y: ky, bounds: [0, -44 * u, leadW, 10 * u],
    draw: (ctx) => { ctx.fillStyle = C.muted; ctx.font = leadFont; ctx.fillText(COPY.keyword.lead, 0, 0); },
  }));
  out.push(mover(w, h, u, {
    scene: kw, x: kx + leadW + gap, y: ky, delay: 0.06, bounds: [-6 * u, -86 * u, keyW + 6 * u, 16 * u],
    draw: (ctx, t) => {
      const k = cubicInOut((t - kw[0] - 0.35) / 0.45);
      if (k > 0) { ctx.fillStyle = alpha(C.accent, 0.22); ctx.fillRect(-6 * u, -30 * u, (keyW + 12 * u) * k, 34 * u); }
      ctx.fillStyle = C.text; ctx.font = keyFont; ctx.fillText(COPY.keyword.key, 0, 0);
    },
  }));

  // —— 图片与录屏容器 + 高亮：容器从下方带着速度升起、略放大落位，内容和容器是一个整体；
  // 角上标“示意画面”。容器落定后，高亮压暗目标以外的区域，强调色细框收拢到目标上。——
  const media = SCENES.media, mx = w / 2, my = h * 0.52, W = MEDIA.w * u, H = MEDIA.h * u;
  const lift = (t) => { const p = phase(t, media, 0, 0.9); return { p, y: (1 - p.enter) * 70 * u, s: 0.94 + 0.06 * p.enter }; };
  const mediaPose = (t) => {
    const { p, y, s } = lift(t);
    if (!p.on) return null;
    const c = camera(t, w, h), [px, py] = c.at(mx - p.leave * 40 * u, my + y);
    return { x: px, y: py, scale: c.s * s, opacity: Math.min(1, p.enter * 2.5) * (1 - p.leave) };
  };
  out.push({ bounds: [-W / 2 - 40 * u, -H / 2 - 30 * u, W / 2 + 40 * u, H / 2 + 60 * u], pose: mediaPose, draw: (ctx) => mockScreen(ctx, u) });
  out.push(mover(w, h, u, {
    scene: media, x: mx - W / 2, y: my - H / 2 - 16 * u, delay: 0.12, from: 24,
    bounds: [0, -16 * u, 120 * u, 4 * u],
    draw: (ctx) => { ctx.fillStyle = C.muted; ctx.font = font(500, 14 * u, F.body); ctx.fillText(COPY.media, 0, 0); },
  }));
  const hl = (t) => cubicInOut((t - media[0] - 1.15) / 0.6) * (1 - phase(t, media).leave);
  const T = MEDIA_TARGET;
  out.push({
    bounds: [-W / 2, -H / 2, W / 2, H / 2], pose: (t) => { const k = hl(t), base = mediaPose(t); return base && k > 0 ? { ...base, opacity: k } : null; },
    draw: (ctx) => {
      ctx.save();
      roundRect(ctx, -W / 2 + MEDIA.bezel * u, -H / 2 + MEDIA.bezel * u, W - 2 * MEDIA.bezel * u, H - 2 * MEDIA.bezel * u, (MEDIA.r - 6) * u);
      ctx.roundRect(T.x * u - T.w * u / 2 - 10 * u, T.y * u - T.h * u / 2 - 10 * u, T.w * u + 20 * u, T.h * u + 20 * u, (T.h / 2 + 10) * u);
      ctx.fillStyle = alpha(C.text, 0.24); ctx.fill("evenodd");
      ctx.restore();
    },
  });
  out.push({
    bounds: [-T.w * u, -T.h * u, T.w * u, T.h * u],
    pose: (t) => {
      const k = hl(t), base = mediaPose(t);
      if (!base || k <= 0) return null;
      const grow = 1 + 0.35 * (1 - k), c = camera(t, w, h), s = base.scale;
      return { x: base.x + T.x * u * s, y: base.y + T.y * u * s, scale: s * grow, opacity: k };
    },
    draw: (ctx) => {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 3 * u;
      roundRect(ctx, -T.w * u / 2 - 10 * u, -T.h * u / 2 - 10 * u, T.w * u + 20 * u, T.h * u + 20 * u, (T.h / 2 + 10) * u); ctx.stroke();
    },
  });

  // —— 数据：数字从 0 计数到终值（expoOut，越接近越慢），单位用强调色；进度线跟着数字走。——
  const data = SCENES.data, numFont = font(700, 150 * u, F.number), numW = measure("88", numFont);
  const count = (t) => COPY.data.value * expoOut((t - data[0] - 0.1) / 1.2);
  out.push(mover(w, h, u, {
    scene: data, x, y: h * 0.56, bounds: [0, -116 * u, numW + 90 * u, 60 * u],
    draw: (ctx, t) => {
      ctx.fillStyle = C.text; ctx.font = numFont; ctx.textAlign = "right";
      ctx.fillText(String(Math.round(count(t))), numW, 0);
      ctx.textAlign = "left"; ctx.fillStyle = C.accent; ctx.font = font(700, 60 * u, F.number); ctx.fillText(COPY.data.unit, numW + 14 * u, 0);
      ctx.fillStyle = C.muted; ctx.font = font(500, 24 * u, F.body); ctx.fillText(COPY.data.label, 4 * u, 48 * u);
    },
  }));
  out.push(mover(w, h, u, {
    scene: data, x, y: h * 0.74, delay: 0.08, bounds: [0, 0, w * 0.8, 4 * u],
    draw: (ctx, t) => {
      ctx.fillStyle = C.line; ctx.fillRect(0, 0, w * 0.8, 4 * u);
      ctx.fillStyle = C.accent; ctx.fillRect(0, 0, w * 0.8 * (count(t) / 100), 4 * u);
    },
  }));

  // —— 人名条：强调色竖条长出来，名字和职位从竖条后面滑出（遮罩），一行写完。——
  const name = SCENES.name, ny = h * 0.78, nameFont = font(700, 34 * u, F.title), nameW = measure(COPY.name.name, nameFont);
  out.push({
    bounds: [0, -34 * u, 6 * u, 34 * u],
    pose: (t) => {
      const p = phase(t, name, 0, 0.5);
      if (!p.on || p.enter < 0.002) return null;
      const c = camera(t, w, h), [px, py] = c.at(x - p.leave * 40 * u, ny);
      return { x: px, y: py, scaleX: c.s, scaleY: c.s * p.enter, opacity: 1 - p.leave };
    },
    draw: (ctx) => { ctx.fillStyle = C.accent; ctx.fillRect(0, -34 * u, 6 * u, 68 * u); },
  });
  const nc = camera(now, w, h), [nClipL, nClipT] = nc.at(x + 18 * u, ny - 40 * u), [, nClipB] = nc.at(0, ny + 40 * u);
  out.push({
    clip: [nClipL, nClipT, w, nClipB],
    bounds: [0, -30 * u, nameW + 24 * u + 140 * u, 10 * u],
    pose: (t) => {
      const p = phase(t, name, 0.1, 0.7);
      if (!p.on) return null;
      const c = camera(t, w, h), [px, py] = c.at(x + 24 * u - (1 - p.enter) * 160 * u - p.leave * 40 * u, ny + 11 * u);
      return { x: px, y: py, scale: c.s, opacity: 1 - p.leave };
    },
    draw: (ctx) => {
      ctx.fillStyle = C.text; ctx.font = nameFont; ctx.fillText(COPY.name.name, 0, 0);
      ctx.fillStyle = C.muted; ctx.font = font(500, 20 * u, F.body); ctx.fillText(COPY.name.role, nameW + 24 * u, 0);
    },
  });

  // —— 收尾：一句话居中滑入落定，强调色短线从中间向两边展开托住它。——
  const end = SCENES.end, endFont = font(700, 50 * u, F.title), endW = measure(COPY.end, endFont);
  out.push(mover(w, h, u, {
    scene: end, x: w / 2 - endW / 2, y: h / 2 + 16 * u, inDur: 0.9, bounds: [0, -46 * u, endW, 12 * u],
    draw: (ctx) => { ctx.fillStyle = C.text; ctx.font = endFont; ctx.fillText(COPY.end, 0, 0); },
  }));
  out.push({
    bounds: [-50, 0, 50, 3 * u],
    pose: (t) => {
      const k = expoOut((t - end[0] - 0.35) / 0.8);
      if (k <= 0.002) return null;
      const c = camera(t, w, h), [px, py] = c.at(w / 2, h / 2 + 44 * u);
      return { x: px, y: py, scaleX: c.s * k * 0.9, scaleY: c.s };
    },
    draw: (ctx) => { ctx.fillStyle = C.accent; ctx.fillRect(-50, 0, 100, 3 * u); },
  });
  return out;
}

export default {
  name: "风格样片", kind: "generator", mode: "dynamic",
  nameEnglish: "Style sample",
  params: [],
  motionBlur: { shutter: 180 },
  layers,
};
`
