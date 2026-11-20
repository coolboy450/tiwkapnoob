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

/**
 * ดึงข้อมูลให้แอป (อ่านอย่างเดียว):
 *   ?action=room&room=SK1            -> { ok, valid }          เช็กว่ารหัสห้องมีจริงไหม
 *   ?action=rank&room=SK1&set=<id>   -> { ok, rows:[{nick,best,total,attempts}] }  อันดับในห้อง (ชื่อเล่น + คะแนนดีที่สุด)
 * ต้องรู้รหัสห้องที่มีอยู่ในชีต "ห้อง" ถึงจะดูอันดับได้ และไม่ส่งข้อมูลอื่นออกไปเลย
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'room') return out_({ ok: true, valid: roomOk_(p.room) });
    if (p.action === 'rank') return out_(rank_(p.room, p.set));
    return out_({ ok: true, app: 'tiwkapnoob' });
  } catch (err) {
    return out_({ ok: false, error: 'bad request' });
  }
}

function roomOk_(room) {
  const r = clean_(room, 12).toUpperCase();
  if (!r) return false;
  const allowed = sheet_(ROOMS, ['รหัสห้อง']).getRange('A2:A').getValues().map((x) => String(x[0]).trim().toUpperCase()).filter(String);
  return allowed.indexOf(r) >= 0;
}

function rank_(room, setId) {
  const r = clean_(room, 12).toUpperCase(), sid = clean_(setId, 40);
  if (!roomOk_(r) || !sid) return { ok: false, error: 'room' };
  const cache = CacheService.getScriptCache(), key = 'rank:' + r + ':' + sid;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const rows = sheet_(SCORES, HEADERS).getDataRange().getValues().slice(1);   // คอลัมน์: 1 ห้อง 2 ชื่อเล่น 3 ชุด 4 ครั้งที่ 5 คะแนน 6 เต็ม
  const best = {};
  rows.forEach((x) => {
    if (String(x[1]).toUpperCase() !== r || String(x[3]) !== sid) return;
    const nick = String(x[2]).replace(/^'/, ''), k = nick.toLowerCase();
    const sc = Number(x[5]), tot = Number(x[6]);
    if (!best[k]) best[k] = { nick: nick, best: sc, total: tot, attempts: 0 };
    best[k].attempts++;
    if (sc > best[k].best) best[k].best = sc;
  });
  const list = Object.keys(best).map((k) => best[k]).sort((a, b) => b.best - a.best || a.attempts - b.attempts).slice(0, 100);
  const out = { ok: true, rows: list };
  cache.put(key, JSON.stringify(out), 20);
  return out;
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** กดรันครั้งเดียวในหน้า Apps Script เพื่อสร้างชีตและให้สิทธิ์ */
function setup() {
  sheet_(ROOMS, ['รหัสห้อง']);
  sheet_(SCORES, HEADERS);
}
