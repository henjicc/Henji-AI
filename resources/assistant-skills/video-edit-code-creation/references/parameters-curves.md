# 参数与关键帧

## 在源码里声明参数

`parameters` 是 `键名: 声明` 的静态对象，最多 32 项。键名以字母开头，只含字母、数字、下划线。每项必须有 `type`、`title`（≤80 字）和 `default`；`description` 可选；`animatable: true` 才能打关键帧（默认 false）。

| type | 额外字段 | default |
| --- | --- | --- |
| number | `min` `max` `step`（>0），`unit` 可选 | 范围内数值 |
| color | 无 | `[r,g,b,a]`，各 0–1 |
| boolean | 无 | true / false |
| choice | `options` 1–32 项不重复 | options 之一 |
| text | `maxLength` 1–4096 | 不超长文本 |
| image | 仅生成器；不可动画 | `null` |

滤镜里不能读取 text 或 choice 参数，也不能声明 image 参数。

## 改实例参数

参数值属于片段实例，不改源码，也不重新编译：

- 生成器片段：`video_edit.clip.code_parameters`
- 滤镜效果：`video_edit.effect.parameters`；另有 `video_edit.effect.amount`、`video_edit.effect.enabled`

写入值是整份字典，漏掉的键回到默认值。先用 `read_application_entity` 读现值，合并后写回。值必须符合声明的类型和范围，否则整次修改被拒绝、工程不变。

## 关键帧

- 生成器片段：`video_edit.clip.code_curves`；滤镜效果：`video_edit.effect.curves`。
- 格式：`{ 键名: [ { id, sourceInUs, sourceRemainder, value, interpolation } ] }`。
  - `id` 在整份曲线内唯一的短文本，例如 `"title-in"`。
  - `sourceInUs` 是源时间的整数微秒；`sourceRemainder` 是不足一微秒的余数，整数微秒时写 `{"numerator":0,"denominator":1}`。
  - `interpolation`：number 和 color 可用 `"linear"` `"ease"` `"hold"`；其他类型只能 `"hold"`。
- 只有声明了 `animatable: true` 的参数能打关键帧；同一参数同一时刻不能有两个点；单个参数最多 256 点，整份最多 32 个参数、2048 点。动态素材的关键帧不能晚于 `durationSeconds`。
- 第一个点之前保持第一个值，最后一个点之后保持最后一个值。
- 曲线也是整份字典写入，先读后合并。

### 时间换算

关键帧按源时间计时，和 `ctx.time` 一致。片段在序列第 F 帧时的源时间：

源微秒 = `video_edit.clip.source_in_us` + (F − `video_edit.clip.start`) ÷ fps × 1000000

fps = `video_edit.sequence.frame_rate` 的 numerator ÷ denominator。新插入的代码片段 `video_edit.clip.source_in_us` 通常是 0。29.97 等非整数帧率算出非整数微秒时，整数部分写 `sourceInUs`，余数用分数写进 `sourceRemainder`；或者把关键帧放在整数微秒处。

## 换源码版本

源码版本不可原地改写。要改已经在用的源码：

1. 在工程下 `create_items`，`entityType` 为 `video_edit.code_version`，属性 `video_edit.code_version.source`（新源码）和 `video_edit.code_version.definition_id`（`video_edit.code_material` 引用 id 冒号后的部分）。应用会检查并试渲染；与已有版本完全相同的源码会被拒绝。
2. 新版本不会自动替换已有片段。在同一次事务里把 `video_edit.clip.code_version_id`（或 `video_edit.effect.version_id`）设为新版本 id，并一起写入符合新声明的参数和关键帧。
