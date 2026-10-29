# 四个可加载的作者代码样例

用于理解接口与设计关系，不原样套用到用户作品，也不代表推荐风格；每个作品按自己的简报重新定方向。色彩是作者画面数据；按品牌重设。先查序列规格和轨道，以下插入按 30fps、start=120、track=2 演示，实际必须换算。所有占位引用换为上下文/工具返回的真实值，外部 MCP 写入另带正式 operationId 信封。

每份源码先用 change_application_entities 提交到当前 document，结构如下（SOURCE 是对应下方完整源码字符串，用 JSON 编码，不能提交字面占位）：

```text
{summary:"创建代码素材",changes:[{kind:"create_items",
  entityType:"video_edit.code_material",parent:documentRef,
  items:[{properties:{"video_edit.code_material.name":素材名,
    "video_edit.code_material.source":SOURCE}}]}]}
```

拿到级联新建的 video_edit.item 后，再调用每例插入 JSON。调参 JSON 是插入后的另一次调用，先回读整份参数，合并再写；示意字典覆盖本例全部参数。重新选择字体时用实际 font 查询值替换默认通用家族。

## 一：克制的自适应标题条

把片名放在左下安全框，窄色线提供识别，底板只承载文字。0.6 秒进场、足够停留、最后 0.4 秒退出；换字后由排版结果驱动底板宽高，长标题折成两行或缩小字号。

<!-- skill-example: lower-third -->
```ts
import { layoutText, drawText } from "henji-layout/text"
const css = c => `rgba(${c[0] * 255}, ${c[1] * 255}, ${c[2] * 255}, ${c[3]})`
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
export default {
  name: "克制标题条", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 4,
  params: [
    { key: "title", type: "text", title: "标题", default: "第一章 出发", maxLength: 80, layer: "title-bar" },
    { key: "accent", type: "color", title: "强调色", default: [.43, .7, .63, 1], animatable: true },
    { key: "font", type: "text", title: "字体家族", default: "sans-serif", maxLength: 200 }
  ],
  layers(params) {
    const enter = t => expoOut(clamp01(t / .6)), leave = t => clamp01((t - 3.6) / .4)
    const text = layoutText(params.title, { fontFamily: params.font || "sans-serif", fontSize: 64, fontWeight: 600, align: "left", fill: { color: "#f0f5f2" } }, { maxWidth: 920, maxLines: 2, fit: { minFontSize: 40 } })
    const w = text.box.width + 88, h = Math.max(132, text.box.height + 48)
    return [{ id: "title-bar", bounds: [0, 0, w, h],
      pose: t => ({ x: -1080 + 1200 * enter(t), y: 962 - h, opacity: enter(t) * (1 - leave(t)) }),
      draw(ctx) {
        ctx.fillStyle = "rgba(9, 11, 14, .94)"; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 12); ctx.fill()
        ctx.fillStyle = css(params.accent); ctx.fillRect(0, 24, 4, h - 48)
        ctx.save(); ctx.translate(44, (h - text.box.height) / 2); drawText(ctx, text); ctx.restore()
      } }]
  }
}
```

插入调用：

```json
{
  "summary": "插入克制标题条",
  "changes": [
    {
      "kind": "create_items",
      "entityType": "video_edit.clip",
      "parent": {
        "kind": "video_edit.sequence",
        "id": "实际序列引用id"
      },
      "items": [
        {
          "properties": {
            "video_edit.clip.item_id": "返回素材项id的子id",
            "video_edit.clip.kind": "code",
            "video_edit.clip.name": "克制标题条",
            "video_edit.clip.start": 120,
            "video_edit.clip.track": 2,
            "video_edit.clip.duration": 120,
            "video_edit.clip.code_parameters": {
              "title": "第一章 出发",
              "accent": [
                0.43,
                0.7,
                0.63,
                1
              ],
              "font": "sans-serif"
            }
          }
        }
      ]
    }
  ]
}
```

调参调用：

