import { STYLE_SAMPLE_COLORS } from '../../theme/colorTokens'

/** 新建风格自带的样片：标准分镜（标题 → 要点 → 数据 → 人名条 → 收尾），浅底、蓝色强调；照着改成自己的风格。 */
export const BLANK_STYLE_SAMPLE_SOURCE = `// 风格样片：按标准分镜演示本风格。整段时长、尺寸、锚点帧在风格的 sample 设置里。
// 改风格时先改 STYLE 里的取值和下面各层的画法；分镜与文案保持标准，方便不同风格并排比较。
// 只能用相对导入（同目录内的文件），不访问网络、文件或 DOM；量字用 OffscreenCanvas。
//
// 分层写法（运行时据此做运动模糊，默认 180° 快门）：
// - layers() 从后到前返回若干层；没有 pose 的层是静止层，按当前时刻 t 在画面坐标里画。
// - 会动的元素各成一层：在本地坐标里画内容，bounds 给出本地内容范围，pose(t) 给出
//   { x, y, rotation, scale / scaleX / scaleY, opacity }，不可见时返回 null。内容随时间变的（计数、逐字）照常在 draw 里按 t 画。
// - 文字从遮罩里升起这类效果：加 clip（画面坐标里固定的矩形），内容随 pose 移动，遮罩不动。

const STYLE = {
  color: ${JSON.stringify(STYLE_SAMPLE_COLORS).replace(/,/g, ', ')},
  font: {
    title: '"HarmonyOS Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
    body: '"HarmonyOS Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
    number: '"DIN Alternate", "Bahnschrift", "Segoe UI", sans-serif',
  },
};

// 标准分镜（秒）与标准文案。
const SCENES = { title: [0, 1.8], list: [1.8, 3.8], data: [3.8, 5.6], name: [5.6, 6.9], end: [6.9, 8] };
const COPY = {
  title: "把想法变成画面",
  subtitle: "风格样片",
  list: ["统一的配色", "统一的字体", "统一的节奏"],
  data: { value: 87, unit: "%", label: "一次通过率" },
  name: { name: "痕继痕迹", role: "动效设计师" },
  end: "一个风格，处处一致",
};

const clamp = (v) => Math.max(0, Math.min(1, v));
const expoOut = (v) => (v >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(v)));
const cubicIn = (v) => clamp(v) ** 3;
const within = (t, [a, b]) => t >= a && t < b;
// 场景内进度：入场 [a, a+inDur]，离场 [b-outDur, b]。
function phase(t, [a, b], delay = 0, inDur = 0.6, outDur = 0.3) {
  return { enter: expoOut((t - a - delay) / inDur), leave: cubicIn((t - (b - outDur)) / outDur) };
}
const font = (weight, size, family) => \`\${weight} \${Math.round(size)}px \${family}\`;

function layers(_params, w, h) {
  // u：以 720 高为基准的长度单位，竖屏和其他尺寸按画面高度等比缩放。
  const u = h / 720, x = w * 0.1, C = STYLE.color, F = STYLE.font, out = [];
  out.push({ draw: (ctx) => { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h); } });

  // 标题：强调短线向右展开，标题与副标题上浮淡入。
  const title = SCENES.title, ty = h * 0.5;
  out.push({
    bounds: [0, 0, 48 * u, 6 * u],
    pose: (t) => {
      const p = phase(t, title);
      return within(t, title) && p.enter > 0.002 ? { x, y: ty - 96 * u, scaleX: p.enter, scaleY: 1, opacity: 1 - p.leave } : null;
    },
    draw: (ctx) => { ctx.fillStyle = C.accent; ctx.fillRect(0, 0, 48 * u, 6 * u); },
  });
  out.push({
    bounds: [-10 * u, -70 * u, 520 * u, 60 * u],
    pose: (t) => {
      const p = phase(t, title);
      return within(t, title) ? { x, y: ty + (1 - p.enter) * 24 * u - p.leave * 16 * u, opacity: p.enter * (1 - p.leave) } : null;
    },
    draw: (ctx) => {
      ctx.fillStyle = C.text; ctx.font = font(700, 64 * u, F.title); ctx.fillText(COPY.title, 0, 0);
      ctx.fillStyle = C.muted; ctx.font = font(400, 22 * u, F.body); ctx.fillText(COPY.subtitle, 0, 48 * u);
    },
  });

  // 要点：每条从左侧滑入。
  const list = SCENES.list;
  COPY.list.forEach((item, i) => {
    out.push({
      bounds: [-4 * u, -40 * u, 320 * u, 14 * u],
      pose: (t) => {
        const p = phase(t, [list[0] + i * 0.12, list[1]], 0, 0.5, 0.3);
        return within(t, list) && p.enter > 0 ? { x: x + (1 - p.enter) * 20 * u, y: h * 0.36 + i * 72 * u, opacity: p.enter * (1 - p.leave) } : null;
      },
      draw: (ctx) => {
        ctx.fillStyle = C.accent; ctx.fillRect(0, -14 * u, 8 * u, 8 * u);
        ctx.fillStyle = C.text; ctx.font = font(500, 36 * u, F.body); ctx.fillText(item, 28 * u, 0);
      },
    });
  });

  // 数据：数字计数（内容变化，静止层），进度条向右展开。
  const data = SCENES.data, count = (t) => Math.round(COPY.data.value * expoOut((t - data[0]) / 1.2));
  out.push({
    draw: (ctx, t) => {
      if (!within(t, data)) return;
      const p = phase(t, data);
      ctx.globalAlpha = p.enter * (1 - p.leave);
      ctx.fillStyle = C.text; ctx.font = font(700, 140 * u, F.number); ctx.fillText(\`\${count(t)}\${COPY.data.unit}\`, x, h * 0.56);
      ctx.fillStyle = C.muted; ctx.font = font(400, 24 * u, F.body); ctx.fillText(COPY.data.label, x, h * 0.56 + 44 * u);
      ctx.fillStyle = C.line; ctx.fillRect(x, h * 0.72, w * 0.8, 4 * u);
      ctx.globalAlpha = 1;
    },
  });
  out.push({
    bounds: [0, 0, 100, 4 * u],
    pose: (t) => {
      const p = phase(t, data), len = w * 0.8 * (count(t) / 100);
      return within(t, data) && len > 0.5 ? { x, y: h * 0.72, scaleX: len / 100, scaleY: 1, opacity: p.enter * (1 - p.leave) } : null;
    },
    draw: (ctx) => { ctx.fillStyle = C.accent; ctx.fillRect(0, 0, 100, 4 * u); },
  });

  // 人名条：竖线向下长出，名字与职位淡入。
  const name = SCENES.name, ny = h * 0.78;
  out.push({
    bounds: [0, 0, 6 * u, 64 * u],
    pose: (t) => {
      const p = phase(t, name, 0, 0.5, 0.3);
      return within(t, name) && p.enter > 0.002 ? { x, y: ny - 40 * u, scaleX: 1, scaleY: p.enter, opacity: 1 - p.leave } : null;
    },
    draw: (ctx) => { ctx.fillStyle = C.accent; ctx.fillRect(0, 0, 6 * u, 64 * u); },
  });
  out.push({
    draw: (ctx, t) => {
      if (!within(t, name)) return;
      const p = phase(t, name, 0, 0.5, 0.3);
      ctx.globalAlpha = p.enter * (1 - p.leave);
      ctx.fillStyle = C.text; ctx.font = font(700, 34 * u, F.title); ctx.fillText(COPY.name.name, x + 24 * u, ny - 4 * u);
      ctx.fillStyle = C.muted; ctx.font = font(400, 20 * u, F.body); ctx.fillText(COPY.name.role, x + 24 * u, ny + 24 * u);
      ctx.globalAlpha = 1;
    },
  });

  // 收尾：一句话居中淡入。
  const end = SCENES.end;
  out.push({
    draw: (ctx, t) => {
      if (t < end[0]) return;
      ctx.globalAlpha = phase(t, [end[0], 99]).enter;
      ctx.fillStyle = C.text; ctx.font = font(700, 48 * u, F.title); ctx.textAlign = "center";
      ctx.fillText(COPY.end, w / 2, h / 2 + 16 * u);
      ctx.textAlign = "left"; ctx.globalAlpha = 1;
    },
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
