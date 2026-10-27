# 一支片子一个代码工程

一支片子的全部代码是**一个软件工程**：项目的 `代码/` 文件夹就是它的源码树（内置 Git 仓库）。时间线上的每个代码素材只是指向其中一个**入口文件**、钉在某次**提交**上；片段之间不各自复制引擎、画法或配色。动笔前先想全局结构，写的时候就拆开。

## 目录结构

```text
代码/
  project.json                工程清单：画幅、帧率、用了哪个风格及其来源版本
  README.md                   这支片子的结构与约定，先读它；结构变了就更新
  style/<style>/              风格层：换一支片子也能原样用
    tokens.ts                 颜色、字体与字重、字号阶梯、线宽、缓动、时长档
    strokes/*.ts              基本笔触：点阵字、定位角、点线、颗粒……
    parts/*.ts                台面上的组件：节点标签、数据卡、品牌标签……
    shaders/*.wgsl            WGSL 源码单独成文件，用 import 当文本读入
    desk.ts  window.ts        GPU 模块（WebGPU 台面、录屏窗口）
    scene/*.ts                场景引擎：镜头、对焦、内容区域、三层模块、片段编排
  film/<film>/                片子层：这支片子独有、各段共用，只放数据
    spec.ts                   画幅、安全框、字幕区
    brands.ts                 品牌色与图标参数
    recordings.ts             录屏素材 ID 与画面比例
    tracks/r01.ts …           录屏界面元素位置轨（工具生成，不手改）
    segments/01-opening.ts …  每段一份场景描述：窗口、对焦、组件、出现时间（段内时间）
    film.ts                   把各段按全片时间编排成一份完整描述，全片镜头路线也在这里
  entries/                    时间线上的代码素材，一个文件就是一个素材
    shared/background.ts      全片一个台面，一镜到底
    01-opening/window.ts      本段录屏窗口（同一入口可放多个片段，用参数区分窗口）
    01-opening/overlay.ts     本段标注
  tools/                      只在制作时运行的脚本（生成位置轨、安全框检查），不被入口导入
  archive/                    想留着看的旧版与试验，不被任何入口导入
  legacy/                     软件维护的旧式素材与组件副本，不要手改
```

`<style>`、`<film>` 用简短的英文名（如 `dot-matrix`、`yuanbao`）。规模小的片子可以少几个文件，但三层与 entries 的划分不能省。

## 命名

- 路径一律小写英文、数字和连字符（`node-label.ts`、`01-opening/`）；段落目录带两位序号，按片中顺序排。
- 变量与函数 camelCase，常量 UPPER_SNAKE，场景描述里的键用英文（`wins`、`focus`、`at`）。
- 中文写在注释、素材名、片段名和参数标题里——给人看的地方用中文，给机器解析的地方用英文，导入、Git 和检索都不会被转义。

## 分层与依赖方向

| 层 | 可以导入 | 不允许 |
| --- | --- | --- |
| `style/<style>/` | 同一风格目录内的文件 | 任何片子数据、`film/`、`entries/` |
| `film/<film>/` | 本片目录、所用风格的 `tokens.ts` 与类型 | 画法代码；导入 `entries/` |
| `entries/` | `film/`、`style/` | 写逻辑；入口之间互相导入 |
| `tools/`、`archive/` | 随意 | 被入口导入 |

- **入口只做拼装**，三到十行：选模块工厂、传场景描述和参数，`export default`。名称、参数声明由风格层的模块工厂给出。
- **片子层只放数据**：时间、位置、文字、颜色引用、位置轨。看得出“画什么”，看不出“怎么画”。
- **风格层不认识任何片子**：场景描述一律作为参数传进去，模块顶层不放“当前场景”之类全局变量；同一个文件会被多个素材同时加载。
- 同样的代码出现第二次就提到上层；改风格只动 `style/`，改某段只动这段的描述。做不到说明拆分不对，先重新拆。
- 每个文件职责单一、单独读得懂，一般几十到两三百行；64KiB 是单文件上限，不是目标。只有一次性、约 100 行以内、别处不会再用的小效果可以直接放在一个入口里。

## 一镜到底

全片背景只放**一个**台面片段（`entries/shared/background.ts`），读 `film/<film>/film.ts` 编排好的全片描述和镜头路线，段与段之间的背景天然连续。各段在 `segments/` 里用段内时间写自己的窗口、对焦与组件，`film.ts` 给每段一个开始时间，由风格层的片段编排函数换算成全片时间。录屏窗口与标注按段各放片段，参数 `offset` 填这个片段开头对应的段内时刻。

