export default {
  name: "黄金代码", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 4,
  motionBlur: { shutter: 180, maxSamples: 16 },
  params: [{"key":"nodes","type":"table","title":"节点数据","rowKey":"id","fields":{"id":{"type":"text","title":"键","default":"","maxLength":64},"label":{"type":"text","title":"文案","default":"","maxLength":200}},"default":[{"id":"node-0","label":"首项"}]},{"key":"titleStyle","type":"textStyle","title":"文字样式","layer":"golden-motion","default":{"fontFamily":"sans-serif","fontSize":64}},{"key":"label","type":"text","title":"标题","default":"黄金样本","maxLength":200},{"key":"size","type":"number","title":"字号","default":24,"min":1,"max":72,"step":1,"unit":"px"}],
  layers() {
    return [{ id: "golden-motion", bounds: [0, 0, 100, 100], blurShape: "lens", pose: t => ({ x: t * 10, blur: 8 }), draw(ctx) { ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 100, 100) } }]
  }
}
