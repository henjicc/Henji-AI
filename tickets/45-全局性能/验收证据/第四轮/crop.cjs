// 截取区域（CSS 像素）：node crop.cjs 文件 x y w h
const fs = require('fs'), path = require('path')
const { connect } = require('./rawcdp.cjs')
;(async () => { const page = await connect(); const [file, x, y, w, h] = process.argv.slice(2); const r = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: +x, y: +y, width: +w, height: +h, scale: 1 } }); fs.writeFileSync(path.join(__dirname, file), Buffer.from(r.data, 'base64')); page.close(); process.exit(0) })().catch(e => { console.error(e); process.exit(1) })
