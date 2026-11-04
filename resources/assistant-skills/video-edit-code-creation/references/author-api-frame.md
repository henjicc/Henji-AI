# 作者接口：每帧画面键、片子数据与累积模拟

模块契约见 [author-api](author-api.md)。

## 每帧画面键与片子数据

模块可选声明（完整类型见 `resources/video-edit-author/author-api.d.ts`）：

```text
frameKey?(params: AuthorParameters, width: number, height: number, info: AuthorFrameInfo): unknown
dataFiles?: readonly string[]
```

`frameKey` 是纯函数，返回 JSON 数据：null、布尔、字符串、有限数字、数组或普通对象。不能包含 undefined、函数、symbol、bigint、循环引用、NaN/Infinity 或异步结果。只用参数、尺寸、时刻和模块自己的数据，不读 GPU、画布、素材像素或网页布局；不调用文字测量、栅格或绘制入口。宿主按代码身份、返回值、本帧排到的素材/网页内容与取帧时间、相关片子数据记录及画面参数判断能否复用。提供 frameKey 后，Canvas、文字栅格、layers 读取素材、WebGPU 与 WebGL 都走声明键，不再尝试录画布；报错或返回非 JSON 值时保守使用版本摘要，并记录原因。目前用于代码生成片段，附加代码滤镜继续按版本依赖失效。

`frameKey` 描述这一帧的整个曝光区间，宿主每帧只调用一次。`info.time` 与 `info.clip` 始终是中心帧上下文；`info.frameDuration` 为一帧秒数。宿主在 frameKey 的 `info.exposure` 提供 `{ start, end, shutter, phase }`：start/end 为包含中心时刻的完整曝光范围（素材秒数），shutter/phase 为有效快门角度；未开启图层运动模糊时 start = end = time，角度均为 0。默认快门 180°、相位 -90°，范围为 time ± frameDuration / 4；自定义快门与相位按模块 motionBlur 求值。

作者负责把曝光范围内会影响画面的量全部放进返回值，包括文字、位置、颜色、镜头轨迹与落点，以及曝光边界内的出现/退场。可以用 frameDuration 作保守 padding，但不能只描述中心时刻，也不能只给段落名。两次返回值相同，且 dataFiles 以外的代码与输入相同，整个曝光画面必须相同。宿主不再替作者枚举快门候选时刻。不要依赖调用次数、顺序或上次调用留下的状态。

`dataFiles` 填工程内完整相对路径（例如 `film/demo/film.ts`），不写通配符或文件夹；入口文件始终计入代码身份，不存在的路径忽略。这些文件对画面的影响必须全部体现在 frameKey 返回值里，只有声明 frameKey 才会排除；其他文件、入口、钉住的组件与库版本、作者 API 版本仍计入代码身份。不要把未由画面键表达的画法或着色器放进去。漏报会留下旧画面；修正声明后，用剪辑的“删除渲染文件”恢复。

写法：先算出这一刻要画的清单，frameKey 返回清单，draw 只按清单画。多文件工程把描述数据放在 dataFiles；同一求清单函数供声明和绘制使用，别各写一套。

```ts
const film = [{ at: 0, end: 2, text: "开场", x: 120 }, { at: 2, end: 5, text: "正文", x: 160 }]
const picture = (params, width, height, info) => ({
  background: params.background,
  labels: film.filter(item => info.time >= item.at && info.time < item.end)
    .map(item => ({ text: item.text, x: item.x, y: height / 2, color: params.ink }))
})
export default {
  name: "按清单绘制", kind: "generator", mode: "dynamic",
  params: [
    { key: "background", type: "color", title: "背景", default: "#21262f" },
    { key: "ink", type: "color", title: "文字", default: "#ffffff" }
  ],
  frameKey: picture,
  draw(ctx, time, params, width, height, assets, info) {
    const list = picture(params, width, height, info)
    ctx.fillStyle = list.background; ctx.fillRect(0, 0, width, height)
    ctx.font = "64px sans-serif"
    for (const label of list.labels) {
      ctx.fillStyle = label.color; ctx.fillText(label.text, label.x, label.y)
    }
  }
}
```

此完整例子把 film 内联在入口，所以改它仍改变代码身份。工程中将 film 搬到 `film/demo/film.ts` 并导入，再在模块上写 `dataFiles: ["film/demo/film.ts"]`，即可让不影响当前清单的数据改动复用已有画面。

## 累积模拟（作者 API 13）

在模块的 `createSimulation(params, width, height, info)` 工厂内创建每个实例自己的状态，异步准备可以在这里完成；包括 `await` 之后，随机值只用 `info.random()`，不用 `Math.random()` 或 `Date.now()`。`simulation: { rate: 120, snapshotEvery: 120, seed: 0 }` 可省略，默认即这些值；不能同时声明 `mode: 'static'`。

工厂返回 `step(params, info)`、`snapshot()`、`restore(snapshot)`、`read()`、`dispose()`，可选 `interpolate(left, right, alpha)`。工厂之后的方法均为同步。`step` 每次从第 n 步推进到 n+1，`info.time = n / rate` 为模拟时间，参数按该步对应的源时间求值，`info.dt = 1 / rate`；随机值使用 `info.random()`。画幅是逻辑作者画幅，预览分辨率不会改变物理大小。

`snapshot` 保存所有影响未来的状态，包括物理世界外的计数、句柄表和延迟事件；返回普通数据树或数值缓冲。`restore` 收到独立副本；`read` 返回用于画面的数据。绘制入口通过 `info.simulation.at(t)` 读取当前帧中心或曝光区间的视图；不要在绘制时推进世界，也不要查询当前曝光区间以外的历史。同一时刻取一次视图再供各图层使用；完整步视图在准备时复制、冻结，插值按时刻缓存，数值缓冲也按只读使用。没有插值方法时保持前一个完整步；有插值时只根据两个只读视图计算结果。

世界放在工厂闭包中，不能放模块顶层。生成片段从源时间 0 起算；附加滤镜从片段首帧的源入点起算，随片段源时间推进，倒放源沿播放方向计步。跳转由宿主恢复、续算；参数曲线或源码变化后自动重建。`dispose` 释放世界与事件队列。快照只留在内存，不保存到工程。

物理可导入 `@dimforge/rapier3d-deterministic-compat`，固定作者库 `0.21.0-henji.1`（上游 `0.21.0`）；在工厂里 `await RAPIER.init()`。每步设置 `world.timestep = info.dt` 后调用一次 `world.step()`。快照用 `world.takeSnapshot()`；恢复时先成功创建 `RAPIER.World.restoreSnapshot(bytes)`，再释放旧世界并重新获取刚体句柄；`EventQueue` 单独管理和释放。
