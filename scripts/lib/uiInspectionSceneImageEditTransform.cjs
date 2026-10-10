/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 截图场景复用仓内 CommonJS 工厂。 */
const assert = require("node:assert/strict");
const { blockPaidGeneration } = require("./uiReviewPaidGuard.cjs");

async function exerciseTransforms(page, context, capture, label) {
  const host = page.locator("[data-image-editor-v3]:visible").last();
  await host.waitFor({ timeout: 30000 });
  const row = host
    .locator("[data-layer-select]")
    .filter({ hasText: label })
    .first();
  await row.click();
  const revision = async () =>
    Number(
      await host
        .locator("[data-command-bar]")
        .getAttribute("data-document-revision"),
    );
  const shot = async (name) => {
    await context.settlePage(page, 800);
    await capture(name);
  };
  await host.locator('[data-tool-id$="-transform"]').first().click();
  await host.locator("[data-transform-options]").waitFor();
  const overlay = host.locator("[data-transform-overlay]");
  await overlay.waitFor();
  const drag = async (handle, dx, dy) => {
    const box = await overlay
      .locator(`[data-transform-handle="${handle}"]`)
      .boundingBox();
    assert.ok(box);
    await page.mouse.move(
      box.x + box.width * (handle === "move" ? 0.3 : 0.5),
      box.y + box.height * (handle === "move" ? 0.3 : 0.5),
    );
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width * (handle === "move" ? 0.3 : 0.5) + dx,
      box.y + box.height * (handle === "move" ? 0.3 : 0.5) + dy,
      { steps: 8 },
    );
    await page.mouse.up();
  };
  const choose = async (name) => {
    await host
      .locator("[data-transform-options]")
      .getByRole("button")
      .first()
      .click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const options = host.locator("[data-transform-options]");
  await shot("affine-handles");
  let before = await revision();
  await page.keyboard.down("Shift");
  await drag(0, 45, 30);
  await page.keyboard.up("Shift");
  assert.equal(await revision(), before);
  await shot("affine-preview");
  await options.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await revision(), before);
  await shot("affine-cancelled");
  await drag(0, 35, 25);
  await options.getByRole("button", { name: "应用", exact: true }).click();
  await context.settlePage(page, 700);
  assert.equal(await revision(), before + 1);
  await shot("affine-applied");
  await drag("rotate", 25, 20);
  await shot("rotate-preview");
  await page.keyboard.press("Escape");
  assert.equal(await revision(), before + 1);
  await choose("透视");
  before = await revision();
  await drag(0, 35, 25);
  await shot("perspective-preview");
  await options.getByRole("button", { name: "应用", exact: true }).click();
  await context.settlePage(page, 700);
  assert.equal(await revision(), before + 1);
  await shot("perspective-applied");
  const diagonal = await overlay
      .locator('[data-transform-handle="2"]')
      .boundingBox(),
    first = await overlay.locator('[data-transform-handle="0"]').boundingBox();
  assert.ok(diagonal && first);
  await drag(0, diagonal.x - first.x + 40, diagonal.y - first.y + 40);
  await host.getByText("无法应用此变换", { exact: true }).waitFor();
  assert.equal(
    await options
      .getByRole("button", { name: "应用", exact: true })
      .isDisabled(),
    true,
  );
  await shot("invalid-recoverable");
  await options.getByRole("button", { name: "取消", exact: true }).click();
  await choose("网格变形");
  assert.equal(
    await overlay.locator("circle[data-transform-handle]").count(),
    9,
  );
  // Start the mesh case from the original pixels through the actual recovery action.
  // The small, already-cropped canvas fixture has a much tighter screen-space grid.
  await options.getByRole("button", { name: "恢复原像素", exact: true }).click();
  await options.getByRole("button", { name: "应用", exact: true }).click();
  await context.settlePage(page, 700);
  await shot("mesh-source-restored");
  const meshFirst = await overlay.locator('[data-transform-handle="0"]').boundingBox();
  const meshLast = await overlay.locator('[data-transform-handle="8"]').boundingBox();
  assert.ok(meshFirst && meshLast);
  before = await revision();
  await drag(4, (meshLast.x - meshFirst.x) * .08, -(meshLast.y - meshFirst.y) * .06);
  await shot("mesh-preview");
  await options.getByRole("button", { name: "应用", exact: true }).click();
  await context.settlePage(page, 700);
  assert.equal(await revision(), before + 1);
  await shot("mesh-applied");
  await host.locator("[data-viewport-control] button").first().click();
  await shot("mesh-smaller-zoom");
  await options
    .getByRole("button", { name: "恢复原像素", exact: true })
    .click();
  await shot("restore-source-preview");
  await options.getByRole("button", { name: "取消", exact: true }).click();
  await choose("自由变换");
  await drag("move", -240, -140);
  assert.equal(
    await options
      .getByRole("button", { name: "应用", exact: true })
      .isDisabled(),
    false,
  );
  await shot("outside-canvas-preview");
  await page.keyboard.press("Escape");
  await host.focus();
  await page.keyboard.down("Space");
  await shot("temporary-navigation");
  await page.keyboard.up("Space");
  await shot("restored-transform");
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  await shot("one-step-undo");
  await host.getByRole("button", { name: "添加图层", exact: true }).click();
  await page.getByRole("menuitem", { name: "全能调色", exact: true }).click();
  await choose("透视");
  await host.getByText("请选择一个可编辑像素图层", { exact: true }).waitFor();
  await shot("unsupported-layer-empty");
  await host.getByRole("button", { name: "撤销", exact: true }).click();
}
function createImageEditTransformScene(context, canvas = false) {
  return {
    id: canvas ? "image-edit-transform-node" : "image-edit-transform-handles",
    surface: canvas ? "画布" : "图片编辑",
    name: canvas
      ? "变换-画布图片文档同内核"
      : "变换-自由、透视、网格、确认取消与非法控制点",
    writesUserData: true,
    expectedLogEvents: ["image_edit.transform.preview.rejected"],
    ...(canvas
      ? {}
      : {
          launchArgs: [
            "--dev-surface=tool.image_edit",
            "--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png",
          ],
        }),
    setup: async (page, app, inspection) => {
      const { capture } = inspection;
      const restore = await blockPaidGeneration(app);
      try {
        if (canvas) {
          await context.setupCanvasMultiLayerDocumentEditor(
            page,
            app,
            inspection,
          );
          const node = page
            .locator('[data-layer-stack-status="editable-v3"]')
            .first();
          await node.getByRole("button", { name: /^(编辑|Edit)$/i }).click();
        }
        await exerciseTransforms(
          page,
          context,
          capture,
          canvas ? "道具元素" : "原图",
        );
      } catch (error) {
        await capture("failure");
        throw error;
      } finally {
        await restore();
      }
    },
  };
}
module.exports = { createImageEditTransformScene };
