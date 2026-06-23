/* Build the Thai user manual (Word) for the Send Docs / scan-documents menu. */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, LevelFormat,
  Header, Footer, PageNumber, PageBreak,
} = require("docx");

const IMG = path.join(__dirname, "img");
// A4 portrait, 1" margins → content width 9026 DXA ≈ 6.27 in ≈ 602 px @96dpi
const IMG_W = 600;
const IMG_H = Math.round((IMG_W * 880) / 1366); // keep 1366x880 aspect → 386

const THAI = { font: "Tahoma" };

const img = (file) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 60 },
    children: [
      new ImageRun({
        type: "png",
        data: fs.readFileSync(path.join(IMG, file)),
        transformation: { width: IMG_W, height: IMG_H },
        altText: { title: file, description: file, name: file },
      }),
    ],
  });

const caption = (text) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text, italics: true, size: 18, color: "666666", ...THAI })],
  });

const h1 = (text) =>
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, ...THAI })] });
const h2 = (text) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, ...THAI })] });

const p = (runs, opts = {}) =>
  new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: runs.map((r) => (typeof r === "string" ? new TextRun({ text: r, size: 22, ...THAI }) : r)),
  });

const b = (text) => new TextRun({ text, bold: true, size: 22, ...THAI });
const red = (text) => new TextRun({ text, bold: true, size: 22, color: "C0392B", ...THAI });

const bullet = (text) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 22, ...THAI })],
  });

// step heading: "ขั้นตอนที่ N — ..."
const step = (n, text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun({ text: `ขั้นตอนที่ ${n}`, color: "1D4ED8", ...THAI }),
      new TextRun({ text: `  —  ${text}`, ...THAI }),
    ],
  });

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const cell = (text, { head = false, w, fill } = {}) =>
  new TableCell({
    borders,
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: head, size: 20, ...THAI })],
      }),
    ],
  });

