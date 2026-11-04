---
name: 三维镜头构图
description: 在 3D 镜头参考里快速搭城市、街道、广场、人群布景，摆人物和机位定构图，做状态关键帧与运镜时使用。
---

# 3D 镜头参考：快速布景、构图与运镜

镜头参考用来快速摆抽象场景、定构图和人物关系，效率第一，画面次要。

## 铁律

1. 文档 ID 取自宿主上下文或 `list_documents`（kind=camera_stage）；对象、布景、摄像机 id 取自 `observe_camera_stage_scene`，不猜、不按名称定位。
2. **成片布景一次生成**：城市、街道、广场、人群用 `generate_camera_stage_set`，一次调用一个撤销点、一次存盘。不要用 `place_camera_stage_object` 一栋一栋地摆楼。
3. 单个主体（主角、道具、摄像机）用 `place_camera_stage_object`；改已有对象的属性用 `change_application_entities` 的 `set_properties`。
4. 布景成员是普通对象，可以逐个改；要整体换参数就重新生成，不要逐个改几百栋楼。

## 布景生成

`layout.preset` 必填，其余参数都可省略（单位米、角度为度），默认值见能力说明：

| preset | 常用参数 |
| --- | --- |
| `city` 城市街区 | `width`/`depth` 范围、`blockSize` 街区边长、`streetWidth` 街道宽、`lotSize` 地块宽、`density` 0–1、`height {min,max}`、`heightProfile` downtown 中心高 / uniform |
| `street` 街道 | `length`、`streetWidth`、`lotWidth`、`buildingDepth`、`density`、`height` |
| `plaza` 广场 | `size` 空地边长、`lotWidth`、`buildingDepth`、`density`、`height`、`monument` |
| `crowd` 人群 | `count`、`formation` grid / scatter / ring、`spacing`、`facing` forward / center / random |

通用：`center {x,z}`、`rotation`、`seed`。城市中心总落在路口上，主角放在原点附近的街道上不会和楼相交。

- 规模：默认城市约 220 栋；`width/depth` 给 600 约 2000 栋，给 1450 约 1 万栋。城市至少 2×2 个街区。密度为 0（或太低碰巧一栋没有）时会在写入前被拒绝。
- 改参数重新生成：传 `replaceSetId`（取自观察结果 `sets[].id`），只写要改的字段，其余沿用上一次（包括种子）；换一种随机布局就换 `seed`。
- 整片删除：`change_application_entities` 对 `camera_stage.set` 执行 `remove_items`。新建布景不能用 `create_items`。

## 观察与验证

`observe_camera_stage_scene` 的 `objects` 只列逐个放置的对象；布景只在 `sets` 里给摘要（数量、范围、参数）。需要某栋楼时用 `list_application_entities` 分页列 `camera_stage.object`，或按范围判断，不要整片读回。

相对位置依据观察到的边界盒，不要凭空猜坐标；用户要求复用当前摄像机时不要新建。空间写入后用 `verify_camera_stage_scene` 做结构化验证；没有真读画面时只说结构化结果，不描述没看到的构图或遮挡。

## 动画与运镜

- 状态关键帧动画：同一次 `change_application_entities` 里交替写 `camera_stage.playback.current_time` 与对象或摄像机的 `animatable.*` / `pose_preset`，应用自动建关键帧；最后可同事务写 `loop`、`playing`。不要按时间点拆成多轮。
- 语义运镜（环绕、推拉、平移、升降）用 `apply_camera_stage_camera_move`，轨迹按弧长平滑采样；整理示范机位用 `organize_camera_stage_motion` 再 `apply_camera_stage_motion_candidate`。
