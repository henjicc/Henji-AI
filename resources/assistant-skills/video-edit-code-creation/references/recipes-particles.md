# 粒子与场

配方只示范写法与常见做法，不是推荐风格；数量、颜色、速度、形状按风格说明书或需求改。

粒子在本项目里是“按时间直接算出每一颗在哪”，不是逐帧模拟：每颗粒子的初始属性用种子哈希 `hash(i * k + j)` 取（同一颗用不同的 j 取不同属性），位置是时间的函数。这样任意寻帧结果一致，倒放、变速、拖播放头都不会错。依赖上一帧的流体、轨迹积累不要写成跨帧状态；轨迹用“同一个函数在稍早时刻再求一次”画出来。

## 怎样让它好看

- **纵深**：给每颗一个深度 0–1，近的大、亮、快、清楚，远的小、暗、慢。一个深度值同时驱动四件事，层次就出来了。
- **大小分布**：大部分小、少数大（如 `depth * depth`），比均匀分布自然。
- **运动有主方向**：整体漂移＋少量扰动，比完全随机好看。
- **闪烁错相**：每颗一个相位 `hash(...) * Math.PI * 2`，亮度用 `Math.sin(t * 频率 + 相位)`。
- **循环**：横向漂移取模绕回；需要首尾相接时让所有周期运动的周期整除片段时长。
- **量**：Canvas2D 几千颗没有问题，数量开成参数；看 performance 反馈，上万颗或逐像素的场（烟、流体感）改用 createWebGPU（实例化绘制或计算着色器），见 author-shaders。

## 漂浮光尘

```ts
const hash = i => { let h = Math.imul(i, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return (h >>> 0) / 4294967296 }
const mod = (v, m) => ((v % m) + m) % m
export default {
  name: "漂浮光尘", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 8,
  params: [
    { key: "count", type: "number", title: "数量", default: 500, min: 0, max: 5000, step: 1 },
    { key: "speed", type: "number", title: "速度", default: 1, min: 0, max: 3, step: .05 },
    { key: "tint", type: "color", title: "颜色", default: [1, .86, .62, 1] }
  ],
  draw(ctx, t, params, width, height) {
    const [r, g, b] = params.tint.map(v => Math.round(v * 255))
    for (let i = 0; i < params.count; i++) {
      const depth = hash(i * 5 + 1), phase = hash(i * 5 + 4) * Math.PI * 2
      const pace = params.speed * (.3 + depth)
      const x = mod(hash(i * 5 + 2) * width + t * 40 * pace, width + 40) - 20
      const y = hash(i * 5 + 3) * height + Math.sin(t * .6 * pace + phase) * 30 * depth
      const size = 2 + depth * depth * 10
      const twinkle = .55 + .45 * Math.sin(t * (1 + depth * 2) + phase)
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${twinkle * (.25 + depth * .75)})`
      ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fill()
    }
  }
}
```

## 爆散

从一点向外炸开，带重力和拖尾。角度均匀、距离随机，expoOut 让爆发先快后慢；拖尾是同一颗在 0.06 秒前的位置连线。

```ts
const hash = i => { let h = Math.imul(i, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return (h >>> 0) / 4294967296 }
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
const at = (angle, reach, p) => [Math.cos(angle) * reach * expoOut(p), Math.sin(angle) * reach * expoOut(p) + 420 * p * p]
export default {
  name: "爆散", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 3,
  params: [
    { key: "start", type: "number", title: "爆发时刻", default: .3, min: 0, max: 2, step: .05 },
    { key: "hot", type: "color", title: "中心色", default: "#fff2cc" },
    { key: "cool", type: "color", title: "边缘色", default: "#ff5933" }
  ],
  draw(ctx, time, params, width, height) {
    const life = 1.8, p = clamp01((time - params.start) / life), before = clamp01((time - .06 - params.start) / life)
    if (p <= 0) return
    ctx.translate(width / 2, height * .45); ctx.lineCap = "round"; ctx.globalAlpha = 1 - p
    ctx.strokeStyle = p < .3 ? params.hot : params.cool
    for (let i = 0; i < 500; i++) {
      const angle = hash(i * 3 + 1) * Math.PI * 2, reach = 160 + Math.pow(hash(i * 3 + 2), .6) * 720
      const head = at(angle, reach, p), tail = at(angle, reach, before)
      ctx.lineWidth = 1 + hash(i * 3 + 3) * 3
      ctx.beginPath(); ctx.moveTo(tail[0], tail[1]); ctx.lineTo(head[0], head[1]); ctx.stroke()
    }
  }
}
```

## 漩涡星轨

粒子绕中心转，越靠里转得越快；`Math.sqrt(hash)` 让粒子在圆盘里均匀分布，弧形拖尾由同一函数在稍早时刻求值连成。

```ts
const hash = i => { let h = Math.imul(i, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return (h >>> 0) / 4294967296 }
const orbit = (radius, angle, t) => [Math.cos(angle + t * 90 / (radius + 60)) * radius, Math.sin(angle + t * 90 / (radius + 60)) * radius * .55]
export default {
  name: "漩涡星轨", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 10,
  params: [{ key: "tint", type: "color", title: "颜色", default: [.62, .8, 1, 1] }],
  draw(ctx, t, params, width, height) {
    const [r, g, b] = params.tint.map(v => Math.round(v * 255))
    ctx.translate(width / 2, height / 2); ctx.lineCap = "round"
    for (let i = 0; i < 700; i++) {
      const radius = Math.sqrt(hash(i * 4 + 1)) * 760, angle = hash(i * 4 + 2) * Math.PI * 2
      const head = orbit(radius, angle, t), tail = orbit(radius, angle, t - .25), near = 1 - radius / 900
      ctx.lineWidth = .8 + near * 2; ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${.2 + .8 * near * hash(i * 4 + 3)})`
      ctx.beginPath(); ctx.moveTo(tail[0], tail[1]); ctx.lineTo(head[0], head[1]); ctx.stroke()
    }
  }
}
```

## 再往前走

- 粒子组成文字或形状：在离屏 Canvas 上画字，`getImageData` 取一次像素位置（按文字缓存，不要每帧取），粒子从随机位置插值到这些点。
- 逐像素的场（烟、流体感、极光）用 createWebGPU，见 author-shaders；粒子和 GPU 背景可以分图层叠用。
- 跟着音乐跳：用 `info.audio` 的 levels、bands、beats 驱动尺寸或亮度，见 author-api-media。