```json
{
  "summary": "调整克制标题条",
  "changes": [
    {
      "kind": "set_properties",
      "entityType": "video_edit.clip",
      "target": {
        "kind": "video_edit.clip",
        "id": "返回片段引用id"
      },
      "properties": {
        "video_edit.clip.code_parameters": {
          "title": "第二章 看见变化",
          "accent": [
            0.65,
            0.69,
            0.76,
            1
          ],
          "font": "sans-serif"
        }
      }
    }
  ]
}
```

## 二：逐字错峰花字

花字只强调一句短语。竖向 48px 错峰进场，浅色外描边、轻辉光（textStyle 的 shadows）与深底构成层次，避免每个字同时跳动。

容器先滑入，字素稍晚跟随，不做原地淡入上浮；分层、连写与缓存规则见 author-text-motion。

<!-- skill-example: stagger-title -->
```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
export default {
  name: "错峰花字", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 4,
  params: [
    { key: "title", type: "text", title: "强调短语", default: "灵感正在发生", maxLength: 32, layer: "headline" },
    { key: "glowPower", type: "number", title: "辉光强度", default: .65, min: 0, max: 2, step: .05 }
  ],
  layers(params, width, height) {
    const layout = layoutText(params.title, {
      fontSize: 112, fontWeight: 800, fill: { color: "#a7cdef" },
      strokes: [{ color: "#e0f7ff", width: 2, position: "outside" }],
      shadows: [{ color: "#59a6e6", opacity: .9, angle: 90, distance: 0, size: 0, blur: 16 * params.glowPower }]
    }, { maxWidth: 1600, maxLines: 1, fit: { minFontSize: 56 }, anchor: { x: 960, y: 540, horizontal: .5, vertical: .5 } })
    return [
      { id: "background", draw(ctx) { ctx.fillStyle = "#06080e"; ctx.fillRect(0, 0, width, height) } },
      { id: "headline", bounds: [160, 440, 1760, 640], pose: t => ({ x: (1 - expoOut(clamp01(t / .7))) * -120 }), draw(ctx, time) {
        const out = 1 - clamp01((time - 3.6) / .4)
        drawText(ctx, layout, { backgroundAndDecorationOpacity: clamp01(time / .28) * out, graphemes: (g, i) => {
          const start = .06 + i * Math.min(.012, .18 / Math.max(1, layout.graphemes.length - 1))
          const elapsed = time - start, p = expoOut(clamp01(elapsed / .55))
          return { y: (1 - p) * 14, opacity: clamp01(elapsed / .28) * out }
        } })
      } }
    ]
  }
}
```

插入调用：

```json
{
  "summary": "插入错峰花字",
  "changes": [
    {
      "kind": "create_items",
      "entityType": "video_edit.clip",
      "parent": {
        "kind": "video_edit.sequence",
        "id": "实际序列引用id"
      },
      "items": [
        {
          "properties": {
            "video_edit.clip.item_id": "返回素材项id的子id",
            "video_edit.clip.kind": "code",
            "video_edit.clip.name": "错峰花字",
            "video_edit.clip.start": 120,
            "video_edit.clip.track": 2,
            "video_edit.clip.duration": 120,
            "video_edit.clip.code_parameters": {
              "title": "灵感正在发生",
              "glowPower": 0.65
            }
          }
        }
      ]
    }
  ]
}
```

调参调用：

```json
{
  "summary": "调整错峰花字",
  "changes": [
    {
      "kind": "set_properties",
      "entityType": "video_edit.clip",
      "target": {
        "kind": "video_edit.clip",
        "id": "返回片段引用id"
      },
      "properties": {
        "video_edit.clip.code_parameters": {
          "title": "下一幕 即刻开始",
          "glowPower": 0.45
        }
      }
    }
  ]
}
```

## 三：极光上的章节卡

背景缓慢流动，前景保持稳定阅读。深色底、极光波带、颗粒与细边卡片分层，以章节号、小标签和一句大标题建立信息顺序；卡片整体淡入，不让装饰抢戏。

