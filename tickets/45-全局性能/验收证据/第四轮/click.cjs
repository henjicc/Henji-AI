// 按截图显示坐标（2000 宽）点击：node click.cjs x y
const { connect } = require('./rawcdp.cjs')
;(async () => { const page = await connect(); const k = 1.92 / (await page.evaluate('devicePixelRatio')); await page.click(Number(process.argv[2]) * k, Number(process.argv[3]) * k); page.close(); process.exit(0) })().catch(e => { console.error(e); process.exit(1) })
