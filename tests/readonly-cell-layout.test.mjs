import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

test("只读长文本在截断和换行模式下均留在单元格内", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<table class="data-table" style="width:360px"><colgroup><col style="width:180px"><col style="width:180px"></colgroup><tbody>
      ${[false, true].map(wrapped => `<tr><td class="data-cell"><div class="table-cell-frame" data-cell-frame-kind="text"><div class="table-cell-content"><div class="table-cell-content-main"><div class="cell-display cell-text-content ${wrapped ? "cell-text-wrap" : ""}" data-cell-readonly="true"><span>辅助攻击技能。&lt;kw id="physical_damage" mode="alt"&gt;Physical Damage&lt;/kw&gt; ${"LongUnbrokenText".repeat(20)}</span></div></div></div></div></td><td class="data-cell"><button>Object(1)</button></td></tr>`).join("")}
      </tbody></table>`);
    await page.addStyleTag({ content: css });
    const results = await page.locator('[data-cell-readonly="true"]').evaluateAll(elements => elements.map(element => {
      const cell = element.closest("td").getBoundingClientRect();
      const display = element.getBoundingClientRect();
      const text = element.querySelector("span");
      const bounds = text.getBoundingClientRect();
      return { cellRight: cell.right, displayRight: display.right, textRight: bounds.right, scrollWidth: text.scrollWidth, clientWidth: text.clientWidth, height: bounds.height };
    }));
    for (const result of results) {
      assert.ok(result.displayRight <= result.cellRight + 1, JSON.stringify(result));
      assert.ok(result.textRight <= result.cellRight + 1, JSON.stringify(result));
    }
    assert.ok(results[0].scrollWidth > results[0].clientWidth, "截断模式应可检测到隐藏内容");
    assert.ok(results[1].height > results[0].height, "换行模式应在列内换行");
  } finally {
    await browser.close();
  }
});