<!-- skill-example: aurora-chapter -->
```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
const hash = i => { let h = Math.imul(i, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return (h >>> 0) / 4294967296 }
export default {
  name: "极光章节卡", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: "chapter", type: "text", title: "章节编号", default: "03", maxLength: 8, layer: "chapter-card" },
    { key: "title", type: "text", title: "章节标题", default: "把想法变成画面", maxLength: 80, layer: "chapter-card" },
    { key: "speed", type: "number", title: "背景流速", default: 1.5, min: 0, max: 6, step: .1 }
  ],
  layers(params, width, height) {
    const p = t => expoOut(clamp01((t - .15) / .7))
    const label = layoutText(`第 ${params.chapter} 章`, { fontSize: 30, tracking: 100, align: "left", fill: { color: "#8cbfb8" } })
    const title = layoutText(params.title, { fontSize: 88, fontWeight: 600, align: "left", fill: { color: "#f0f5f0" } }, { maxWidth: 1176, maxLines: 2, fit: { minFontSize: 56 } })
    return [
      { id: "aurora", draw(ctx, time) {
        ctx.fillStyle = "#050910"; ctx.fillRect(0, 0, width, height)
        ctx.globalCompositeOperation = "lighter"
        for (let band = 0; band < 3; band++) {
          ctx.beginPath(); ctx.moveTo(0, height)
          for (let x = 0; x <= width; x += 32) ctx.lineTo(x, height * (.35 + .08 * band) + Math.sin(x * .004 + time * params.speed * .4 + band * 2) * 90)
          ctx.lineTo(width, height); ctx.closePath()
          ctx.fillStyle = ["rgba(13, 46, 51, .55)", "rgba(31, 115, 102, .45)", "rgba(51, 61, 128, .4)"][band]; ctx.fill()
        }
        ctx.globalCompositeOperation = "source-over"
        const frame = Math.floor(time * 24)
        ctx.fillStyle = "rgba(255, 255, 255, .05)"
        for (let i = 0; i < 1500; i++) ctx.fillRect(hash(i * 2 + frame * 7919) * width, hash(i * 2 + 1 + frame * 7919) * height, 2, 2)
      } },
      { id: "chapter-card", bounds: [300, 320, 1620, 760],
        pose: t => ({ y: (1 - p(t)) * 40, opacity: p(t) * (1 - clamp01((t - 4.5) / .5)) }),
        draw(ctx, time) {
          ctx.fillStyle = "rgba(6, 11, 15, .88)"; ctx.strokeStyle = "rgba(120, 163, 161, .32)"; ctx.lineWidth = 1
          ctx.beginPath(); ctx.roundRect(300, 320, 1320, 440, 20); ctx.fill(); ctx.stroke()
          ctx.save(); ctx.translate(372, 384); drawText(ctx, label); ctx.restore()
          ctx.save(); ctx.translate(372, 650 - title.box.height); drawText(ctx, title); ctx.restore()
          ctx.strokeStyle = "rgba(140, 191, 184, .35)"; ctx.beginPath(); ctx.moveTo(372, 680); ctx.lineTo(372 + 1176 * p(time), 680); ctx.stroke()
        } }
    ]
  }
}
```

插入调用：

```json
{
  "summary": "插入极光章节卡",
  "changes": [
    {
      "kind": "create_items",
      "entityType": "video_edit.clip",
      "parent": {
        "kind": "video_edit.sequence",
        "id": "实际序列引用id"
      },
      "items": [
        {
          "properties": {
            "video_edit.clip.item_id": "返回素材项id的子id",
            "video_edit.clip.kind": "code",
            "video_edit.clip.name": "极光章节卡",
            "video_edit.clip.start": 120,
            "video_edit.clip.track": 2,
            "video_edit.clip.duration": 150,
            "video_edit.clip.code_parameters": {
              "chapter": "03",
              "title": "把想法变成画面",
              "speed": 1.5
            }
          }
        }
      ]
    }
  ]
}
```

调参调用：

```json
{
  "summary": "调整极光章节卡",
  "changes": [
    {
      "kind": "set_properties",
      "entityType": "video_edit.clip",
      "target": {
        "kind": "video_edit.clip",
        "id": "返回片段引用id"
      },
      "properties": {
        "video_edit.clip.code_parameters": {
          "chapter": "04",
          "title": "让每一步都可校正",
          "speed": 0.8
        }
      }
    }
  ]
}
```

