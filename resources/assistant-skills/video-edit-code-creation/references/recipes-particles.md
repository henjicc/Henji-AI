# 粒子与场

配方只示范写法与常见做法，不是推荐风格；数量、颜色、速度、形状按风格说明书或需求改。

粒子在本项目里是“按时间直接算出每一颗在哪”，不是逐帧模拟：每颗粒子的初始属性用 `random(i * k + j)` 取（同一颗用不同的 j 取不同属性），位置是时间的函数。这样任意寻帧结果一致，倒放、变速、拖播放头都不会错。需要依赖上一帧的流体、轨迹积累做不到；轨迹可以用“同一个函数在稍早时刻再求一次”画出来。

## 怎样让它好看

- **纵深**：给每颗一个深度 0–1，近的大、亮、快、清楚，远的小、暗、慢、可加一点 blur。一个深度值同时驱动四件事，层次就出来了。
- **大小分布**：大部分小、少数大（如 `depth * depth`），比均匀分布自然。
- **运动有主方向**：整体漂移＋少量噪声扰动，比完全随机好看；噪声坐标用 `noise(i * 0.37, t * 速度)`。
- **闪烁错相**：每颗一个相位 `random(...) * TAU`，亮度用 `sin(t * 频率 + 相位)`。
- **循环**：横向漂移用 `mod(x, 宽度)` 绕回；需要首尾相接时让所有周期运动的周期整除片段时长。
- **量**：几百颗足够做氛围，几千颗做爆发和星空；数量开成参数。每帧 CPU 预算约 100 万单位：每颗用一次 noise 加几次三角运算约 600 单位，一千多颗就到上限；只用 random 和三角函数的简单粒子可到四千颗。超出时编译会告诉你超了多少、花在哪。更大规模或逐像素的场改用自写 WGSL 着色器。

## 漂浮光尘

```ts
export default {
  apiVersion: 1, languageVersion: 3,
  name: "漂浮光尘", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 8, seed: 7,
  parameters: {
    count: {type: "number", title: "数量", default: 500, min: 0, max: 1200, step: 1},
    speed: {type: "number", title: "速度", default: 1, min: 0, max: 3, step: .05},
    tint: {type: "color", title: "颜色", default: [1, .86, .62, 1]}
  },
  render(ctx) {
    const t = ctx.time;
    return repeat(ctx.params.count, i => {
      const depth = random(i * 5 + 1);
      const phase = random(i * 5 + 4) * TAU;
      const pace = ctx.params.speed * (.3 + depth);
      const drift = noise(i * .37, t * .15 * pace) - .5;
      const x = mod(random(i * 5 + 2) * ctx.width + t * 40 * pace + drift * 120, ctx.width + 40) - 20;
      const y = random(i * 5 + 3) * ctx.height + sin(t * .6 * pace + phase) * 30 * depth + drift * 60;
      const size = 2 + depth * depth * 10;
      const twinkle = .55 + .45 * sin(t * (1 + depth * 2) + phase);
      return ellipse({x: x - size / 2, y: y - size / 2, width: size, height: size, blur: (1 - depth) * 3,
        fill: [ctx.params.tint.r, ctx.params.tint.g, ctx.params.tint.b, twinkle * (.25 + depth * .75)]});
    });
  }
}
```

## 爆散

从一点向外炸开，带重力和拖尾。角度均匀、距离随机，`expoOut` 让爆发先快后慢；拖尾是同一颗在 0.06 秒前的位置连线。

```ts
const at = (angle, reach, p) => [cos(angle) * reach * expoOut(p), sin(angle) * reach * expoOut(p) + 420 * p * p];

export default {
  apiVersion: 1, languageVersion: 3,
  name: "爆散", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 3, seed: 11,
  parameters: {
    start: {type: "number", title: "爆发时刻", default: .3, min: 0, max: 2, step: .05},
    hot: {type: "color", title: "中心色", default: [1, .95, .8, 1]},
    cool: {type: "color", title: "边缘色", default: [1, .35, .2, 1]}
  },
  render(ctx) {
    const life = 1.8;
    return [group({x: ctx.width / 2, y: ctx.height * .45}, repeat(500, i => {
      const angle = random(i * 3 + 1) * TAU;
      const reach = 160 + pow(random(i * 3 + 2), .6) * 720;
      const p = clamp((ctx.time - ctx.params.start) / life, 0, 1);
      const before = clamp((ctx.time - .06 - ctx.params.start) / life, 0, 1);
      const head = at(angle, reach, p);
      const tail = at(angle, reach, before);
      const fade = (1 - p) * step(.001, p);
      return line({x1: tail[0], y1: tail[1], x2: head[0], y2: head[1], width: 1 + random(i * 3 + 3) * 3, lineCap: "round",
        color: mix(ctx.params.hot, ctx.params.cool, smoothstep(0, .6, p)), opacity: fade});
    }))];
  }
}
```

## 漩涡星轨

粒子绕中心转，越靠里转得越快；`sqrt(random)` 让粒子在圆盘里均匀分布，弧形拖尾由同一函数在稍早时刻求值连成。

```ts
const orbit = (radius, angle, t) => [cos(angle + t * 90 / (radius + 60)) * radius, sin(angle + t * 90 / (radius + 60)) * radius * .55];

export default {
  apiVersion: 1, languageVersion: 3,
  name: "漩涡星轨", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 10, seed: 3,
  parameters: {
    tint: {type: "color", title: "颜色", default: [.62, .8, 1, 1]}
  },
  render(ctx) {
    const t = ctx.time;
    return [group({x: ctx.width / 2, y: ctx.height / 2}, repeat(700, i => {
      const radius = sqrt(random(i * 4 + 1)) * 760;
      const angle = random(i * 4 + 2) * TAU;
      const head = orbit(radius, angle, t);
      const tail = orbit(radius, angle, t - .25);
      const near = 1 - radius / 900;
      return line({x1: tail[0], y1: tail[1], x2: head[0], y2: head[1], width: .8 + near * 2, lineCap: "round",
        color: [ctx.params.tint.r, ctx.params.tint.g, ctx.params.tint.b, .2 + .8 * near * random(i * 4 + 3)]});
    }))];
  }
}
```

## 再往前走

- 粒子组成文字或形状：对 `chars(text)` 的每个字用 `measureText` 求位置，粒子从随机位置 `mix` 到字的范围内，用 `expoOut(progress(...))` 汇聚。
- 逐像素的场（烟、流体感、极光）用自写 WGSL 着色器图层，见 author-shaders；粒子和着色器背景可以叠用。
- 跟着音乐跳：用 `ctx.audio.level()` 驱动尺寸或亮度，用 `ctx.audio.band("bass")` 读取低频能量，用 `ctx.audio.beatPhase()` 读取拍内相位；默认下方序列混音，可用 audio 参数绑定音频或视频素材。签名与时间基准见 author-api-expressions。
