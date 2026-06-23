/* Capture step-by-step screenshots of the Send Docs (สแกนเอกสาร) menu for the user manual. */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = `http://localhost:${process.env.APP_PORT || 8080}/20260513-dxscms.dbonwer/`;
const EMAIL = "docshiptest@mail.com";
const PASS = "docshiptest123456789";
const IMG = path.join(__dirname, "img");
const CODES = ["TEST-PO-001", "TEST-PO-002", "TEST-PO-003"];
const DEPOSITOR = "ทดสอบ-ผู้ฝาก";
const RECEIVER = "ทดสอบ-ผู้รับ";

if (!fs.existsSync(IMG)) fs.mkdirSync(IMG, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 880 } });
  page.on("dialog", (d) => d.accept());

  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(IMG, name + ".png") });
    console.log("SHOT", name);
  };
  const clearHl = () =>
    page.evaluate(() => document.querySelectorAll(".cc-hl").forEach((e) => e.classList.remove("cc-hl")));
  const hl = async (loc) => {
    await page.evaluate(() => {
      if (!document.getElementById("cc-hl-style")) {
        const s = document.createElement("style");
        s.id = "cc-hl-style";
        s.textContent =
          ".cc-hl{outline:3px solid #e11d48 !important;outline-offset:2px;box-shadow:0 0 0 6px rgba(225,29,72,.22) !important;border-radius:6px;}";
        document.head.appendChild(s);
      }
    });
    await clearHl();
    await loc.evaluate((el) => el.classList.add("cc-hl"));
  };

  // ── 1. Login ──
  await page.goto(BASE);
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await hl(page.locator('button[type="submit"]'));
  await shot("01_login");
  await page.click('button[type="submit"]');
  await page.waitForSelector("aside button, nav button", { timeout: 30000 });
  await page.waitForTimeout(2500);

  // ── 2. Sidebar menu → ส่งเอกสาร ──
  const navBtns = page.locator("aside button, nav button");
  await hl(navBtns.nth(1));
  await shot("02_menu");
  await navBtns.nth(1).click();
  await page.waitForSelector("text=ฝากเอกสาร", { timeout: 20000 });
  await page.mouse.move(800, 450); // move off the hover-expanded sidebar so it collapses
  await page.waitForTimeout(1500);

  // ── cleanup leftovers from earlier runs (avoid duplicate-PO warnings) ──
  const deleteTestDocs = async () => {
    for (let i = 0; i < 10; i++) {
      const rowDel = page.locator("tr", { hasText: DEPOSITOR }).first();
      if (!(await rowDel.count())) break;
      const delBtn = rowDel.locator("button:has(svg.lucide-trash2), button:has(svg.lucide-trash-2)").first();
      if (!(await delBtn.count())) { console.log("WARN: delete button not found"); break; }
      await delBtn.click(); // confirm auto-accepted
      await page.waitForTimeout(2000);
      console.log("test doc deleted");
    }
  };
  await deleteTestDocs();

  // ── 3. Main page (ฝากเอกสาร tab) ──
  const scanDocBtn = page.getByRole("button", { name: /Scan เอกสาร/ }).first();
  await hl(scanDocBtn);
  await shot("03_main");

  // ── 4. Open "Scan เอกสารฝาก" dialog ──
  await scanDocBtn.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await clearHl();
  await shot("04_dialog");

  // ── 5. Fill depositor / receiver ──
  const dlg = page.locator('[role="dialog"]');
  await dlg.getByPlaceholder("พิมพ์ชื่อผู้ฝาก").fill(DEPOSITOR);
  await dlg.getByPlaceholder("พิมพ์ชื่อผู้รับ").fill(RECEIVER);
  await hl(dlg.getByPlaceholder("พิมพ์ชื่อผู้ฝาก"));
  await shot("05_names");

  // ── 6. Pick origin / destination locations ──
  const originBtn = dlg.getByRole("button", { name: /เลือกจุดต้นทาง/ });
  await originBtn.click();
  await page.waitForSelector('[cmdk-item], [role="option"]', { timeout: 10000 });
  await shot("06_origin_dropdown");
  const opts = page.locator("[cmdk-item]");
  const optCount = await opts.count();
  console.log("location options:", optCount);
  await opts.nth(0).click();
  await page.waitForTimeout(300);
  const destBtn = dlg.getByRole("button", { name: /เลือกจุดปลายทาง/ });
  await destBtn.click();
  await page.waitForSelector("[cmdk-item]", { timeout: 10000 });
  await page.locator("[cmdk-item]").nth(Math.min(1, optCount - 1)).click();
  await page.waitForTimeout(300);
  await clearHl();
  await shot("06b_locations_done");

  // ── 7. Scan PO codes ──
  const scanInput = dlg.getByPlaceholder(/สะแกน หรือ พิมพ์เลขที่ PO/);
  for (const c of CODES) {
    await scanInput.fill(c);
    await scanInput.press("Enter");
    await page.waitForTimeout(400);
    // duplicate-PO warning may appear — confirm move to this new doc
    const dupBtn = page.getByRole("button", { name: /ยืนยันฝาก/ });
    if (await dupBtn.count()) {
      await dupBtn.first().click();
      await page.waitForTimeout(400);
    }
  }
  await hl(scanInput);
  await shot("07_codes_added");

  // ── 8. Save เป็น Doc ──
  const saveBtn = dlg.getByRole("button", { name: /Save เป็น Doc/ });
  await hl(saveBtn);
  await shot("08_save");
  await saveBtn.click();
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 20000 });
  await page.waitForTimeout(2000);

  // ── 9. New row in table ──
  const row = page.locator("tr", { hasText: DEPOSITOR }).first();
  await row.waitFor({ timeout: 15000 });
  await hl(row);
  await shot("09_row_created");

  // ── 10. ถึงปลายทาง ──
  const toDestBtn = row.getByRole("button", { name: /ถึงปลายทาง/ });
  await hl(toDestBtn);
  await shot("10_to_destination");
  await toDestBtn.click();
  await page.waitForSelector("text=บันทึกจุดเอกสาร", { timeout: 15000 });
  await page.waitForTimeout(1000);
  await clearHl();
  await shot("11_scan_check_page");

  // ── 12. Scan codes at destination ──
  const destScan = page.getByPlaceholder(/สะแกน หรือ พิมพ์เลขที่ PO/).first();
  for (const c of CODES) {
    await destScan.fill(c);
    await destScan.press("Enter");
    await page.waitForTimeout(250);
  }
  await shot("12_dest_scanned");

  // ── 13. บันทึกตรวจ ──
  const saveHopBtn = page.getByRole("button", { name: /บันทึกตรวจ/ }).first();
  await saveHopBtn.scrollIntoViewIfNeeded();
  await hl(saveHopBtn);
  await shot("13_save_check");
  await saveHopBtn.click();
  await page.waitForTimeout(3000);
  await clearHl();
  await shot("14_next_action_popup"); // popup: ฝากต่อ / จบล็อตนี้

  // ── 14b. จบล็อตนี้ ──
  const closeLotBtn = page.locator('[role="dialog"]').getByRole("button", { name: /จบล็อตนี้/ }).first();
  if (await closeLotBtn.count()) {
    await hl(closeLotBtn);
    await shot("14b_close_lot");
    await closeLotBtn.click(); // window.confirm auto-accepted
    await page.waitForTimeout(3000);
    await clearHl();
    await shot("14c_lot_closed");
  }

  // ── 15. กลับไปรายการ ──
  const backBtn = page.getByRole("button", { name: /กลับไปรายการ/ }).first();
  if (await backBtn.count()) {
    await backBtn.click();
    await page.waitForTimeout(1500);
  }
  const row2 = page.locator("tr", { hasText: DEPOSITOR }).first();
  if (await row2.count()) await hl(row2);
  await shot("15_row_updated");

  // ── 16. Report tab ──
  await clearHl();
  await page.locator('[role="tablist"] [role="tab"]').nth(2).click();
  await page.waitForTimeout(2000);
  await shot("16_report");

  // ── 17. จุดรับส่งเอกสาร dialog ──
  await page.locator('[role="tablist"] [role="tab"]').nth(0).click();
  await page.waitForTimeout(800);
  const locBtn = page.getByRole("button", { name: /จุดรับส่งเอกสาร/ }).first();
  await locBtn.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await shot("17_locations_dialog");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ── cleanup: delete test docs created by this run ──
  await deleteTestDocs();

  await browser.close();
  console.log("DONE");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
