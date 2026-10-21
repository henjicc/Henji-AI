# 风格词典

> 何时读：用户描述了一种风格（电影感、日系、胶片、赛博朋克……）或要几个候选时读。

配方是全能调色参数的增量起点，不含白平衡和曝光。用法：读现有参数 → 按强度 k（0–1）把每个数值从中性值缩放（`中性 + (配方值 − 中性) × k`，色轮色相角不缩放）→ 合并写入 → 用 observe 读数与画面核对。混色器、色轮键名与参数 schema 一致。

| 风格 | 关键词 | 效果 |
|---|---|---|
| 青橙电影（teal_orange） | 电影感、青橙、teal orange、大片 | 阴影偏青、高光与肤色偏橙，轻微加对比；人物在冷背景中跳出来。 |
| 胶片褪色（film_fade） | 胶片、复古、film、vintage | 抬起黑位、压低反差与饱和度，暗部带一点暖绿。 |
| 日系清新（japanese_airy） | 日系、清新、通透、airy | 高亮低反差，青绿色调，肤色干净；适合白天人像与静物。 |
| 赛博霓虹（cyberpunk） | 赛博朋克、霓虹、cyberpunk、夜景 | 暗部偏蓝紫、高光偏洋红，高饱和高对比。 |
| 暖调黄金时刻（warm_golden） | 暖调、黄昏、金色、golden hour | 整体暖金，中间调偏橙，高光柔和。 |
| 冷调阴郁（cool_moody） | 冷调、阴郁、低饱和、moody | 冷蓝、低饱和、压暗高光，适合雨天与情绪片。 |
| 黑白高反差（bw_contrast） | 黑白、单色、bw、monochrome | 去色并加对比，用混色器明度控制各颜色转灰后的亮暗。 |
| 干净商业（clean_commercial） | 商业、干净、产品、clean | 轻提对比和自然饱和度，压一点高光，颜色准确不夸张。 |
| 留银（bleach_bypass） | 留银、高反差低饱和、bleach bypass | 高对比、低饱和、金属质感的冷硬画面。 |

## 配方

### 青橙电影

```json
{"id":"teal_orange","params":{"contrast":15,"shadow_hue":195,"shadow_strength":18,"highlight_hue":35,"highlight_strength":14,"grade_balance":-10,"mixer_orange_saturation":10,"mixer_blue_hue":-20,"mixer_aqua_hue":25,"vibrance":10}}
```

### 胶片褪色

```json
{"id":"film_fade","params":{"faded_film":30,"contrast":-10,"saturation":-15,"tone_shadows":15,"shadow_hue":80,"shadow_strength":8,"highlight_hue":40,"highlight_strength":6}}
```

### 日系清新

```json
{"id":"japanese_airy","params":{"contrast":-15,"highlights":-10,"shadows":25,"tone_lights":10,"saturation":-10,"vibrance":10,"midtone_hue":175,"midtone_strength":6,"mixer_green_hue":25,"mixer_orange_luminance":15}}
```

### 赛博霓虹

```json
{"id":"cyberpunk","params":{"contrast":25,"saturation":20,"shadow_hue":250,"shadow_strength":22,"highlight_hue":310,"highlight_strength":18,"mixer_blue_saturation":25,"mixer_magenta_saturation":25,"blacks":-15}}
```

### 暖调黄金时刻

```json
{"id":"warm_golden","params":{"global_hue":40,"global_strength":8,"midtone_hue":30,"midtone_strength":10,"highlights":-15,"vibrance":15,"mixer_yellow_saturation":15}}
```

### 冷调阴郁

```json
{"id":"cool_moody","params":{"contrast":10,"highlights":-25,"saturation":-25,"global_hue":215,"global_strength":8,"shadow_hue":210,"shadow_strength":12,"mixer_orange_saturation":-10}}
```

### 黑白高反差

```json
{"id":"bw_contrast","params":{"saturation":-100,"contrast":30,"whites":10,"blacks":-15,"mixer_red_luminance":10,"mixer_blue_luminance":-20}}
```

### 干净商业

```json
{"id":"clean_commercial","params":{"contrast":10,"highlights":-10,"whites":5,"blacks":-5,"vibrance":15}}
```

### 留银

```json
{"id":"bleach_bypass","params":{"contrast":35,"saturation":-45,"tone_highlights":10,"tone_shadows":-10,"blacks":-10}}
```
