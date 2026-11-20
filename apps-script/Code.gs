/**
 * ติวกับนูบ — รับคะแนนจากแอปเข้า Google Sheet ของครู
 * วิธีติดตั้งอยู่ใน docs/ตั้งค่า-google-sheet.md
 *
 * ชีตที่ใช้ (สร้างให้อัตโนมัติถ้ายังไม่มี):
 *   ห้อง   : คอลัมน์ A = รหัสห้องที่อนุญาต (เช่น P6A) แถวแรกเป็นหัวตาราง
 *   คะแนน : ทุกครั้งที่เด็กส่งข้อสอบจะเพิ่มหนึ่งแถว
 * รับเฉพาะรหัสห้องที่อยู่ในชีต "ห้อง" เท่านั้น อย่างอื่นทิ้ง
 */
const ROOMS = 'ห้อง';
const SCORES = 'คะแนน';
const HEADERS = ['เวลาส่ง', 'ห้อง', 'ชื่อเล่น', 'ชุดข้อสอบ', 'ครั้งที่', 'คะแนน', 'เต็ม', 'ร้อยละ', 'ใช้เวลา (นาที)', 'หมดเวลา', 'แยกหัวข้อ', 'คำตอบ'];

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}

function clean_(v, max) {
  // กันสูตรแปลกๆ (=, +, -, @ นำหน้า) และตัดความยาว
  let s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function doPost(e) {
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const room = clean_(p.room, 12).toUpperCase();
    const allowed = sheet_(ROOMS, ['รหัสห้อง']).getRange('A2:A').getValues().map((r) => String(r[0]).trim().toUpperCase()).filter(String);
    if (!room || allowed.indexOf(room) < 0) return out_({ ok: false, error: 'room' });
    const score = Number(p.score), total = Number(p.total);
    if (!(total > 0 && total <= 200 && score >= 0 && score <= total)) return out_({ ok: false, error: 'score' });
    sheet_(SCORES, HEADERS).appendRow([
      new Date(), room, clean_(p.nick, 20), clean_(p.set, 40), Number(p.attempt) || 1, score, total,
      Math.round((score / total) * 100), Math.round((Number(p.secs) || 0) / 6) / 10, p.auto ? 'ใช่' : '',
      clean_(p.byTopic, 500), clean_(p.answers, 600),
    ]);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: 'bad request' });
  }
}

function doGet() { return out_({ ok: true, app: 'tiwkapnoob' }); }

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** กดรันครั้งเดียวในหน้า Apps Script เพื่อสร้างชีตและให้สิทธิ์ */
function setup() {
  sheet_(ROOMS, ['รหัสห้อง']);
  sheet_(SCORES, HEADERS);
}
