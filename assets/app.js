/* ติวกับนูบ — ข้อสอบแนวสอบเข้า ม.1
   หน้าเดียว ใช้ hash เป็นเส้นทาง:  #/  ·  #/start/<set>  ·  #/exam/<set>  ·  #/result/<set>
   ทุกอย่างทำงานบนเครื่องผู้สอบ ส่งผลไปที่ Google Sheet ของครูเฉพาะเมื่อมีรหัสห้อง */
(function () {
  'use strict';
  const CFG = window.TIW_CONFIG || {};
  const PREVIEW = new URLSearchParams(location.search).has('preview');   // ครูดูชุดที่ยังไม่ผ่านการตรวจ
  const view = document.getElementById('view');
  if (PREVIEW) document.getElementById('previewBadge').hidden = false;

  /* ---------- storage (localStorage อาจถูกปิดได้: ห้ามพัง) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tiw:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tiw:' + k, JSON.stringify(v)); } catch (e) { /* โหมดส่วนตัว */ } },
    del(k) { try { localStorage.removeItem('tiw:' + k); } catch (e) {} },
  };

  /* ---------- helpers ---------- */
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  // ข้อความโจทย์: ข้อความล้วน + ขึ้นบรรทัดใหม่ด้วย \n + สูตรใน $...$ (ไม่รับ HTML)
  const rich = (tag, text, cls) => {
    const e = h(tag, { class: cls });
    String(text || '').split('\n').forEach((line, i) => { if (i) e.append(h('br')); e.append(document.createTextNode(line)); });
    return e;
  };
  const math = (el) => {
    if (window.renderMathInElement) {
      try { window.renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) {}
    }
    return el;
  };
  const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), r = s % 60; return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; };
  const KEYS = ['ก', 'ข', 'ค', 'ง', 'จ'];
  const ICONS = { 'คณิตศาสตร์': '📐', 'วิทยาศาสตร์': '🔬', 'ภาษาอังกฤษ': '🔤' };
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  // ตัวเลขที่ผู้สอบพิมพ์: 0.5  1/2  1 1/2  3,000  -2
  function parseNum(raw) {
    let s = String(raw || '').trim().replace(/,/g, '').replace(/\s+/g, ' ');
    if (!s) return null;
    let m = s.match(/^(-?\d+) (\d+)\/(\d+)$/);
    if (m) { const w = +m[1], n = +m[2], d = +m[3]; return d ? (w < 0 ? w - n / d : w + n / d) : null; }
    m = s.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (m) return +m[2] ? +m[1] / +m[2] : null;
    return /^-?\d+(\.\d+)?$/.test(s) ? +s : null;
  }
  const isRight = (q, a) => {
    if (a == null || a === '') return false;
    if (q.type === 'num') { const x = parseNum(a), y = parseNum(q.answer); return x != null && y != null && Math.abs(x - y) < 1e-6; }
    return Number(a) === Number(q.answer);
  };

  /* ---------- data ---------- */
  let INDEX = null; const SETS = {};
  async function loadIndex() {
    if (INDEX) return INDEX;
    const r = await fetch('sets/index.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('โหลดรายการข้อสอบไม่ได้');
    INDEX = await r.json(); return INDEX;
  }
  async function loadSet(id) {
    if (SETS[id]) return SETS[id];
    const idx = await loadIndex(); const meta = idx.sets.find((s) => s.id === id);
    if (!meta || (!meta.reviewed && !PREVIEW)) throw new Error('ไม่พบชุดข้อสอบนี้');
    const r = await fetch('sets/' + meta.file, { cache: 'no-cache' });
    if (!r.ok) throw new Error('โหลดข้อสอบไม่ได้');
    const set = await r.json(); set.meta = meta; set.schoolName = (idx.schools.find((x) => x.id === meta.school) || {}).name || '';
    SETS[id] = set; return set;
  }
  const visibleSets = (idx) => idx.sets.filter((s) => s.reviewed || PREVIEW);

  /* ---------- sending results to the teacher's sheet ---------- */
  async function flushOutbox() {
    if (!CFG.SHEET_URL || PREVIEW) return;
    const box = store.get('outbox', []); if (!box.length) return;
    const left = [];
    for (const p of box) {
      try {
        // text/plain = ไม่มี preflight; no-cors = อ่านคำตอบไม่ได้ จึงถือว่าส่งแล้วเมื่อไม่มี error ทางเครือข่าย
        await fetch(CFG.SHEET_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) });
      } catch (e) { left.push(p); }
    }
    store.set('outbox', left);
    return left.length === 0;
  }

  /* ---------- pages ---------- */
  /* ---------- profile / level ---------- */
  const LEVELS = { m1: 'ม.1', m4: 'ม.4' };
  const profile = () => ({ nick: '', room: '', level: 'm1', ...store.get('profile', {}) });
  const saveProfile = (p) => store.set('profile', { ...profile(), ...p });
  const levelOf = (idx, setMeta) => ((idx.schools.find((x) => x.id === setMeta.school) || {}).level) || 'm1';
  const allAttempts = (idx) => {   // every attempt on this device, newest first
    const out = [];
    for (const s of idx.sets) for (const a of store.get('attempts:' + s.id, [])) out.push({ ...a, set: s });
    return out.sort((a, b) => b.at - a.at);
  };

  async function pageHome() {
    const idx = await loadIndex();
    const sets = visibleSets(idx);
    const me = profile();
    let lv = LEVELS[me.level] ? me.level : 'm1';
    const levelsWithSets = Object.keys(LEVELS).filter((k) => idx.schools.some((sc) => (sc.level || 'm1') === k && sets.some((s) => s.school === sc.id)));
    if (levelsWithSets.length && !levelsWithSets.includes(lv)) lv = levelsWithSets[0];   // saved level has no sets yet
    view.replaceChildren(
      h('section', { class: 'hero' },
        h('h1', {}, me.nick ? `สวัสดี ${me.nick} 👋` : `ข้อสอบแนวสอบเข้า ${LEVELS[lv]}`),
        h('p', { class: 'lead' }, 'เลือกชุดที่อยากฝึก ทำให้เหมือนวันสอบจริง แล้วดูว่าหัวข้อไหนควรทบทวน'),
        h('ul', { class: 'feats' }, h('li', {}, '⏱️ จับเวลาเหมือนจริง'), h('li', {}, '📊 รู้จุดที่ต้องทบทวน'), h('li', {}, '💡 เฉลยทีละขั้น'))),
      h('div', { class: 'seg', role: 'tablist', 'aria-label': 'เลือกระดับ' }, Object.entries(LEVELS).map(([k, name]) =>
        h('button', { type: 'button', role: 'tab', class: 'seg-b', 'aria-selected': String(k === lv), disabled: !levelsWithSets.includes(k) && k !== lv,
          onclick: () => { saveProfile({ level: k }); render(); } }, `สอบเข้า ${name}`))),
      ...idx.schools.filter((sc) => (sc.level || 'm1') === lv).map((sc) => {
        const list = sets.filter((s) => s.school === sc.id);
        return h('section', { class: 'school' },
          h('h2', {}, 'แนว' + sc.name),
          list.length ? h('div', { class: 'grid two' }, list.map((s) => {
            const tries = store.get('attempts:' + s.id, []);
            const last = tries[tries.length - 1];
            return h('a', { class: 'card set', href: '#/start/' + s.id },
              h('span', { class: 'ico', 'aria-hidden': 'true' }, ICONS[s.subject] || '📝'),
              h('strong', {}, `${s.subject} · ${s.title}`),
              h('span', { class: 'meta' }, `${s.questions} ข้อ · ${s.minutes} นาที`),
              h('span', { class: 'tags' }, !s.reviewed ? h('span', { class: 'tag warn' }, 'ยังไม่ผ่านการตรวจ') : null,
                last ? h('span', { class: 'tag good' }, `ทำแล้ว ${tries.length} ครั้ง · ล่าสุด ${last.score}/${last.total}`) : null),
              h('span', { class: 'go', 'aria-hidden': 'true' }, '›'));
          })) : h('p', { class: 'muted' }, 'กำลังเตรียมข้อสอบ เร็วๆ นี้'));
      }),
    );
  }

  async function pageStart(id) {
    const set = await loadSet(id);
    const prof = profile();
    const active = store.get('active:' + id, null);
    const nick = h('input', { type: 'text', id: 'nick', maxlength: '20', autocomplete: 'nickname', value: prof.nick, required: true });
    const room = h('input', { type: 'text', id: 'room', maxlength: '12', autocomplete: 'off', value: prof.room, style: 'text-transform:uppercase' });
    const err = h('p', { class: 'note', role: 'alert', hidden: true });
    const startBtn = h('button', { class: 'btn p block', type: 'submit' }, active ? 'ทำต่อจากที่ค้างไว้' : 'เริ่มทำข้อสอบ');
    const form = h('form', { class: 'card stack', onsubmit: (e) => {
      e.preventDefault();
      const n = nick.value.trim();
      if (!n) { err.textContent = 'ใส่ชื่อเล่นก่อนนะ'; err.hidden = false; nick.focus(); return; }
      saveProfile({ nick: n, room: room.value.trim().toUpperCase() });
      if (!active) {
        const now = Date.now();
        store.set('active:' + id, { startedAt: now, deadline: now + set.minutes * 60000, answers: {}, flags: {}, cur: 0 });
      }
      go('#/exam/' + id);
    } },
      h('label', { class: 'f', for: 'nick' }, 'ชื่อเล่น', h('small', {}, 'ไม่ต้องใส่ชื่อจริง'), nick),
      h('label', { class: 'f', for: 'room' }, 'รหัสห้อง (ถ้ามี)', h('small', {}, 'ครูจะบอกรหัส ถ้าใส่ ครูจะเห็นคะแนนของเรา ถ้าไม่ใส่ คะแนนอยู่บนเครื่องนี้อย่างเดียว'), room),
      err, startBtn);
    view.replaceChildren(
      h('p', { class: 'muted' }, 'แนว' + set.schoolName),
      h('h1', {}, `${set.subject} · ${set.title}`),
      h('ul', { class: 'card rules' },
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '📝'), h('span', {}, `${set.questions.length} ข้อ · ${set.minutes} นาที`)),
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '🤫'), h('span', {}, 'ระหว่างทำจะไม่บอกว่าถูกหรือผิด เหมือนสนามสอบจริง')),
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '⏱️'), h('span', {}, 'หมดเวลาแล้วส่งให้อัตโนมัติ ปิดหน้าไปก่อนก็กลับมาทำต่อได้ แต่เวลายังเดินอยู่')),
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '💡'), h('span', {}, 'ส่งแล้วเห็นคะแนน คะแนนแยกหัวข้อ และเฉลยทีละขั้นทุกข้อ'))),
      set.note ? h('p', { class: 'note' }, set.note) : null,
      h('div', { style: 'margin-top:16px' }, form),
    );
    nick.focus();
  }

  let ticker = null;
  async function pageExam(id) {
    const set = await loadSet(id);
    const st = store.get('active:' + id, null);
    if (!st) return go('#/start/' + id);
    const Q = set.questions;
    const save = () => store.set('active:' + id, st);
    const timer = h('span', { class: 'timer', role: 'timer', 'aria-live': 'off' });
    const prog = h('span', { class: 'progress' });
    const progFill = h('i', { style: 'width:0%' });
    const qbox = h('div', { class: 'card qcard' });
    const dots = h('nav', { class: 'dots', 'aria-label': 'ไปที่ข้อ' });

    const answeredCount = () => Q.filter((q) => st.answers[q.id] != null && st.answers[q.id] !== '').length;
    function drawDots() {
      dots.replaceChildren(...Q.map((q, i) => h('button', { type: 'button', class: 'dot' + (st.answers[q.id] != null && st.answers[q.id] !== '' ? ' done' : '') + (i === st.cur ? ' cur' : '') + (st.flags[q.id] ? ' flag' : ''),
        'aria-label': `ข้อ ${i + 1}${st.answers[q.id] != null && st.answers[q.id] !== '' ? ' ตอบแล้ว' : ''}${st.flags[q.id] ? ' ทำเครื่องหมายไว้' : ''}`, 'aria-current': i === st.cur ? 'step' : null,
        onclick: () => { st.cur = i; save(); drawQ(); } }, i + 1)));
      prog.textContent = `ตอบแล้ว ${answeredCount()}/${Q.length}`;
      progFill.style.width = `${Math.round((answeredCount() / Q.length) * 100)}%`;
    }
    function drawQ() {
      const q = Q[st.cur];
      const kids = [h('p', { class: 'qno' }, `ข้อ ${st.cur + 1} จาก ${Q.length}`), rich('div', q.text, 'qtext')];
      if (q.image) kids.push(h('p', {}, h('img', { src: 'sets/' + q.image, alt: q.imageAlt || 'รูปประกอบโจทย์', loading: 'lazy' })));
      if (q.type === 'num') {
        const inp = h('input', { type: 'text', inputmode: 'decimal', id: 'ans', autocomplete: 'off', value: st.answers[q.id] ?? '', 'aria-label': 'คำตอบ',
          oninput: () => { st.answers[q.id] = inp.value.trim(); save(); drawDots(); } });
        kids.push(h('label', { class: 'f', for: 'ans' }, 'คำตอบ (ตัวเลข)', h('small', {}, q.unit ? `หน่วย: ${q.unit} · พิมพ์เศษส่วนแบบ 3/4 ได้` : 'พิมพ์เศษส่วนแบบ 3/4 หรือทศนิยมแบบ 0.75 ได้'), inp));
      } else {
        const list = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'ตัวเลือก' });
        q.choices.forEach((c, i) => {
          const b = h('button', { type: 'button', class: 'choice', role: 'radio', 'aria-checked': String(Number(st.answers[q.id]) === i && st.answers[q.id] !== '' && st.answers[q.id] != null),
            onclick: () => { st.answers[q.id] = i; save(); drawQ(); drawDots(); } }, h('span', { class: 'k', 'aria-hidden': 'true' }, KEYS[i]), rich('span', c));
          list.append(b);
        });
        kids.push(list);
      }
      const flag = h('button', { type: 'button', class: 'btn flagbtn', 'aria-pressed': String(!!st.flags[q.id]), onclick: () => { st.flags[q.id] = !st.flags[q.id]; save(); drawQ(); drawDots(); } }, st.flags[q.id] ? '🚩 ยกเลิกเครื่องหมาย' : '🚩 กลับมาดูอีกที');
      kids.push(h('div', { class: 'nav' },
        h('button', { type: 'button', class: 'btn', disabled: st.cur === 0, onclick: () => { st.cur--; save(); drawQ(); drawDots(); } }, '← ข้อก่อน'),
        flag,
        st.cur < Q.length - 1 ? h('button', { type: 'button', class: 'btn p', onclick: () => { st.cur++; save(); drawQ(); drawDots(); } }, 'ข้อถัดไป →')
          : h('button', { type: 'button', class: 'btn p', onclick: () => submit(false) }, 'ส่งข้อสอบ')));
      qbox.replaceChildren(...kids); math(qbox);
      drawDots();
    }
    function submit(auto) {
      const left = Q.length - answeredCount();
      if (!auto && left > 0 && !confirm(`ยังไม่ได้ตอบ ${left} ข้อ ส่งเลยไหม?`)) return;
      clearInterval(ticker);
      const byTopic = {};
      let score = 0;
      for (const q of Q) {
        const ok = isRight(q, st.answers[q.id]); if (ok) score++;
        const t = byTopic[q.topic] || (byTopic[q.topic] = { right: 0, total: 0 }); t.total++; if (ok) t.right++;
      }
      const tries = store.get('attempts:' + id, []);
      const prof = profile();
      const att = { n: (tries.length ? tries[tries.length - 1].n : 0) + 1, at: Date.now(), secs: Math.round((Math.min(Date.now(), st.deadline) - st.startedAt) / 1000), auto, answers: st.answers, score, total: Q.length, byTopic };
      tries.push(att); store.set('attempts:' + id, tries.slice(-20)); store.del('active:' + id);
      if (prof.room && CFG.SHEET_URL && !PREVIEW) {
        const box = store.get('outbox', []);
        box.push({ v: 1, nick: prof.nick, room: prof.room, set: id, attempt: att.n, score, total: Q.length, secs: att.secs, auto,
          byTopic: Object.entries(byTopic).map(([k, t]) => `${k} ${t.right}/${t.total}`).join(' | '),
          answers: Q.map((q) => (st.answers[q.id] == null || st.answers[q.id] === '' ? '-' : q.type === 'num' ? st.answers[q.id] : KEYS[st.answers[q.id]])).join(','),
          at: new Date(att.at).toISOString() });
        store.set('outbox', box);
      }
      go('#/result/' + id);
    }
    const tick = () => {
      const left = (st.deadline - Date.now()) / 1000;
      timer.textContent = '⏱️ ' + fmtTime(left);
      timer.classList.toggle('low', left < 300);
      if (left <= 0) submit(true);
    };
    view.replaceChildren(
      h('div', { class: 'examhead' },
        h('div', { class: 'row' }, h('div', {}, h('div', { class: 'ttl' }, `${set.subject} · ${set.title}`), prog), timer),
        h('div', { class: 'prog-line', role: 'presentation' }, progFill)),
      qbox, h('p', { class: 'dots-title' }, 'ไปที่ข้อ (สีฟ้า = ตอบแล้ว · ขอบส้ม = กลับมาดูอีกที)'), dots,
      h('p', { style: 'margin-top:20px' }, h('button', { type: 'button', class: 'btn block', onclick: () => submit(false) }, 'ส่งข้อสอบ')),
    );
    drawQ(); tick(); clearInterval(ticker); ticker = setInterval(tick, 500);
  }

  async function pageResult(id, n) {
    const set = await loadSet(id);
    const tries = store.get('attempts:' + id, []);
    const att = n ? tries.find((t) => t.n === Number(n)) : tries[tries.length - 1];
    if (!att) return go('#/start/' + id);
    const prof = profile();
    const pct = Math.round((att.score / att.total) * 100);
    const sendNote = h('p', { class: 'muted' });
    if (n && att !== tries[tries.length - 1]) sendNote.textContent = `กำลังดูผลย้อนหลัง ครั้งที่ ${att.n} · ${new Date(att.at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`;
    else if (PREVIEW) sendNote.textContent = 'โหมดตรวจของครู: ไม่ส่งผลเข้า Google Sheet';
    else if (!prof.room) sendNote.textContent = 'ไม่ได้ใส่รหัสห้อง คะแนนนี้อยู่บนเครื่องนี้อย่างเดียว';
    else if (!CFG.SHEET_URL) sendNote.textContent = 'ครูยังไม่ได้เชื่อม Google Sheet คะแนนนี้อยู่บนเครื่องนี้อย่างเดียว';
    else { sendNote.textContent = 'กำลังส่งคะแนนให้ครู…'; flushOutbox().then((ok) => { sendNote.textContent = ok ? `ส่งคะแนนให้ครูแล้ว (ห้อง ${prof.room})` : 'ยังส่งคะแนนไม่ได้ (ไม่มีเน็ต?) จะลองส่งใหม่ตอนเปิดแอปครั้งหน้า'; }); }

    const topics = Object.entries(att.byTopic).sort((a, b) => a[1].right / a[1].total - b[1].right / b[1].total);
    const reviewList = set.questions.map((q, i) => {
      const a = att.answers[q.id];
      const ok = isRight(q, a);
      const yours = a == null || a === '' ? 'ไม่ได้ตอบ' : q.type === 'num' ? String(a) : `${KEYS[a]}. ${q.choices[a]}`;
      const right = q.type === 'num' ? String(q.answer) + (q.unit ? ' ' + q.unit : '') : `${KEYS[q.answer]}. ${q.choices[q.answer]}`;
      const card = h('article', { class: 'card rev ' + (ok ? 'right' : 'wrong') },
        h('p', { class: 'qno' }, `ข้อ ${i + 1} · ${q.topic}`),
        rich('div', q.text, 'qtext'),
        q.image ? h('p', {}, h('img', { src: 'sets/' + q.image, alt: q.imageAlt || 'รูปประกอบโจทย์', loading: 'lazy' })) : null,
        h('p', { class: 'verdict ' + (ok ? 'right' : 'wrong') }, ok ? '✓ ถูก' : '✗ ยังไม่ถูก'),
        h('p', {}, 'คำตอบของเรา: ', rich('span', yours)),
        ok ? null : h('p', {}, 'คำตอบที่ถูก: ', rich('span', right)),
        h('div', { class: 'exp' }, h('strong', {}, 'วิธีคิด'), h('ol', {}, (q.steps || []).map((s) => rich('li', s))), q.tip ? h('p', { class: 'muted' }, '💡 ' + q.tip) : null));
      return card;
    });
    view.replaceChildren(
      h('p', { class: 'muted' }, `แนว${set.schoolName} · ${set.subject} · ${set.title} · ครั้งที่ ${att.n}`),
      h('h1', {}, att.auto ? 'หมดเวลา ส่งให้อัตโนมัติแล้ว' : 'ส่งข้อสอบแล้ว'),
      h('div', { class: 'card stack' },
        h('div', { class: 'scorecard' },
          h('div', { class: 'ring', role: 'img', 'aria-label': `ได้ ${att.score} จาก ${att.total} คะแนน (${pct}%)`, style: `--p:${pct};--ring:${pct >= 70 ? '#3FA66A' : pct >= 40 ? '#E0A43A' : '#E58A62'}` },
            h('span', {}, `${att.score}/${att.total}`, h('small', {}, `${pct}%`))),
          h('div', {},
            h('p', { class: 'cheer' }, pct >= 80 ? 'เยี่ยมมาก! พร้อมสนามจริงแล้ว 🎉' : pct >= 60 ? 'ทำได้ดี อีกนิดเดียว 💪' : pct >= 40 ? 'มาถูกทางแล้ว ทบทวนหัวข้อด้านล่างนะ' : 'ไม่เป็นไร ค่อยๆ ดูเฉลยแล้วลองใหม่ 🙂'),
            h('p', { class: 'muted' }, `ใช้เวลา ${fmtTime(att.secs)} จาก ${set.minutes} นาที`))),
        sendNote),
      h('h2', {}, 'คะแนนแยกหัวข้อ'),
      h('p', { class: 'muted' }, 'เรียงจากหัวข้อที่ควรทบทวนก่อน'),
      h('div', { class: 'card stack' }, topics.map(([name, t]) => {
        const tp = Math.round((t.right / t.total) * 100);
        return h('div', { class: 'topic' },
          h('span', {}, name), h('span', { class: 'muted' }, `${t.right}/${t.total}`),
          h('div', { class: 'bar ' + (tp >= 70 ? 'good' : tp >= 40 ? 'mid' : 'low') }, h('i', { style: `width:${Math.max(tp, 2)}%` })));
      })),
      h('h2', {}, 'เฉลยทีละข้อ'),
      h('div', { class: 'stack' }, reviewList),
      h('div', { class: 'grid two', style: 'margin-top:24px' },
        h('a', { class: 'btn', href: '#/' }, 'กลับหน้าแรก'),
        h('button', { type: 'button', class: 'btn p', onclick: () => { store.del('active:' + id); go('#/start/' + id); } }, 'ทำชุดนี้อีกครั้ง')),
    );
    math(view);
  }

  /* ---------- my scores (device history) ---------- */
  async function pageMe() {
    const idx = await loadIndex();
    const me = profile();
    const sets = idx.sets.filter((s) => s.reviewed || PREVIEW);
    const done = sets.map((s) => ({ s, tries: store.get('attempts:' + s.id, []) })).filter((x) => x.tries.length);
    const total = done.reduce((a, x) => a + x.tries.length, 0);
    const mins = Math.round(done.reduce((a, x) => a + x.tries.reduce((b, t) => b + (t.secs || 0), 0), 0) / 60);
    const body = [h('h1', {}, 'คะแนนของฉัน'), h('p', { class: 'lead' }, me.nick ? `${me.nick}${me.room ? ' · ห้อง ' + me.room : ''}` : 'ยังไม่ได้ตั้งชื่อเล่น (ตั้งได้ที่แท็บ "ฉัน")')];
    if (!done.length) {
      body.push(h('div', { class: 'card empty' }, h('p', { class: 'big', 'aria-hidden': 'true' }, '📝'), h('p', {}, 'ยังไม่มีคะแนน ลองทำข้อสอบสักชุดดูนะ'), h('a', { class: 'btn p', href: '#/' }, 'ไปเลือกชุดข้อสอบ')));
    } else {
      body.push(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, String(total)), h('span', {}, 'ครั้งที่ทำ')),
        h('div', { class: 'stat' }, h('b', {}, String(done.length)), h('span', {}, 'ชุดที่ลอง')),
        h('div', { class: 'stat' }, h('b', {}, String(mins)), h('span', {}, 'นาทีที่ฝึก'))));
      for (const { s, tries } of done) {
        const best = Math.max(...tries.map((t) => t.score)); const last = tries[tries.length - 1];
        const sc = idx.schools.find((x) => x.id === s.school) || {};
        body.push(h('section', { class: 'card stack' },
          h('div', { class: 'row-between' }, h('div', {}, h('strong', {}, `${s.subject} · ${s.title}`), h('div', { class: 'meta' }, `แนว${sc.name || ''} · ${LEVELS[sc.level || 'm1']}`)),
            h('div', { class: 'best' }, h('b', {}, `${best}/${last.total}`), h('span', {}, 'ดีที่สุด'))),
          h('div', { class: 'spark', role: 'img', 'aria-label': 'คะแนนแต่ละครั้ง' }, tries.slice(-12).map((t) => h('i', { title: `ครั้งที่ ${t.n}: ${t.score}/${t.total}`, style: `height:${Math.max(6, Math.round((t.score / t.total) * 100))}%` }))),
          h('ul', { class: 'hist' }, [...tries].reverse().slice(0, 5).map((t) => h('li', {},
            h('a', { href: `#/result/${s.id}/${t.n}` }, `ครั้งที่ ${t.n}`), h('span', { class: 'muted' }, new Date(t.at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })), h('b', {}, `${t.score}/${t.total}`)))),
          h('div', { class: 'grid two' }, h('a', { class: 'btn', href: `#/result/${s.id}` }, 'ดูเฉลยครั้งล่าสุด'), h('a', { class: 'btn p', href: `#/start/${s.id}` }, 'ทำอีกครั้ง'))));
      }
    }
    view.replaceChildren(...body);
  }

  /* ---------- ranking in the room (from the teacher's sheet) ---------- */
  const rankCache = {};
  async function sheetGet(params) {
    if (!CFG.SHEET_URL) throw new Error('nosheet');
    const key = JSON.stringify(params);
    const c = rankCache[key]; if (c && Date.now() - c.t < 60000) return c.v;
    const r = await fetch(CFG.SHEET_URL + '?' + new URLSearchParams(params), { redirect: 'follow' });
    const v = await r.json(); rankCache[key] = { t: Date.now(), v }; return v;
  }
  async function pageRank() {
    const idx = await loadIndex(); const me = profile();
    const out = h('div', { class: 'stack' });
    view.replaceChildren(h('h1', {}, 'อันดับในห้อง'), h('p', { class: 'lead' }, 'เทียบคะแนนที่ดีที่สุดของแต่ละคนในห้องเดียวกัน แสดงเฉพาะชื่อเล่นกับคะแนน'), out);
    if (!me.room) { out.append(h('div', { class: 'card empty' }, h('p', { class: 'big', 'aria-hidden': 'true' }, '🏁'), h('p', {}, 'ใส่รหัสห้องก่อน ถึงจะดูอันดับได้'), h('a', { class: 'btn p', href: '#/profile' }, 'ตั้งรหัสห้อง'))); return; }
    const mine = idx.sets.filter((s) => (s.reviewed || PREVIEW) && store.get('attempts:' + s.id, []).length);
    const sets = mine.length ? mine : idx.sets.filter((s) => s.reviewed || PREVIEW);
    const sel = h('select', { id: 'rk-set', 'aria-label': 'เลือกชุดข้อสอบ' }, sets.map((s) => h('option', { value: s.id }, `${s.subject} · แนว${(idx.schools.find((x) => x.id === s.school) || {}).name || ''} ${s.title}`)));
    const list = h('div', { class: 'card stack', 'aria-live': 'polite' });
    out.append(h('p', {}, h('span', { class: 'tag' }, `ห้อง ${me.room}`)), h('label', { class: 'f', for: 'rk-set' }, 'ชุดข้อสอบ', sel), list);
    async function load() {
      list.replaceChildren(h('p', { class: 'muted' }, 'กำลังโหลดอันดับ…'));
      try {
        const r = await sheetGet({ action: 'rank', room: me.room, set: sel.value });
        if (!r || r.ok === false) throw new Error('bad');
        const rows = r.rows || [];
        if (!rows.length) { list.replaceChildren(h('p', { class: 'muted' }, 'ยังไม่มีใครในห้องนี้ทำชุดนี้ เป็นคนแรกเลยไหม 🙂')); return; }
        const meIdx = rows.findIndex((x) => String(x.nick).toLowerCase() === me.nick.toLowerCase());
        const top = rows.slice(0, 10);
        const items = top.map((x, i) => h('li', { class: 'rk' + (i === meIdx ? ' me' : '') },
          h('span', { class: 'pos' }, i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)), h('span', { class: 'nm' }, x.nick + (i === meIdx ? ' (เรา)' : '')),
          h('span', { class: 'sc' }, `${x.best}/${x.total}`)));
        if (meIdx >= 10) items.push(h('li', { class: 'rk me' }, h('span', { class: 'pos' }, String(meIdx + 1)), h('span', { class: 'nm' }, rows[meIdx].nick + ' (เรา)'), h('span', { class: 'sc' }, `${rows[meIdx].best}/${rows[meIdx].total}`)));
        list.replaceChildren(
          meIdx >= 0 ? h('p', { class: 'cheer' }, `เราอยู่อันดับ ${meIdx + 1} จาก ${rows.length} คน`) : h('p', { class: 'muted' }, `มี ${rows.length} คนทำชุดนี้แล้ว (ยังไม่เห็นชื่อ "${me.nick}" ลองทำชุดนี้ดูนะ)`),
          h('ol', { class: 'ranklist' }, items));
      } catch (e) {
        list.replaceChildren(h('p', { class: 'note' }, e.message === 'nosheet' ? 'ครูยังไม่ได้เชื่อม Google Sheet' : 'ตอนนี้ยังดูอันดับไม่ได้ (ไม่มีเน็ต หรือครูยังไม่ได้อัปเดตสคริปต์) ลองใหม่ภายหลังนะ'));
      }
    }
    sel.addEventListener('change', load); load();
  }

  /* ---------- me / profile ---------- */
  async function pageProfile() {
    const idx = await loadIndex(); const me = profile();
    const nick = h('input', { type: 'text', id: 'p-nick', maxlength: '20', value: me.nick, autocomplete: 'nickname' });
    const room = h('input', { type: 'text', id: 'p-room', maxlength: '12', value: me.room, autocomplete: 'off', style: 'text-transform:uppercase' });
    const status = h('p', { class: 'muted', role: 'status' });
    const lvl = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'ระดับที่สอบ' });
    let level = LEVELS[me.level] ? me.level : 'm1';
    const drawLvl = () => lvl.replaceChildren(...Object.entries(LEVELS).map(([k, name]) => h('button', { type: 'button', role: 'radio', class: 'seg-b', 'aria-checked': String(k === level), onclick: () => { level = k; drawLvl(); } }, `สอบเข้า ${name}`)));
    drawLvl();
    async function check() {
      const r = room.value.trim().toUpperCase();
      if (!r) { status.textContent = 'ไม่ใส่รหัสห้อง = คะแนนอยู่บนเครื่องนี้อย่างเดียว'; return; }
      if (!CFG.SHEET_URL) { status.textContent = 'ครูยังไม่ได้เชื่อม Google Sheet'; return; }
      status.textContent = 'กำลังเช็กรหัสห้อง…';
      try { const v = await sheetGet({ action: 'room', room: r }); status.textContent = v && v.valid ? `✓ รหัสห้อง ${r} ใช้ได้ คะแนนจะส่งให้ครู` : v && v.ok ? `✗ ไม่พบรหัสห้อง ${r} ถามครูอีกทีนะ` : 'เช็กไม่ได้ตอนนี้ (ครูอาจยังไม่ได้อัปเดตสคริปต์) แต่ลองส่งคะแนนได้เหมือนเดิม'; }
      catch (e) { status.textContent = 'เช็กไม่ได้ตอนนี้ (ไม่มีเน็ต?)'; }
    }
    const att = allAttempts(idx);
    view.replaceChildren(
      h('h1', {}, 'ฉัน'),
      h('form', { class: 'card stack', onsubmit: (e) => { e.preventDefault(); saveProfile({ nick: nick.value.trim(), room: room.value.trim().toUpperCase(), level }); status.textContent = '✓ บันทึกแล้ว'; } },
        h('label', { class: 'f', for: 'p-nick' }, 'ชื่อเล่น', h('small', {}, 'ไม่ต้องใส่ชื่อจริง ชื่อนี้จะโชว์ในอันดับของห้อง'), nick),
        h('label', { class: 'f', for: 'p-room' }, 'รหัสห้อง', h('small', {}, 'ครูเป็นคนบอก'), room),
        h('div', { class: 'f' }, h('span', { style: 'font-weight:500' }, 'ระดับที่สอบ'), lvl),
        status,
        h('div', { class: 'grid two' }, h('button', { type: 'button', class: 'btn', onclick: check }, 'เช็กรหัสห้อง'), h('button', { type: 'submit', class: 'btn p' }, 'บันทึก'))),
      h('section', { class: 'card stack' },
        h('strong', {}, 'ข้อมูลบนเครื่องนี้'),
        h('p', { class: 'muted' }, `ทำข้อสอบแล้ว ${att.length} ครั้ง · ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้ ถ้าเปลี่ยนเครื่องหรือล้างเบราว์เซอร์ ประวัติจะหาย (แต่ครูยังเห็นคะแนนที่ส่งแล้ว)`),
        h('button', { type: 'button', class: 'btn', onclick: () => { if (confirm('ลบประวัติคะแนนและโปรไฟล์บนเครื่องนี้ทั้งหมด? (ที่ส่งให้ครูแล้วจะไม่หาย)')) { try { Object.keys(localStorage).filter((k) => k.startsWith('tiw:')).forEach((k) => localStorage.removeItem(k)); } catch (e) {} go('#/'); } } }, 'ลบข้อมูลบนเครื่องนี้')));
  }

  /* ---------- bottom tabs ---------- */
  const TABS = [['home', '#/', '🏠', 'หน้าแรก'], ['me', '#/me', '📊', 'คะแนน'], ['rank', '#/rank', '🏆', 'อันดับ'], ['profile', '#/profile', '👤', 'ฉัน']];
  function drawTabs(active, show) {
    const nav = document.getElementById('tabs'); if (!nav) return;
    nav.hidden = !show; document.body.classList.toggle('has-tabs', show);
    nav.replaceChildren(...TABS.map(([k, href, ico, label]) => h('a', { href, class: 'tab', 'aria-current': k === active ? 'page' : null }, h('span', { 'aria-hidden': 'true' }, ico), h('span', {}, label))));
  }

  /* ---------- router ---------- */
  async function render() {
    clearInterval(ticker);
    const [, page, id, n] = (location.hash.replace(/^#\/?/, '').match(/^([a-z]*)\/?([\w-]*)\/?(\d*)/) || []);
    const exam = page === 'exam' && !!id;
    document.body.classList.toggle('in-exam', exam);
    try {
      if (page === 'start' && id) { drawTabs('home', true); await pageStart(id); }
      else if (exam) { drawTabs('home', false); await pageExam(id); }
      else if (page === 'result' && id) { drawTabs(n ? 'me' : 'home', true); await pageResult(id, n); }
      else if (page === 'me') { drawTabs('me', true); await pageMe(); }
      else if (page === 'rank') { drawTabs('rank', true); await pageRank(); }
      else if (page === 'profile') { drawTabs('profile', true); await pageProfile(); }
      else { drawTabs('home', true); await pageHome(); }
    } catch (e) {
      view.replaceChildren(h('h1', {}, 'ขอโทษ มีบางอย่างผิดพลาด'), h('p', { class: 'note' }, e.message), h('p', {}, h('a', { href: '#/' }, 'กลับหน้าแรก')));
    }
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', render);
  render();
  flushOutbox();
})();
