# v3 参数实例与关键帧

## 在源码里声明参数

v3 参数声明的全部类型、通用字段（group/advanced/visibleWhen/tooltip）、取用函数和自定义组件类型见 [参数类型与自定义组件类型](parameter-types.md)。开放哪些参数见 [参数化与组件化](parametric.md)。非法键、未知字段或类型会拒绝整次写入，不静默丢弃。

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
  - `interpolation`：可插值类型（number、angle、color、point、range、grade 及含这些字段的组件）可用 `"linear"` `"ease"` `"hold"`；其他类型只能 `"hold"`，详见参数类型说明。
- 只有声明了 `animatable: true` 的参数能打关键帧；同一参数同一时刻不能有两个点，整份 id 也不能重复。曲线不设点数上限。动态素材的关键帧不能晚于 `durationSeconds`。删除某参数的曲线时从字典移除该键，不写空数组。
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
