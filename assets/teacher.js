/* หน้าตรวจของครู: ดูทุกข้อพร้อมเฉลย ติ๊ก "ถูก / ต้องแก้" ใส่โน้ต แล้วคัดลอกผลตรวจส่งให้ noob_dev แก้
   ผลตรวจเก็บไว้บนเครื่องนี้ (กลับมาตรวจต่อได้) ไม่ได้ส่งไปไหนเอง */
(function () {
  'use strict';
  const view = document.getElementById('view');
  const KEYS = ['ก', 'ข', 'ค', 'ง', 'จ'];
  const get = (k, d) => { try { const v = localStorage.getItem('tiw:review:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem('tiw:review:' + k, JSON.stringify(v)); } catch (e) {} };
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const rich = (tag, text, cls) => { const e = h(tag, { class: cls }); String(text || '').split('\n').forEach((l, i) => { if (i) e.append(h('br')); e.append(document.createTextNode(l)); }); return e; };
  const math = (el) => { if (window.renderMathInElement) try { window.renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) {} return el; };

  async function main() {
    const idx = await (await fetch('sets/index.json', { cache: 'no-cache' })).json();
    const id = new URLSearchParams(location.search).get('set');
    if (!id) {
      view.replaceChildren(h('h1', {}, 'เลือกชุดที่จะตรวจ'),
        h('p', { class: 'lead' }, 'ชุดที่ยังไม่ผ่านการตรวจ เด็กจะยังมองไม่เห็น ตรวจครบแล้วส่งผลตรวจให้ noob_dev เพื่อแก้และเปิดให้เด็กใช้'),
        h('div', { class: 'grid two' }, idx.sets.map((s) => {
          const r = get(s.id, {}); const done = Object.values(r).filter((x) => x && x.mark).length;
          const sc = (idx.schools.find((x) => x.id === s.school) || {}).name || '';
          return h('a', { class: 'card set', href: '?set=' + s.id }, h('strong', {}, `แนว${sc} · ${s.subject} · ${s.title}`),
            h('span', { class: 'meta' }, `${s.questions} ข้อ · ${s.minutes} นาที · ตรวจแล้ว ${done}/${s.questions}`),
            h('span', {}, s.reviewed ? h('span', { class: 'tag' }, 'เปิดให้เด็กใช้แล้ว') : h('span', { class: 'tag warn' }, 'ยังไม่เปิดให้เด็ก')));
        })),
        h('p', { style: 'margin-top:16px' }, h('a', { href: './?preview=1' }, 'ลองทำข้อสอบแบบเด็ก (รวมชุดที่ยังไม่ผ่านการตรวจ) →')));
      return;
    }
    const meta = idx.sets.find((s) => s.id === id); if (!meta) throw new Error('ไม่พบชุดนี้');
    const set = await (await fetch('sets/' + meta.file, { cache: 'no-cache' })).json();
    const rev = get(id, {});
    const save = () => { put(id, rev); drawSum(); };
    const sum = h('div', { class: 'sum' });
    function drawSum() {
      const v = Object.values(rev); const ok = v.filter((x) => x && x.mark === 'ok').length, fix = v.filter((x) => x && x.mark === 'fix').length;
      const left = set.questions.length - ok - fix;
      sum.replaceChildren(h('strong', {}, `ถูก ${ok} · ต้องแก้ ${fix} · ยังไม่ตรวจ ${left}`),
        h('button', { class: 'btn p block', type: 'button', onclick: copy }, left ? `คัดลอกผลตรวจ (ยังเหลือ ${left} ข้อ)` : 'คัดลอกผลตรวจ ส่งให้ noob_dev'));
    }
    async function copy() {
      const lines = [`ผลตรวจชุด ${id} (${set.subject} ${set.title})`];
      set.questions.forEach((q, i) => {
        const r = rev[q.id] || {};
        lines.push(`ข้อ ${i + 1} [${q.id}]: ${r.mark === 'ok' ? 'ถูก' : r.mark === 'fix' ? 'ต้องแก้' : 'ยังไม่ตรวจ'}${r.note ? ' — ' + r.note.replace(/\s+/g, ' ') : ''}`);
      });
      const text = lines.join('\n');
      try { await navigator.clipboard.writeText(text); alert('คัดลอกแล้ว วางในแชทส่งให้ noob_dev ได้เลย'); }
      catch (e) { const t = h('textarea', { readonly: true }, text); sum.append(t); t.select(); alert('คัดลอกอัตโนมัติไม่ได้ เลือกข้อความในกล่องด้านล่างแล้วคัดลอกเอง'); }
    }
    const cards = set.questions.map((q, i) => {
      const r = rev[q.id] || (rev[q.id] = { mark: '', note: '' });
      const radio = (val, label) => h('label', {}, h('input', { type: 'radio', name: 'm-' + q.id, value: val, checked: r.mark === val, onchange: () => { r.mark = val; save(); } }), label);
      return h('article', { class: 'card stack' },
        h('p', { class: 'qno' }, `ข้อ ${i + 1} · ${q.topic} · ${q.type === 'num' ? 'เติมตัวเลข' : 'ปรนัย'} · ${q.id}`),
        rich('div', q.text, 'qtext'),
        q.image ? h('p', {}, h('img', { src: 'sets/' + q.image, alt: q.imageAlt || '' })) : null,
        q.type === 'num' ? h('p', {}, 'คำตอบ: ', h('span', { class: 'ans' }, String(q.answer) + (q.unit ? ' ' + q.unit : '')))
          : h('ol', { class: 'choicelist', type: '1' }, q.choices.map((c, k) => { const li = rich('li', `${KEYS[k]}. ${c}`, k === q.answer ? 'correct' : ''); if (k === q.answer) li.append(' ✓'); return li; })),
        h('div', { class: 'exp' }, h('strong', {}, 'วิธีคิด'), h('ol', {}, (q.steps || []).map((s) => rich('li', s))), q.tip ? h('p', { class: 'muted' }, '💡 ' + q.tip) : null),
        h('div', { class: 'mark' }, radio('ok', '✓ ถูก ใช้ได้'), radio('fix', '✗ ต้องแก้')),
        h('label', { class: 'f' }, 'โน้ตถึง noob_dev (ถ้าต้องแก้ บอกว่าผิดตรงไหน)', h('textarea', { oninput: (e) => { r.note = e.target.value; save(); } }, r.note || '')));
    });
    view.replaceChildren(h('p', {}, h('a', { href: 'teacher.html' }, '← ทุกชุด')),
      h('h1', {}, `${set.subject} · ${set.title}`),
      h('p', { class: 'lead' }, `${set.questions.length} ข้อ · ${set.minutes} นาที · เช็กโจทย์ ตัวเลือก คำตอบ และวิธีคิดทุกข้อ`),
      h('div', { class: 'stack' }, cards), sum);
    math(view); drawSum();
  }
  main().catch((e) => view.replaceChildren(h('h1', {}, 'โหลดไม่ได้'), h('p', { class: 'note' }, e.message)));
})();
