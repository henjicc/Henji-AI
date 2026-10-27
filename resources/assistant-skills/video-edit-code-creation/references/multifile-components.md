# 多文件与项目组件库

整支片子的代码组织（目录结构、分层与依赖方向、命名、一镜到底、版本与升级）见 [一支片子一个代码工程](code-project.md)，必须遵守。本篇只讲多文件的语法规则、旧式单素材文件集合与项目组件。

文件个数不设上限；单文件 64KiB，全部文件共享编译预算。

## 怎么提交

创建素材时用 `video_edit.code_material.files`（`{路径: 源码}`）加 `video_edit.code_material.entry`（入口路径，默认 main.ts），代替单文件的 source；两者二选一。新版本同理用 `video_edit.code_version.files` / `video_edit.code_version.entry`。

```json
{
  "main.ts": "import { card } from './parts/card'\nimport { palette } from './palette'\nexport default { ...入口声明..., layers(params, width, height) { return [card(width, palette.accent)] } }",
  "parts/card.ts": "export const card = (width, accent) => ({ id: 'card', bounds: [0, 0, width * .3, 120], draw(ctx) { ctx.fillStyle = accent; ctx.fillRect(0, 0, width * .3, 120) } })",
  "palette.ts": "export const palette = { accent: '#e66633' }"
}
```

- 路径用 `/` 分隔的相对路径，扩展名 .ts，不能越出根目录。
- 只有入口文件写 `export default`；其他文件是普通 ES 模块，用具名导出。模块顶层不要依赖时间或累积状态，保证同一帧结果确定。
- 导入写在文件顶部：`import { a, b as c } from "./相对路径"`，只支持具名导入，不写扩展名。缺失文件、缺失导出和循环导入会被拒绝，报错里带文件名和行号。
- 入口的 parameters、types、shaders 可以直接引用模块导出的静态对象，方便把一大段声明或 WGSL 字符串单独放一个文件。

## 存在哪里

项目的 `代码/` 本身是内置 Git 仓库，主进程使用纯 JavaScript 的 isomorphic-git，不要求用户安装 Git。工作区是一份软件工程，只放各模块的最新文件：

```text
代码/
  .git/                    # 提交、对象和版本标签
  组件/<组件名>/main.ts      # 全片共享模块
  素材/<素材名>/main.ts      # 本素材入口
  素材/<素材名>/parts/...    # 本素材的模块，保留原相对目录
```

每次创建素材版本或发布组件版本都会创建提交，并用 `素材/<名字>@vN`、`组件/<名字>@vN` 标签标出版本；标签中的空格等 Git 禁用字符会转义。用户可以用 VS Code 打开整个 `代码/` 工程；安装了 Git 时也可直接查看 `git log`。不要自行创建 `vN` 文件夹或用命令改写标签、历史。

文档固定引用 Git 提交中的文件，并保存内容 SHA-256。修改、删除工作区文件不会改变已有素材画面；工作区有未提交修改时，新版本写入会拒绝，提示先备份并处理修改。修改源码仍通过 `video_edit.code_material.files` / `video_edit.code_version.files` 创建新版本，组件仍通过原 `video_edit.code_component` 入口发布，见 [参数与曲线](parameters-curves.md) 的“换源码版本”。Git 历史损坏、缺失或内容校验失败会明确报错，不回退到工作区源码。

移动、复制、收集素材及导出包会带走所需 Git 历史；目标重建仓库时提交编号可以变化，但版本号与源码 SHA-256 保持一致。整项目包保留仓库历史；资产库使用自带源码的可编辑代码资产，导入目标项目时再创建本项目版本。

已有 `代码/<素材名>/vN/...`、`代码/组件库/<组件名>/vN.ts` 继续只读兼容，不因打开工程自动搬迁。用户要求整理旧工程时，先用 `list_projects` 取得项目，再调用 `migrate_project_code_storage({ "projectId": "实际项目id" })`。它先保存打开的文档、备份原件，按版本顺序导入 Git，保存并读回校验新引用后，才将不再使用的旧目录移入项目 `.henji/backups/`。失败可以用相同参数重跑；仍被其他文档引用或含未知文件的旧目录会保留，回执中报告数量。迁移会重新载入打开的文档并重置其编辑撤销记录；不要手工删除旧目录或备份。

## 项目组件库

同一项目里多条素材、多个剪辑都会用到的部件（人名条、角标、品牌底板、常用转场形状），发布成项目组件：

1. 在剪辑文档下 `create_items`，entityType 为 `video_edit.code_component`，属性 `video_edit.code_component.name`（中文名即可）、`video_edit.code_component.source`（模块源码，规则同上面的模块文件，不能 export default）、`video_edit.code_component.description`（这个组件做什么、导出哪些函数、参数含义）。同名再次创建就是发布新版本，旧版本保留。
2. 素材源码里 `import { lowerThird } from "@组件/人名条"` 引用最新版本，或 `"@组件/人名条@2"` 固定第 2 版。组件也可以导入别的组件，不能循环。
3. 保存素材版本时，引用会被钉住到当时的组件版本；之后组件再发新版，已有素材画面不变。要用新组件，给素材创建一个新版本。
4. 开工前先 `list_application_entities` 列出 `video_edit.code_component`，propertyIds 带上 latest_version、exports、description（不带只返回引用），能复用就复用，别重复写同一个部件。
5. 被素材引用的组件版本不能删除；读组件可以看到哪些素材在用它。

组件函数也遵循参数化：接收一个属性对象（尺寸、颜色、文字、进度），由调用它的素材把自己的参数传进去。组件不持有任何全局画面状态：ctx、GPU device、画面宽高、时间都作为参数传入（组件导出的是 `export const 名称 = (ctx, …) => {…}` 这样的箭头函数，组件文件里只能有 import、const 与 export const）。这样同一个组件在不同素材里能有不同外观。