## 生成的数据

位置轨这类由工具从录屏重演数据生成的文件放 `film/<film>/tracks/`，文件开头注明来源与生成方式（`// 由 tools/tracks.ts 从 r01 重演的 boxes 生成，不手改`）。要改就改工具重新生成。

## 版本、提交与升级

- 每次修改工程文件就是一次提交，事务的 summary 就是提交信息，写成能检索的一句话：“风格：数据卡数字改成点阵显影”“开场：高亮跟随节点卡片”。
- 片段钉在某次提交上，别处改动不会让已有画面悄悄变化。改了风格或片子数据后，用升级操作把受影响的素材升级到最新提交，回执会列出改了哪些文件、改指了多少片段；只想改一段时只升级那一段的素材。
- 用户在外部编辑器里改过文件时，先读工程的未提交改动，确认后提交为一个版本再使用。
- 用户也会在剪辑的「代码」面板里看工程树、直接改文件提交，提交进同一份历史；接手前先读 `log`，别覆盖用户刚提交的改动。
- 不要自己建 `v2`、`final`、`new` 之类的文件夹或文件名做版本，历史全在 Git 里；想保留一份旧做法给人看，放进 `archive/` 并在 README 里写一句为什么。

## 怎么读改（通用实体）

| 要做的事 | 写法 |
| --- | --- |
| 看工程 | `read_application_entity` 读 `video_edit.code_project`（引用 id 为剪辑文档 id）：`head`、`log`（最近 20 次提交）、`tree`、`changes`（外部编辑器里未提交的改动） |
| 读文件、看谁在用 | 读 `video_edit.code_project_file`，引用 id 为 `<剪辑文档id>:<工程相对路径>`：`source`、`bytes`、`video_edit.code_project_file.used_by`（默认版本用到它的代码素材） |
| 新建 / 删除文件 | 在剪辑文档下 `create_items` / `remove_items`，实体 `video_edit.code_project_file`，属性 `path`、`source` |
| 改文件、改名 | `set_properties` 写 `video_edit.code_project_file.source` 或 `.path`（改名不会自动改 import，要一起改引用它的文件） |
| 用入口建素材 | `create_items` 实体 `video_edit.code_material`，属性 `name` 与 `video_edit.code_material.project_entry`（如 `entries/01-opening/window.ts`），不给 files/source；用当前 HEAD 解析入口的依赖闭包 |
| 升级素材 | `upgrade_video_edit_code_materials({ documentRef, materialRefs?, commit? })`：闭包变了的素材建新版本、改指正在用旧版本的片段；默认全部工程型素材、HEAD。只想要某个素材的新版本也可 `create_items` `video_edit.code_version`（`video_edit.code_version.definition_id` + 可选 `video_edit.code_version.project_commit`） |
| 提交外部改动 | `commit_video_edit_code_project({ documentRef, message })` |

一次 `change_application_entities` 里对工程文件的全部改动只产生一次提交，`summary` 就是提交信息；用回执的 `undoRef` 撤销会追加一次恢复提交，不改写历史。同一事务里先写文件、再用入口建素材即可拿到新 HEAD。写入前发现同一文件有未提交的外部改动会拒绝并点名文件：先读 `changes`，和用户确认后提交，再继续。

## 开工与接手清单

1. 读 `README.md`、`project.json`，列工程树，看 `film/<film>/film.ts` 里已经有哪些段。
2. 新片子：先建目录骨架和 README；风格层从风格包或已有片子的 `style/<style>/` 原样拷入，在 `project.json` 记下来源与版本，之后在本片里的改进做完可回推风格包。
3. 新加一段：写 `film/<film>/segments/NN-名字.ts` → 在 `film.ts` 编排进去 → 建 `entries/NN-名字/` 的入口 → 摆片段 → 取帧自检。
4. 交付前回读：入口是否都只做拼装；有没有重复代码；README 是否还准确。

## 反例

- 每个素材一个文件夹、每个文件夹里一份引擎和配色表。
- 段落描述里写 `ctx.fillRect`，或风格文件里写死某支片子的时间与文字。
- 入口里写判断与绘制逻辑；用全局 `SCENE` 在模块之间传数据。
- 用中文、空格或特殊符号做路径；用文件名或文件夹记版本。
