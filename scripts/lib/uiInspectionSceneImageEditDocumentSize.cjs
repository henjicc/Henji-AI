/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 尺寸场景。 */
const assert = require('node:assert/strict');
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs');
function createImageEditDocumentSizeScene(context, canvas = false) {
  return {
    id: canvas ? 'image-edit-document-size-node' : 'image-edit-document-size', surface: canvas ? '画布' : '图片编辑', name: `${canvas ? '画布节点' : '工具箱'}尺寸-锚点、原稿、重采样、保护预览与取消`, writesUserData: true,
    expectedLogEvents: ['image_edit.geometry.prepare.failed'],
    ...(canvas ? {} : { launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'] }),
    setup: async (page, app, inspection) => {
      const { capture } = inspection;
      const restore = await blockPaidGeneration(app);
      try {
        if (canvas) await context.setupCanvasMultiLayerDocumentEditor(page, app, { ...inspection, fixtureOnly: true });
        const host = page.locator('[data-image-editor-v3]:visible').last(); await host.waitFor({ timeout: 30000 });
        const shot = async name => { await context.settlePage(page, 500); await host.locator('[data-preview-target-mip-coverage="1.0000"]').waitFor({ timeout: 30000 }); assert.equal(await host.locator('[data-command-bar]').count(), 1); assert.ok(await host.locator('[data-context-bar]').count() <= 1); await capture(name); };
        const chooseTool = async () => { await host.locator('[data-tool-id="free-transform"]').click(); await page.getByRole('menuitem', { name: '画布与图像尺寸', exact: true }).click(); };
        await chooseTool();
        const options = host.locator('[data-document-size-options]'), configure = async () => { await options.getByRole('button', { name: '调整尺寸', exact: true }).click(); return page.locator('[data-document-size-configuration]'); };
        let form = await configure(); const initialWidth = Number(await form.getByRole('spinbutton', { name: '宽度（像素）', exact: true }).inputValue()), initialHeight = Number(await form.getByRole('spinbutton', { name: '高度（像素）', exact: true }).inputValue());
        const size = async (width, height) => { const input = form.getByRole('spinbutton', { name: '宽度（像素）', exact: true }); await input.click(); await input.fill(String(width)); await input.press('Enter'); const second = form.getByRole('spinbutton', { name: '高度（像素）', exact: true }); await second.click(); await second.fill(String(height)); await second.press('Enter'); assert.equal(Number(await input.inputValue()), width); assert.equal(Number(await second.inputValue()), height); };
        const select = async (_current, next) => { await form.getByRole('button', { name: /^调整方式/ }).click(); await page.getByRole('option', { name: next, exact: true }).click(); };
        const preview = async () => { await page.getByRole('button', { name: '预览', exact: true }).click(); await options.getByRole('button', { name: '应用', exact: true }).waitFor({ state: 'visible' }); await page.waitForFunction(() => { const button = [...document.querySelectorAll('[data-document-size-options] button')].find(value => value.textContent === '应用'); return button && !button.disabled; }, null, { timeout: 180000 }); };
        await shot('canvas-empty-no-change');
        await size(initialWidth + 100, initialHeight + 60); await form.getByRole('button', { name: /^原稿锚点/ }).click(); assert.equal(await page.getByRole('option').count(), 9); await shot('nine-anchor-menu'); const bottomRight = page.getByRole('option', { name: '右下', exact: true }); await bottomRight.scrollIntoViewIfNeeded(); await shot('nine-anchor-menu-bottom'); await bottomRight.click();
        await preview(); await shot('left-top-margin-preview'); await options.getByRole('button', { name: '取消', exact: true }).click(); await shot('canvas-preview-cancelled');
        form = await configure(); await preview(); await options.getByRole('button', { name: '应用', exact: true }).click(); await shot('canvas-applied');
        await host.getByRole('button', { name: '撤销', exact: true }).click(); await shot('canvas-one-step-undo');
        form = await configure(); await select('画布尺寸', '图像尺寸'); await size(Math.max(1, Math.round(initialWidth * .8)), Math.max(1, Math.round(initialHeight * .8))); await shot('resample-configuration');
        await preview(); await shot('resample-original-grid-preview'); await options.getByRole('button', { name: '取消', exact: true }).click();
        form = await configure(); await select('图像尺寸', '内容识别缩放'); await form.getByRole('checkbox', { name: '保持宽高比', exact: true }).click(); await size(Math.max(1, initialWidth - 24), initialHeight);
        if (await form.getByRole('checkbox', { name: '保护当前选区', exact: true }).getAttribute('aria-checked') !== 'true') await form.getByRole('checkbox', { name: '保护当前选区', exact: true }).click(); await page.getByRole('button', { name: '预览', exact: true }).click(); await form.getByText('请先选择要保护的主体，或关闭保护当前选区', { exact: true }).waitFor(); await shot('protection-empty-recoverable');
        await form.getByRole('checkbox', { name: '保护当前选区', exact: true }).click(); await page.getByRole('button', { name: '预览', exact: true }).click(); await capture('seam-progress');
        await page.waitForFunction(() => { const button = [...document.querySelectorAll('[data-document-size-options] button')].find(value => value.textContent === '应用'); return button && !button.disabled; }, null, { timeout: 180000 });
        await shot('seam-preview'); await options.getByRole('button', { name: '取消', exact: true }).click(); await shot('seam-cancelled');
        form = await configure(); await size(Number.MAX_SAFE_INTEGER + 1, initialHeight); await page.getByRole('button', { name: '预览', exact: true }).click(); await form.getByText('尺寸必须为可精确表示的正整数像素', { exact: true }).waitFor(); await shot('invalid-size-recovery');
        await size(Math.max(1, initialWidth - 24), initialHeight); await select('内容识别缩放', '图像尺寸'); await preview(); await options.getByRole('button', { name: '应用', exact: true }).click(); await shot('resample-fallback-applied');
        await host.getByRole('button', { name: '撤销', exact: true }).click();
        await host.locator('[data-tool-id^="select-"]').first().click(); await page.getByRole('menuitem', { name: /矩形/ }).click();
        const box = await host.locator('[data-tool-overlay-slot="selection"] svg').boundingBox(); assert.ok(box);
        await page.mouse.move(box.x + box.width * .35, box.y + box.height * .3); await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .7, { steps: 6 }); await page.mouse.up();
        await chooseTool(); form = await configure(); await select('画布尺寸', '内容识别缩放');
        if (await form.getByRole('checkbox', { name: '保持宽高比', exact: true }).getAttribute('aria-checked') === 'true') await form.getByRole('checkbox', { name: '保持宽高比', exact: true }).click();
        await size(Math.max(1, initialWidth - 24), initialHeight); await shot('protected-region-configuration');
        await preview(); await shot('protected-region-preview'); await options.getByRole('button', { name: '取消', exact: true }).click(); await shot('protected-region-cancelled');
      } catch (error) { error.message += `\n${JSON.stringify(await page.locator('[data-preview-surface]:visible').last().evaluate(element => ({ ...element.dataset })).catch(() => null))}`; await capture('failure'); throw error; } finally { await restore(); }
    },
  };
}
module.exports = { createImageEditDocumentSizeScene };
