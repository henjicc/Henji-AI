# v3 参数与关键帧

## 在源码里声明参数

`parameters` 是 `键名: 声明` 的静态对象，最多 32 项。键名以字母开头，只含字母、数字、下划线，最多 64 字符且不能使用原型/构造器等保留名称。每项必须有 `type`、`title`（≤80 UTF-16 单元）和 `default`；`description` 可选（≤1000）；`animatable: true` 才能打关键帧（默认 false）。

| type | 额外字段 | default |
| --- | --- | --- |
| number | `min` `max` `step`（>0），`unit` 可选 | 范围内数值 |
| color | 无 | `[r,g,b,a]`，各 0–1 |
| boolean | 无 | true / false |
| choice | `options` 1–32 项不重复 | options 之一 |
| text | `maxLength` 1–4096 | 不超长文本 |
| image | 仅生成器；不可动画 | `null` |

number 的 min≤max，min/max/step 绝对值≤1e9，unit≤32 字；step 是面板步长，不自动量化写入值。choice 选项文本≤128 字且不重复；text.maxLength 计 UTF-16 单元。非法键、未知字段或类型拒绝整次写入，不静默丢弃。

v3 沿用这六种参数，没有 font、向量或元素覆盖参数。字体可用 text/choice 字符串传给 text.fontFamily；先查 font 实体，不能声明 type:"font"。滤镜不能读取 text/choice，也不能声明 image。

## 图片参数就地生成

实例图片值只接受 `{"kind":"image","mediaId":"真实媒体id"}` 或 null；不能写文件路径、URL、asset 引用或 generation.result 引用。空图片参数不绘制。助手沿现有能力完成：

1. 读取片段参数及固定源码，确认 image 键、目标剪辑/序列和所需画幅。按用户授权使用通用生成能力准备/提交图片并等待完成；先发现生成工具与模型契约，不猜模型字段。收到标注不等于获得付费许可。
2. 用 `place_video_edit_creative_result` 将已完成结果放入素材面板，placement 为 `{"mode":"library"}`，result 为 `{"type":"generation","resultRef":真实生成结果引用,"outputIndex":0}`，同时提供 documentRef/sequenceRef。不额外插入时间线片段。
3. 回读返回的 video_edit.item 引用，取 `video_edit.item.media_id`；这是本剪辑真正可绑定的 mediaId。
4. 重新读目标片段与 code_parameters，确认生成期间版本/参数没有被用户改掉，合并后写回对应 image 键。用户已换图时不自动覆盖，保留完成图片供确认；失败只重试放置/绑定，不再次付费生成。
5. 回读参数并取帧读图。源图存在不等于画面已绑定成功；此链沿正式生成历史、剪辑素材与撤销路径，产物可以继续流入其他工作区。

## 改实例参数

参数值属于片段实例，不改源码，也不重新编译：

- 生成器片段：`video_edit.clip.code_parameters`
- 滤镜效果：`video_edit.effect.parameters`；另有 `video_edit.effect.amount`、`video_edit.effect.enabled`

写入值是整份字典，漏掉的键回到默认值。先用 `read_application_entity` 读现值，合并后写回。值必须符合声明的类型和范围，否则整次修改被拒绝、剪辑不变。

## 关键帧

- 生成器片段：`video_edit.clip.code_curves`；滤镜效果：`video_edit.effect.curves`。
- 格式：`{ 键名: [ { id, sourceInUs, sourceRemainder, value, interpolation } ] }`。
  - `id` 在整份曲线内唯一的短文本，例如 `"title-in"`。
  - `sourceInUs` 是源时间的整数微秒；`sourceRemainder` 是不足一微秒的余数，整数微秒时写 `{"numerator":0,"denominator":1}`。
  - `interpolation`：number 和 color 可用 `"linear"` `"ease"` `"hold"`；其他类型只能 `"hold"`。
- 只有声明了 `animatable: true` 的参数能打关键帧；同一参数同一时刻不能有两个点，整份 id 也不能重复。曲线不设点数上限；源码声明仍有 32 个参数的单份求值保护。动态素材的关键帧不能晚于 `durationSeconds`。删除某参数的曲线时从字典移除该键，不写空数组。
- 第一个点之前保持第一个值，最后一个点之后保持最后一个值。
- 曲线也是整份字典写入，先读后合并。

### 时间换算

关键帧按源时间计时，和 `ctx.time` 一致。片段在序列第 F 帧时的源时间：

源微秒 = `video_edit.clip.source_in_us` + (F − `video_edit.clip.start`) ÷ fps × 1000000

fps = `video_edit.sequence.frame_rate` 的 numerator ÷ denominator。新插入的代码片段 `video_edit.clip.source_in_us` 通常是 0。29.97 等非整数帧率算出非整数微秒时，整数部分写 `sourceInUs`，余数用分数写进 `sourceRemainder`；或者把关键帧放在整数微秒处。

## 换源码版本

源码版本不可原地改写。要改已经在用的源码：

1. 在剪辑下 `create_items`，`entityType` 为 `video_edit.code_version`，属性 `video_edit.code_version.source`（新源码）和 `video_edit.code_version.definition_id`（`video_edit.code_material` 引用 id 冒号后的部分）。应用会检查并试渲染；与已有版本完全相同的源码会被拒绝。
2. 拿到新版本返回的引用后，另一次事务把 `video_edit.clip.code_version_id`（或 `video_edit.effect.version_id`）设为该引用 id 冒号后的版本部分，并一起写入符合新声明的参数和关键帧。新版本不会自动替换实例；先列举/检查同定义调用方，只替换本次授权的实例。

元素 id/sourceSpan 仅定位源码，没有可写元素覆盖层。若目标关联已有公开参数，优先改参数；否则新增源码版本，不编造 element.* 属性。
