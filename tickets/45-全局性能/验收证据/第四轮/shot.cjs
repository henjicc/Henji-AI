// 截一张当前窗口：node shot.cjs <文件名>
const path = require('path')
const { connect } = require('./rawcdp.cjs')
;(async () => { const page = await connect(); await page.shot(path.join(__dirname, process.argv[2] || 'shot.jpg')); page.close(); process.exit(0) })().catch(e => { console.error(e); process.exit(1) })
