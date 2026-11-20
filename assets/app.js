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
  async function pageHome() {
    const idx = await loadIndex();
    const sets = visibleSets(idx);
    view.replaceChildren(
      h('h1', {}, 'ข้อสอบแนวสอบเข้า ม.1'),
      h('p', { class: 'lead' }, 'คณิตศาสตร์และวิทยาศาสตร์ จับเวลาเหมือนสนามจริง ส่งแล้วเห็นคะแนนแยกหัวข้อ พร้อมเฉลยทีละขั้นทุกข้อ'),
      ...idx.schools.map((sc) => {
        const list = sets.filter((s) => s.school === sc.id);
        return h('section', { class: 'school' },
          h('h2', {}, 'แนว' + sc.name),
          list.length ? h('div', { class: 'grid two' }, list.map((s) => {
            const tries = store.get('attempts:' + s.id, []);
            return h('a', { class: 'card set', href: '#/start/' + s.id },
              h('strong', {}, `${s.subject} · ${s.title}`),
              h('span', { class: 'meta' }, `${s.questions} ข้อ · ${s.minutes} นาที`),
              h('span', {}, !s.reviewed ? h('span', { class: 'tag warn' }, 'ยังไม่ผ่านการตรวจ') : null, tries.length ? h('span', { class: 'tag' }, `ทำแล้ว ${tries.length} ครั้ง · ล่าสุด ${tries[tries.length - 1].score}/${tries[tries.length - 1].total}`) : null));
          })) : h('p', { class: 'muted' }, 'กำลังเตรียมข้อสอบ เร็วๆ นี้'));
      }),
    );
  }

  async function pageStart(id) {
    const set = await loadSet(id);
    const prof = store.get('profile', { nick: '', room: '' });
    const active = store.get('active:' + id, null);
    const nick = h('input', { type: 'text', id: 'nick', maxlength: '20', autocomplete: 'nickname', value: prof.nick, required: true });
    const room = h('input', { type: 'text', id: 'room', maxlength: '12', autocomplete: 'off', value: prof.room, style: 'text-transform:uppercase' });
    const err = h('p', { class: 'note', role: 'alert', hidden: true });
    const startBtn = h('button', { class: 'btn p block', type: 'submit' }, active ? 'ทำต่อจากที่ค้างไว้' : 'เริ่มทำข้อสอบ');
    const form = h('form', { class: 'card stack', onsubmit: (e) => {
      e.preventDefault();
      const n = nick.value.trim();
      if (!n) { err.textContent = 'ใส่ชื่อเล่นก่อนนะ'; err.hidden = false; nick.focus(); return; }
      store.set('profile', { nick: n, room: room.value.trim().toUpperCase() });
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
      h('ul', { class: 'card stack', style: 'list-style:none' },
        h('li', {}, `📝 ${set.questions.length} ข้อ · ⏱️ ${set.minutes} นาที`),
        h('li', {}, 'ระหว่างทำจะไม่บอกว่าถูกหรือผิด เหมือนสนามสอบจริง'),
        h('li', {}, 'หมดเวลาแล้วระบบจะส่งให้อัตโนมัติ ปิดหน้าไปก่อนก็กลับมาทำต่อได้ แต่เวลายังเดินอยู่'),
        h('li', {}, 'ส่งแล้วจะเห็นคะแนน คะแนนแยกหัวข้อ และเฉลยทีละขั้นทุกข้อ')),
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
    const qbox = h('div', { class: 'q' });
    const dots = h('nav', { class: 'dots', 'aria-label': 'ไปที่ข้อ' });

    const answeredCount = () => Q.filter((q) => st.answers[q.id] != null && st.answers[q.id] !== '').length;
    function drawDots() {
      dots.replaceChildren(...Q.map((q, i) => h('button', { type: 'button', class: 'dot' + (st.answers[q.id] != null && st.answers[q.id] !== '' ? ' done' : '') + (i === st.cur ? ' cur' : '') + (st.flags[q.id] ? ' flag' : ''),
        'aria-label': `ข้อ ${i + 1}${st.answers[q.id] != null && st.answers[q.id] !== '' ? ' ตอบแล้ว' : ''}${st.flags[q.id] ? ' ทำเครื่องหมายไว้' : ''}`, 'aria-current': i === st.cur ? 'step' : null,
        onclick: () => { st.cur = i; save(); drawQ(); } }, i + 1)));
      prog.textContent = `ตอบแล้ว ${answeredCount()}/${Q.length}`;
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
      const prof = store.get('profile', { nick: '', room: '' });
      const att = { n: tries.length + 1, at: Date.now(), secs: Math.round((Math.min(Date.now(), st.deadline) - st.startedAt) / 1000), auto, answers: st.answers, score, total: Q.length, byTopic };
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
      h('div', { class: 'examhead' }, h('div', {}, h('strong', {}, `${set.subject} · ${set.title}`), h('br'), prog), timer),
      qbox, dots,
      h('p', { style: 'margin-top:20px' }, h('button', { type: 'button', class: 'btn block', onclick: () => submit(false) }, 'ส่งข้อสอบ')),
    );
    drawQ(); tick(); clearInterval(ticker); ticker = setInterval(tick, 500);
  }

  async function pageResult(id) {
    const set = await loadSet(id);
    const tries = store.get('attempts:' + id, []);
    const att = tries[tries.length - 1];
    if (!att) return go('#/start/' + id);
    const prof = store.get('profile', { nick: '', room: '' });
    const pct = Math.round((att.score / att.total) * 100);
    const sendNote = h('p', { class: 'muted' });
    if (PREVIEW) sendNote.textContent = 'โหมดตรวจของครู: ไม่ส่งผลเข้า Google Sheet';
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
        h('p', { class: 'score' }, `${att.score}/${att.total}`),
        h('div', { class: 'bar', role: 'img', 'aria-label': `ได้ ${pct}%` }, h('i', { style: `width:${pct}%` })),
        h('p', { class: 'muted' }, `${pct}% · ใช้เวลา ${fmtTime(att.secs)} จาก ${set.minutes} นาที`),
        sendNote),
      h('h2', {}, 'คะแนนแยกหัวข้อ'),
      h('p', { class: 'muted' }, 'เรียงจากหัวข้อที่ควรทบทวนก่อน'),
      h('div', { class: 'card stack' }, topics.map(([name, t]) => h('div', { class: 'topic' },
        h('span', {}, name), h('span', { class: 'muted' }, `${t.right}/${t.total}`),
        h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((t.right / t.total) * 100)}%` }))))),
      h('h2', {}, 'เฉลยทีละข้อ'),
      h('div', { class: 'stack' }, reviewList),
      h('div', { class: 'grid two', style: 'margin-top:24px' },
        h('a', { class: 'btn', href: '#/' }, 'กลับหน้าแรก'),
        h('button', { type: 'button', class: 'btn p', onclick: () => { store.del('active:' + id); go('#/start/' + id); } }, 'ทำชุดนี้อีกครั้ง')),
    );
    math(view);
  }

  /* ---------- router ---------- */
  async function render() {
    clearInterval(ticker);
    const [, page, id] = (location.hash.replace(/^#\/?/, '').match(/^([a-z]*)\/?([\w-]*)/) || []);
    try {
      if (page === 'start' && id) await pageStart(id);
      else if (page === 'exam' && id) await pageExam(id);
      else if (page === 'result' && id) await pageResult(id);
      else await pageHome();
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
