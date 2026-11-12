// 在页面里执行表达式：node eval.cjs '<表达式>'
const { connect } = require('./rawcdp.cjs')
;(async () => { const page = await connect(); console.log(JSON.stringify(await page.evaluate(process.argv[2]))); page.close(); process.exit(0) })().catch(e => { console.error(e.message); process.exit(1) })
