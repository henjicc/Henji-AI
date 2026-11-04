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

`layout.preset` 必填，其余参数都可省略（单位米、角度为度、楼高按层），默认值见能力说明。1 单位 = 1 米，角色约 1.8 米高。
街宽、街区尺寸、层高、楼的体量由城市风格按真实城市取值，不要试图用参数凑：

| preset | 常用参数 |
| --- | --- |
| `city` 城市街区 | `style` grid 方格城市（纽约式 80×260 米街区，默认）/ superblock 国内新城（50 米主干道围出约 400 米超级街区，小区高层加商业裙楼塔楼）/ oldtown 欧式老城（113 米方街区、6 层左右）、`width`/`depth` 范围、`density` 0–1、`floors {min,max}` 楼层、`heightProfile` downtown 中心高 / uniform、`props` 参照物 |
| `street` 街道 | `length`、`road` local 支路 / collector 次干道 / arterial 主干道、`density`、`floors`、`props` |
| `plaza` 广场 | `size` 广场边长、`density`、`floors`、`monument`、`props` |
| `crowd` 人群 | `count`、`formation` grid / scatter / ring、`spacing`（默认 0.9 米）、`facing` forward / center / random |

通用：`center {x,z}`、`rotation`、`seed`。城市中心总落在两条干路的路口上，主角放在原点附近的路口不会和楼相交。

- 参照物（`props`，默认开）：人行道与路缘、车道线与斑马线、行道树、路灯、车辆，按真实尺寸摆好，帮生成模型读出尺度。它们不是对象，点不中、不参与碰撞；要清掉就 `props: false` 重新生成。角色站在人行道上时脚下的铺装只高 4 厘米，不用抬高角色。
- 规模：默认方格城市约 370 栋；`width/depth` 给 1500 约 2400 栋，给 3100 约 1 万栋。新城楼少而高，欧式老城楼多而矮。密度为 0（或太低碰巧一栋没有）时会在写入前被拒绝。
- 场景默认有 90 米的雾，看整座城或长街时先把 `camera_stage.scene.fog_enabled` 关掉或调大 `fog_distance`。
- 改参数重新生成：传 `replaceSetId`（取自观察结果 `sets[].id`），只写要改的字段，其余沿用上一次（包括种子）；换风格又没给楼层时楼层取新风格的默认；换一种随机布局就换 `seed`。
- 整片删除：`change_application_entities` 对 `camera_stage.set` 执行 `remove_items`。新建布景不能用 `create_items`。

## 观察与验证

`observe_camera_stage_scene` 的 `objects` 只列逐个放置的对象；布景只在 `sets` 里给摘要（数量、范围、参数）。需要某栋楼时用 `list_application_entities` 分页列 `camera_stage.object`，或按范围判断，不要整片读回。

相对位置依据观察到的边界盒，不要凭空猜坐标；用户要求复用当前摄像机时不要新建。空间写入后用 `verify_camera_stage_scene` 做结构化验证；没有真读画面时只说结构化结果，不描述没看到的构图或遮挡。

## 动画与运镜

- 状态关键帧动画：同一次 `change_application_entities` 里交替写 `camera_stage.playback.current_time` 与对象或摄像机的 `animatable.*` / `pose_preset`，应用自动建关键帧；最后可同事务写 `loop`、`playing`。不要按时间点拆成多轮。
- 语义运镜（环绕、推拉、平移、升降）用 `apply_camera_stage_camera_move`，轨迹按弧长平滑采样；整理示范机位用 `organize_camera_stage_motion` 再 `apply_camera_stage_motion_candidate`。
