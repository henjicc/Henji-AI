// 只读：页面是否出现“还没有导入音频或视频”
module.exports = async (page) => page.evaluate(() => ({ red: document.body.innerText.includes('还没有导入音频或视频') }))
