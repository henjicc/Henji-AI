module.exports = async (page, b, { shot }) => {
  await shot(process.env.SHOT || 's.jpg')
  return await page.evaluate(() => {
    const d = document.querySelector('[data-preview-surface]')?.dataset || {}
    const errs = [...document.querySelectorAll('[role="alert"],[role="alertdialog"],[data-sonner-toast]')].map(e => e.innerText.slice(0, 200))
    return { url: location.href, vw: innerWidth, vh: innerHeight, surface: { ...d }, errs, tc: (document.body.innerText.match(/\d\d:\d\d:\d\d[:;]\d\d/g) || []).slice(0, 3) }
  })
}
