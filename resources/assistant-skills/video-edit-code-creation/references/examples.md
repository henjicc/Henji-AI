# 四个可编译的 v3 创作样例

用于理解接口与设计关系，不原样套用到用户作品。色彩是作者画面数据；按品牌重设。先查序列规格和轨道，以下插入按 30fps、start=120、track=2 演示，实际必须换算。所有占位引用换为上下文/工具返回的真实值，外部 MCP 写入另带正式 operationId 信封。

每份源码先用 change_application_entities 提交到当前 document，结构如下（SOURCE 是对应下方完整源码字符串，用 JSON 编码，不能提交字面占位）：

```text
{summary:"创建代码素材",changes:[{kind:"create_items",
  entityType:"video_edit.code_material",parent:documentRef,
  items:[{properties:{"video_edit.code_material.name":素材名,
    "video_edit.code_material.source":SOURCE}}]}]}
```

拿到级联新建的 video_edit.item 后，再调用每例插入 JSON。调参 JSON 是插入后的另一次调用，先回读整份参数，合并再写；示意字典覆盖本例全部参数。重新选择字体时用实际 font 查询值替换默认通用家族。

## 一：克制的自适应标题条

把片名放在左下安全框，窄色线提供识别，底板只承载文字。0.6 秒进场、足够停留、最后 0.4 秒退出；换字后量字驱动宽度。