const statusTable = new Table({
  width: { size: 9026, type: WidthType.DXA },
  columnWidths: [2200, 6826],
  rows: [
    new TableRow({
      children: [cell("สถานะ", { head: true, w: 2200, fill: "D5E8F0" }), cell("ความหมาย", { head: true, w: 6826, fill: "D5E8F0" })],
    }),
    ...[
      ["เริ่มฝาก", "สแกนฝากที่จุดต้นทางแล้ว เอกสารกำลังเดินทางไปจุดปลายทาง"],
      ["รอดำเนินการ", "ปลายทางสแกนรับแล้ว แต่ยังไม่ได้กดจบล็อต (อาจฝากต่อไปจุดถัดไปได้)"],
      ["จบ-ครบ", "จบล็อตแล้ว และจำนวนเอกสารที่รับตรงกับที่ฝากครบทุกใบ"],
      ["จบ-ไม่ครบ", "จบล็อตแล้ว แต่จำนวนเอกสารขาดหรือเกินจากที่ฝาก"],
      ["สิ้นสุด", "กดปุ่มสิ้นสุดเพื่อปิดงานถาวร — เอกสารจะถูกตัดออกจากหน้า Report"],
    ].map(
      ([s, m]) =>
        new TableRow({ children: [cell(s, { w: 2200 }), cell(m, { w: 6826 })] })
    ),
  ],
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Tahoma", size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Tahoma", color: "1A1A1A" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Tahoma", color: "1A1A1A" },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "DX-SCMS — คู่มือเมนูส่งเอกสาร (สแกนเอกสาร)", size: 16, color: "888888", ...THAI })],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "หน้า ", size: 16, color: "888888", ...THAI }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888", font: "Tahoma" }),
              ],
            }),
          ],
        }),
      },
      children: [
        // ===== Title =====
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 1200, after: 200 },
          children: [new TextRun({ text: "คู่มือการใช้งาน", size: 48, bold: true, ...THAI })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "เมนูส่งเอกสาร (สแกนเอกสาร PO)", size: 40, bold: true, color: "1D4ED8", ...THAI })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 2000 },
          children: [new TextRun({ text: "ระบบ DX Supplychain Management (DX-SCMS)", size: 26, color: "555555", ...THAI })],
        }),

        h1("ภาพรวมของเมนูส่งเอกสาร"),
        p([
          "เมนูส่งเอกสารใช้สำหรับติดตามเอกสาร PO ที่ฝากส่งระหว่างจุดต่างๆ (เช่น จากสาขา → คลัง → สำนักงาน) ",
          "เพื่อป้องกันเอกสารสูญหายระหว่างทาง โดยการสแกน QR Code เลขที่ PO ทั้งตอน",
          b("ฝากเอกสาร (ต้นทาง)"),
          " และตอน",
          b("รับเอกสาร (ปลายทาง)"),
          " แล้วระบบจะเทียบให้อัตโนมัติว่าเอกสารถึงครบหรือไม่",
        ]),
        p([b("เมนูนี้มี 3 แท็บหลัก:")]),
        bullet("ฝากเอกสาร — สแกนฝากเอกสารที่จุดต้นทาง และดูรายการเอกสารทั้งหมด"),
        bullet("สะแกนตรวจ — สแกนตรวจรับเอกสารเมื่อถึงจุดปลายทาง"),
        bullet("Report — สรุปจำนวน PO ของแต่ละ Partner ว่าอยู่ที่จุดไหนบ้าง"),

        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 1: Login =====
        h1("ส่วนที่ 1 — เข้าสู่ระบบ"),

        step(1, "เปิดเว็บแล้วเข้าสู่ระบบ"),
        p(["กรอก ", b("Email"), " และ ", b("Password"), " ของคุณ แล้วกดปุ่ม ", red("เข้าสู่ระบบ"), " (กรอบสีแดงในรูป)"]),
        img("01_login.png"),
        caption("รูปที่ 1: หน้าเข้าสู่ระบบ"),

        step(2, "คลิกเมนูส่งเอกสาร"),
        p(["ที่แถบเมนูด้านซ้าย คลิกไอคอน ", red("ส่งเอกสาร"), " (กรอบสีแดงในรูป — ไอคอนรูปกราฟ ตัวที่ 2 จากบน)"]),
        img("02_menu.png"),
        caption("รูปที่ 2: เมนูส่งเอกสารที่แถบด้านซ้าย"),

        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 2: Deposit =====
        h1("ส่วนที่ 2 — ฝากเอกสาร (สแกนที่จุดต้นทาง)"),

        step(3, "กดปุ่ม Scan เอกสาร"),
        p(["เข้ามาที่แท็บ ", b("ฝากเอกสาร"), " แล้วกดปุ่มสีน้ำเงิน ", red("Scan เอกสาร"), " มุมซ้ายบน"]),
        img("03_main.png"),
        caption("รูปที่ 3: หน้าแท็บฝากเอกสาร — ปุ่ม Scan เอกสาร"),

        step(4, "หน้าต่าง Scan เอกสารฝาก จะเปิดขึ้นมา"),
        p(["หน้าต่างนี้ใช้บันทึกการฝากเอกสาร 1 ล็อต (1 Doc) ช่องที่มีดาวแดง (*) คือช่องที่ต้องกรอกให้ครบ"]),
        img("04_dialog.png"),
        caption("รูปที่ 4: หน้าต่าง Scan เอกสารฝาก"),

        step(5, "กรอกชื่อผู้ฝาก และชื่อผู้รับ"),
        p(["พิมพ์ ", b("ชื่อผู้ฝาก"), " (คนที่นำเอกสารมาฝาก) และ ", b("ชื่อผู้รับปลายทาง"), " (คนที่จะรับเอกสารที่ปลายทาง)"]),
        img("05_names.png"),
        caption("รูปที่ 5: กรอกชื่อผู้ฝากและชื่อผู้รับ"),

        step(6, "เลือกจุดต้นทาง และจุดปลายทาง"),
        p(["กดที่ช่อง ", b("จุดต้นทาง"), " แล้วเลือกจุดที่ฝากเอกสารจากรายการ จากนั้นเลือก ", b("จุดปลายทาง"), " ที่เอกสารจะถูกส่งไป (พิมพ์ค้นหาชื่อจุดได้)"]),
        img("06_origin_dropdown.png"),
        caption("รูปที่ 6: รายการจุดให้เลือก (พิมพ์ค้นหาได้)"),
        img("06b_locations_done.png"),
        caption("รูปที่ 7: เลือกจุดต้นทางและจุดปลายทางเรียบร้อยแล้ว"),

        step(7, "สแกนหรือพิมพ์เลขที่ PO"),
        p([
          "ยิงสแกนเนอร์ที่ QR Code ของเอกสาร PO ทีละใบ หรือพิมพ์เลขที่ PO แล้วกด ",
          b("Enter"),
          " (หรือกดปุ่ม + เพิ่ม) — รายการที่สแกนแล้วจะขึ้นในตารางด้านล่าง ทำซ้ำจนครบทุกใบ",
        ]),
        p(["ถ้าต้องการใช้กล้องมือถือ/กล้องเครื่อง ให้กดปุ่ม ", b("เปิดกล้อง"), " แล้วส่อง QR Code ได้เลย"]),
        img("07_codes_added.png"),
        caption("รูปที่ 8: สแกนเลขที่ PO เข้าระบบครบแล้ว 3 รายการ"),

        step(8, "กดปุ่ม Save เป็น Doc"),
        p(["ตรวจสอบจำนวนรายการให้ครบ แล้วกดปุ่ม ", red("Save เป็น Doc"), " ระบบจะสร้างเลขเอกสาร DOC-วันที่-เวลา ให้อัตโนมัติ"]),
        img("08_save.png"),
        caption("รูปที่ 9: ปุ่ม Save เป็น Doc"),
        p(["เอกสารที่ฝากจะขึ้นเป็นแถวใหม่ในตาราง สถานะ ", b("“เริ่มฝาก”"), " พร้อมจำนวนใบที่ฝาก"]),
        img("09_row_created.png"),
        caption("รูปที่ 10: เอกสารใหม่ขึ้นในตาราง สถานะเริ่มฝาก"),

        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 3: Receive =====
        h1("ส่วนที่ 3 — สแกนตรวจรับที่จุดปลายทาง"),

        step(9, "กดปุ่ม ถึงปลายทาง"),
        p(["เมื่อเอกสารเดินทางมาถึงจุดปลายทางแล้ว ให้หาเอกสารในตารางแท็บ ", b("ฝากเอกสาร"), " แล้วกดปุ่ม ", red("ถึงปลายทาง"), " ท้ายแถวนั้น"]),
        img("10_to_destination.png"),
        caption("รูปที่ 11: ปุ่มถึงปลายทาง ท้ายแถวเอกสาร"),

        step(10, "หน้าสะแกนตรวจจะเปิดขึ้นมา"),
        p([
          "ระบบจะพาไปที่แท็บ ",
          b("สะแกนตรวจ"),
          " — ด้านซ้ายแสดงรายการ PO ที่ฝากมา ด้านขวาเป็นพื้นที่สแกนตรวจรับ ชื่อผู้ฝาก/ผู้รับ/จุดปลายทาง ระบบเติมให้อัตโนมัติจากตอนฝาก",
        ]),
        img("11_scan_check_page.png"),
        caption("รูปที่ 12: หน้าสะแกนตรวจรับเอกสาร"),

        step(11, "สแกนเลขที่ PO ของเอกสารที่รับจริง"),
        p([
          "ยิงสแกน QR Code ของเอกสารที่มาถึงทีละใบ — ใบที่ตรงกับรายการฝากจะขึ้น ",
          b("สีเขียว (ตรง)"),
          " ใบที่ยังไม่สแกนจะแสดง ",
          b("ขาด"),
          " และถ้าสแกนใบที่ไม่อยู่ในรายการฝากจะแสดง ",
          b("เกิน"),
        ]),
        img("12_dest_scanned.png"),
        caption("รูปที่ 13: สแกนตรวจรับครบ — ทุกใบขึ้นสีเขียว (ตรง)"),

        step(12, "กดปุ่ม บันทึกตรวจ (รับตรวจ)"),
        p(["เมื่อสแกนครบแล้ว เลื่อนลงด้านล่าง กดปุ่ม ", red("บันทึกตรวจ (รับตรวจ)"), " เพื่อบันทึกผลการตรวจรับที่จุดนี้"]),
        img("13_save_check.png"),
        caption("รูปที่ 14: ปุ่มบันทึกตรวจ (รับตรวจ) ด้านล่างขวา"),

        step(13, "เลือกการดำเนินการถัดไป — ฝากต่อ หรือ จบล็อต"),
        p(["ระบบจะถามว่าจะทำอะไรต่อกับเอกสารล็อตนี้:"]),
        bullet("ฝากต่อ (เลือกจุดปลายทางถัดไป) — กรณีเอกสารต้องเดินทางต่อไปยังจุดที่ 3 เช่น จุด 1 → จุด 2 → จุด 3"),
        bullet("จบล็อตนี้ — กรณีเอกสารถึงจุดสุดท้ายแล้ว ระบบจะสรุปสถานะเป็น จบ-ครบ หรือ จบ-ไม่ครบ ให้อัตโนมัติ"),
        img("14_next_action_popup.png"),
        caption("รูปที่ 15: หน้าต่างเลือกการดำเนินการถัดไป"),
        img("14b_close_lot.png"),
        caption("รูปที่ 16: ตัวอย่างกดปุ่มจบล็อตนี้ (กรอบสีแดง)"),

        step(14, "ตรวจสอบสถานะเอกสารในตาราง"),
        p([
          "กลับมาที่แท็บฝากเอกสาร เอกสารล็อตนี้จะเปลี่ยนสถานะเป็น ",
          b("“จบ-ครบ” (สีเขียว)"),
          " พร้อมแสดงจำนวนถึง และวันเวลาที่สแกนรับ — ถ้ารับไม่ครบจะเป็นสถานะ จบ-ไม่ครบ",
        ]),
        img("15_row_updated.png"),
        caption("รูปที่ 17: เอกสารเปลี่ยนสถานะเป็นจบ-ครบ"),

        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 4: Report =====
        h1("ส่วนที่ 4 — ดูรายงาน (แท็บ Report)"),
        step(15, "เปิดแท็บ Report"),
        p([
          "กดแท็บ ",
          b("Report"),
          " เพื่อดูภาพรวมว่า PO ของแต่ละ Partner อยู่ที่จุดไหนบ้าง จำนวนเท่าไหร่ — ค้นหาด้วยเลข Doc / ชื่อผู้ฝาก / เลข PO / ชื่อ Partner ได้ และกดปุ่ม ",
          b("Export Excel"),
          " เพื่อดึงข้อมูลออกไปใช้งานต่อ",
        ]),
        img("16_report.png"),
        caption("รูปที่ 18: แท็บ Report — จำนวน PO ของแต่ละ Partner แยกตามจุด"),

        // ===== Section 5: Locations =====
        h1("ส่วนที่ 5 — จัดการจุดรับส่งเอกสาร"),
        step(16, "เพิ่ม/ลบ จุดรับส่งเอกสาร"),
        p([
          "ที่แท็บฝากเอกสาร กดปุ่ม ",
          b("จุดรับส่งเอกสาร"),
          " เพื่อเพิ่มหรือลบรายชื่อจุด — พิมพ์ชื่อจุดในช่อง แล้วกดปุ่ม + จุดที่เพิ่มจะไปขึ้นเป็นตัวเลือกในตอน Scan เอกสารฝาก",
        ]),
        img("17_locations_dialog.png"),
        caption("รูปที่ 19: หน้าต่างจัดการจุดรับส่งเอกสาร"),

        new Paragraph({ children: [new PageBreak()] }),

        // ===== Special case =====
        h1("กรณีพิเศษ — พบเอกสารซ้ำในระบบ"),
        p([
          "ถ้าสแกนเลข PO ที่เคยฝากไว้ในเอกสารอื่นที่ยังไม่จบกระบวนการ ระบบจะเตือน ",
          b("“พบเอกสารซ้ำในระบบ”"),
          " พร้อมบอกว่าเลขนั้นอยู่ในเอกสารไหน ที่จุดไหน — ให้เลือกอย่างใดอย่างหนึ่ง:",
        ]),
        bullet("ข้ามรายการนี้ — สะแกนต่อ: ไม่เอาเลขนี้เข้าเอกสารใหม่ (เลขเดิมยังอยู่ที่เอกสารเก่า)"),
        bullet("ยืนยันฝาก — ย้ายมาจุดใหม่: ย้ายเลข PO นี้ออกจากเอกสารเก่า มาเข้าเอกสารใหม่ที่กำลังสแกน"),
        img("18_duplicate_warning.png"),
        caption("รูปที่ 20: หน้าต่างเตือนพบเอกสารซ้ำในระบบ"),

        // ===== Status table =====
        h1("ตารางสรุปสถานะเอกสาร"),
        statusTable,
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, "คู่มือการใช้งาน-เมนูส่งเอกสาร-สแกนเอกสาร.docx");
  fs.writeFileSync(out, buf);
  console.log("WROTE", out, buf.length, "bytes");
});