## 四：数据卡数字滚动

示例数据从 0 滚动到目标，不暗示实际业务增长。数字是唯一主焦点，单位和说明次之；细进度线与数字共用缓动，终值停留可读。

<!-- skill-example: rolling-data -->
```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
export default {
  name: "数字数据卡", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 4,
  params: [
    { key: "value", type: "number", title: "展示数值", default: 1280, min: 0, max: 1000000, step: 1 },
    { key: "label", type: "text", title: "数据说明", default: "完成作品", maxLength: 60, layer: "data-card" },
    { key: "unit", type: "text", title: "单位", default: "件", maxLength: 12, layer: "data-card" }
  ],
  layers(params) {
    const digits = { fontFamily: "monospace", fontWeight: 600, align: "left" as const, fill: { color: "#f0f5f2" } }
    // 字号按终值定一次，滚动途中位数变化不改字号。
    const finalNumber = layoutText(String(params.value), { ...digits, fontSize: 132 }, { maxWidth: 712, fit: { minFontSize: 64 } })
    const size = finalNumber.style.fontSize
    const label = layoutText(params.label, { fontSize: 40, align: "left", fill: { color: "#9eb0b3" } }, { maxWidth: 712, maxLines: 2, fit: { minFontSize: 28 } })
    const unit = layoutText(params.unit, { fontSize: 32, align: "left", fill: { color: "#8ac2b0" } }, { maxWidth: 712 })
    return [{ id: "data-card", bounds: [540, 280, 1380, 800], draw(ctx, time) {
      const p = expoOut(clamp01((time - .2) / 1.3))
      const number = p >= 1 ? finalNumber : layoutText(String(Math.round(params.value * p)), { ...digits, fontSize: size })
      ctx.fillStyle = "#0b0e11"; ctx.strokeStyle = "rgba(166, 179, 179, .18)"; ctx.lineWidth = 1
      ctx.beginPath(); ctx.roundRect(540, 280, 840, 520, 20); ctx.fill(); ctx.stroke()
      for (const [text, centerY] of [[label, 370], [number, 536], [unit, 650]] as const) {
        ctx.save(); ctx.translate(604, centerY - text.box.height / 2); drawText(ctx, text); ctx.restore()
      }
      ctx.strokeStyle = "#8ac2b0"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(604, 726); ctx.lineTo(604 + 712 * p, 726); ctx.stroke()
    } }]
  }
}
```

插入调用：

```json
{
  "summary": "插入数字数据卡",
  "changes": [
    {
      "kind": "create_items",
      "entityType": "video_edit.clip",
      "parent": {
        "kind": "video_edit.sequence",
        "id": "实际序列引用id"
      },
      "items": [
        {
          "properties": {
            "video_edit.clip.item_id": "返回素材项id的子id",
            "video_edit.clip.kind": "code",
            "video_edit.clip.name": "数字数据卡",
            "video_edit.clip.start": 120,
            "video_edit.clip.track": 2,
            "video_edit.clip.duration": 120,
            "video_edit.clip.code_parameters": {
              "value": 1280,
              "label": "完成作品",
              "unit": "件"
            }
          }
        }
      ]
    }
  ]
}
```

调参调用：

```json
{
  "summary": "调整数字数据卡",
  "changes": [
    {
      "kind": "set_properties",
      "entityType": "video_edit.clip",
      "target": {
        "kind": "video_edit.clip",
        "id": "返回片段引用id"
      },
      "properties": {
        "video_edit.clip.code_parameters": {
          "value": 860,
          "label": "示例交付数量",
          "unit": "份"
        }
      }
    }
  ]
}
```

检查每例进场、停留、退出及片段接缝；极光另外看两处时间的流动，数字卡确认终值与用户原数据一致。用 observe_video_edit_frame 的 program 目标，再 read_application_media(mode="image") 读取像素。样例自动测试只验证模块可加载、参数可解析，不替代真实画面审查。