<!-- skill-example: lower-third -->
```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "克制标题条",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 4, seed: 42,
  parameters: {
    title: {type: "text", title: "标题", default: "第一章 出发", maxLength: 80},
    accent: {type: "color", title: "强调色", default: [.43,.7,.63,1], animatable: true},
    font: {type: "text", title: "字体家族", default: "sans-serif", maxLength: 200}
  },
  render(ctx) {
    const box = measureText({text: ctx.params.title, fontFamily: ctx.params.font,
      fontSize: 64, fontWeight: 600, maxWidth: 920, maxLines: 1, wrap: false});
    const enter = expoOut(progress(ctx.time, 0, .6));
    const leave = progress(ctx.time, 3.6, .4);
    return [group({id: "title-bar", x: mix(-1080, 120, enter), y: 830,
      opacity: enter * (1 - leave)}, [
      rect({id: "plate", x: 0, y: 0, width: box.width + 88, height: 132,
        radius: 12, fill: [.035,.045,.055,.94]}),
      rect({id: "accent", x: 0, y: 24, width: 4, height: 84, fill: ctx.params.accent}),
      text({id: "title", x: 44, y: 66, text: ctx.params.title,
        fontFamily: ctx.params.font, fontSize: 64, fontWeight: 600,
        maxWidth: 920, maxLines: 1, wrap: false, color: [.94,.96,.95,1]})
    ])];
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

花字只强调一句短语。竖向 48px 错峰进场，冷色渐变描边、轻辉光与深底构成层次，避免每个字同时跳动。

<!-- skill-example: stagger-title -->
```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "错峰花字",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 4, seed: 42,
  parameters: {
    title: {type: "text", title: "强调短语", default: "灵感正在发生", maxLength: 32},
    glowPower: {type: "number", title: "辉光强度", default: .65, min: 0, max: 2, step: .05}
  },
  render(ctx) {
    const ink = linearGradient({x1: 0, y1: 0, x2: 1100, y2: 0,
      stops: [[0,[.52,.86,.92,1]],[1,[.74,.64,.93,1]]]});
    const edge = linearGradient({x1: 0, y1: 0, x2: 1100, y2: 0,
      stops: [[0,[.88,.97,1,1]],[1,[.63,.69,.9,1]]]});
    return [
      rect({id: "background", x: 0, y: 0, width: ctx.width, height: ctx.height,
        fill: [.025,.03,.055,1]}),
      text({id: "headline", x: 960, y: 540, text: ctx.params.title,
        fontSize: 112, fontWeight: 800, align: "center", maxWidth: 1600,
        maxLines: 1, wrap: false, fill: ink, stroke: edge, strokeWidth: 2,
        glow: {radius: 16, intensity: ctx.params.glowPower, color: [.35,.65,.9,1]},
        perChar: (i,n) => ({
          y: tween(ctx.time, stagger(i,.045), .55, 48, 0, "expoOut"),
          opacity: progress(ctx.time, stagger(i,.045), .28) * (1-progress(ctx.time,3.6,.4)),
          scale: 1, rotation: 0
        })})
    ];
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

背景缓慢流动，前景保持稳定阅读。深色极光与细边卡片分层，以章节号、小标签和一句大标题建立信息顺序；卡片整体淡入，不让装饰抢戏。

<!-- skill-example: aurora-chapter -->
```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "极光章节卡",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 5, seed: 42,
  parameters: {
    chapter: {type: "text", title: "章节编号", default: "03", maxLength: 8},
    title: {type: "text", title: "章节标题", default: "把想法变成画面", maxLength: 80},
    speed: {type: "number", title: "背景流速", default: .35, min: 0, max: 2, step: .05}
  },
  render(ctx) {
    const p = expoOut(progress(ctx.time, .15, .7));
    return [
      shader({id: "aurora", name: "aurora", time: ctx.time,
        params: {speed: ctx.params.speed, scale: 28, strength: 100,
          color_a: [.025,.045,.08,1], color_b: [.1,.32,.3,1]},
        x: 0, y: 0, width: ctx.width, height: ctx.height}),
      group({id: "chapter-card", x: 300, y: mix(360,320,p),
        opacity: p * (1-progress(ctx.time,4.5,.5))}, [
        rect({id: "plate", x: 0, y: 0, width: 1320, height: 440,
          radius: 20, fill: [.025,.045,.06,.88],
          stroke: [.47,.64,.63,.32], strokeWidth: 1}),
        text({id: "label", x: 72, y: 82, text: "CHAPTER",
          fontSize: 30, letterSpacing: 3, color: [.55,.75,.72,1]}),
        text({id: "chapter-number", x: 288, y: 82, text: ctx.params.chapter,
          fontSize: 30, color: [.55,.75,.72,1]}),
        text({id: "chapter-title", x: 72, y: 226, text: ctx.params.title,
          fontSize: 88, fontWeight: 600, maxWidth: 1176, maxLines: 2,
          lineHeight: 1.15, color: [.94,.96,.94,1]}),
        line({id: "rule", x1: 72, y1: 360, x2: 1248, y2: 360,
          width: 1, color: [.55,.75,.72,.35], trimEnd: p})
      ])
    ];
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
              "speed": 0.35
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
          "speed": 0.2
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
export default {
  apiVersion: 1, languageVersion: 3, name: "数字数据卡",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 4, seed: 42,
  parameters: {
    value: {type: "number", title: "展示数值", default: 1280, min: 0, max: 1000000, step: 1},
    label: {type: "text", title: "数据说明", default: "完成作品", maxLength: 60},
    unit: {type: "text", title: "单位", default: "件", maxLength: 12}
  },
  render(ctx) {
    const p = expoOut(progress(ctx.time, .2, 1.3));
    const number = round(ctx.params.value * p);
    const digits = chars("0123456789");
    const places = [1000000,100000,10000,1000,100,10,1];
    return [group({id: "data-card", x: 540, y: 280}, [
      rect({id: "plate", x: 0, y: 0, width: 840, height: 520, radius: 20,
        fill: [.045,.055,.065,1], stroke: [.65,.7,.7,.18], strokeWidth: 1}),
      text({id: "label", x: 64, y: 90, text: ctx.params.label,
        fontSize: 40, maxWidth: 712, maxLines: 1, color: [.62,.69,.7,1]}),
      repeat(7, i => text({id: "digit", x: 64 + i * 92, y: 256,
        text: digits[floor(number / places[i]) % 10],
        opacity: number >= places[i] || i === 6 ? 1 : 0,
        fontFamily: "monospace", fontSize: 132, fontWeight: 600,
        color: [.94,.96,.95,1]})),
      text({id: "unit", x: 64, y: 370, text: ctx.params.unit,
        fontSize: 32, color: [.54,.76,.69,1]}),
      line({id: "progress", x1: 64, y1: 446, x2: 776, y2: 446,
        width: 3, color: [.54,.76,.69,1], trimEnd: p})
    ])];
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

检查每例进场、停留、退出及片段接缝；极光另外看两处时间的流动，数字卡确认终值与用户原数据一致。用 observe_video_edit_frame 的 program 目标，再 read_application_media 读取像素。样例自动测试编译及多个时间点求值，不替代真实画面审查。
