# 纵深、三维镜头参考与代码伪3D

先识别参考的空间证据：近大远小、前景掠过、遮挡变化、侧转露厚度。整组同比缩放只有平面推进；景深模糊、材质着色也不自动等于真实三维。

## 三维镜头参考的边界

本项目三维镜头参考用于摆场景、机位、焦点与运镜。先从正式目录取得已有文档／节点，使用通用实体描述读取对象与摄像机属性，不能猜ID或凭配方新建无关工程。可用 apply_camera_stage_camera_move 做语义运镜、verify_camera_stage_scene 检查结果；调用前读实际输入schema与权限。

需要输出时 render_camera_stage_output 接受同次画布读取的canvasRef/nodeRef（目标为3D镜头参考节点），outputKind为image/video；图片可selectedTimeSec，输出规格720p/1080p。仅提交后台任务，返回taskRef不是媒体；用wait_camera_stage_render_task／get_camera_stage_render_task确认completed与持久结果节点，再沿正式媒体导入／引用放进剪辑。没节点／没许可就报告缺入口，不猜建模或离线渲染接口。此路线不是通用三维制作软件，也不提供代码素材里的实时摄像机／景深参数。

需要摄影级人物、复杂模型或材质且参考工具不能满足，可建议授权AI图／视频再合成；生成费用、可控性和内部不可编辑性先说明。绝不因为纵深难做自动发起付费调用。

## 代码伪3D配方

背景、主体、前景分组，前景移动快、远景慢。轻推进可以只让三层用不同scale与x/y幅度；需要近大远小，用投影倍率f/(f+z−cameraTravel)算位置和尺寸，所有层同一时刻直接求值。分母必须始终为正且远离0，限定运镜范围或裁掉穿越镜头的层，不能靠无限放大表现穿越。

代码group只有平面rotation与scaleX/Y，没有rotateX/Y、z、相机或深度排序；按返回顺序由远到近画。侧转可平面缩窄＋补侧面多边形作为示意，但不能声称正确透视／体积折射。需要动态遮挡换序时用合法时间条件明确组织，不读取上一帧。

完整样例：三层卡片按固定纵深由远到近绘制，统一前推产生不同位移和尺度。运镜距离、秒数、标题、颜色可改；技术约束来自投影分母，非产品数量上限。它是伪3D平面卡片，不含厚度、真实光照或相机景深。

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "三层视差推进",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 6, seed: 10,
  parameters: {
    title: {type: "text", title: "卡片文字", default: "近与远", maxLength: 32},
    accent: {type: "color", title: "卡片颜色", default: [.14,.4,.46,1]},
    travel: {type: "number", title: "推进距离", default: 180, min: 0, max: 300, step: 10,
      description: "伪3D投影距离；最大300，确保最近层分母至少350，不穿过镜头"},
    seconds: {type: "number", title: "推进秒数", default: 4, min: 2, max: 5, step: .1}
  },
  render(ctx) {
    const z = [500, 0, -250];
    const xs = [-620, 0, 560];
    const ys = [-180, 0, 160];
    const advance = ctx.params.travel * sineInOut(progress(ctx.time, .2, ctx.params.seconds));
    return [
      rect({id: "background", x: 0, y: 0, width: ctx.width, height: ctx.height,
        fill: ctx.style.palette.bg}),
      repeat(3, i => group({id: "depthCard",
        x: ctx.width / 2 + xs[i] * 900 / (900 + z[i] - advance),
        y: ctx.height / 2 + ys[i] * 900 / (900 + z[i] - advance),
        scale: 900 / (900 + z[i] - advance), anchorX: 200, anchorY: 100}, [
        rect({id: "plate", x: 0, y: 0, width: 400, height: 200, radius: 24,
          fill: ctx.params.accent, stroke: ctx.style.palette.muted, strokeWidth: 2}),
        text({id: "title", x: 200, y: 100, text: ctx.params.title, fontSize: 48,
          align: "center", color: ctx.style.palette.fg})
      ]))
    ];
  }
}
```

检查推进起中末的相对运动、近景是否盖住关键信息、所有图形是否仍在安全区。要真正侧转或人物绕行时改用三维／媒体路线，不能只给全片加缩放。
