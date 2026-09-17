/* ═══════════════════════════════════════════════════════════
   English for International Tourism — reader
   Trình đọc sách + trình phát audio, không phụ thuộc thư viện ngoài.
   ═══════════════════════════════════════════════════════════ */
(() => {
'use strict';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const HEADPHONE = '\u{1F3A7}';

/* ── localStorage an toàn ─────────────────────────────────── */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('eit:' + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('eit:' + key, JSON.stringify(value)); } catch { /* chế độ riêng tư */ }
  },
  del(key) {
    try { localStorage.removeItem('eit:' + key); } catch { /* chế độ riêng tư */ }
  }
};

/* ═══════════ 1. MARKDOWN → HTML ═══════════ */

const slug = (text) => text
  .replace(/[*`]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s-]/gu, '')
  .trim()
  .replace(/\s+/g, '-');

const esc = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text, { chips = true, track = null } = {}) {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  if (chips) {
    s = s.split(HEADPHONE).join(
      '<button type="button" class="chip-audio" data-chip' +
      (track ? ` data-track="${track}"` : '') + ' data-state="empty">' +
      HEADPHONE + '<span class="chip-label">Chọn audio</span></button>'
    );
  }
  return s;
}

/** Markdown của riêng file này: mỗi khối là một dòng, cách nhau bằng dòng trống. */
function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let list = null;                                   // {tag, items:[], last}

  const flush = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
    list = null;
  };

  const pushItem = (tag, num, html) => {
    if (list && (list.tag !== tag || (tag === 'ol' && num !== list.last + 1))) flush();
    if (!list) list = { tag, items: [], last: 0 };
    list.items.push(tag === 'ol' ? `<li data-n="${num}">${html}</li>` : `<li>${html}</li>`);
    list.last = num;
  };

  /* "… Track 1.1 …" trên một dòng → mọi dấu 🎧 của dòng đó phát audio/Track1_1.mp3 */
  const trackOf = (line) => {
    const m = /Track\s*(\d+)\.(\d+)/.exec(line);
    return m ? `${m[1]}_${m[2]}` : null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    const track = trackOf(raw);

    /* Khối gập <details> — dùng cho lời thoại và đáp án.
       Nội dung bên trong thụt hai dấu cách; bỏ thụt rồi dựng đệ quy.
       Thẻ mở CÓ thụt lề → khối thuộc mục danh sách phía trên, nhét vào <li>
       cuối để script nằm gọn dưới đúng cái track của nó.
       Thẻ mở ở lề 0 → khối đứng riêng (đáp án của cả bài tập). */
    const det = /^\s*<details(\s[^>]*)?>\s*(?:<summary>([\s\S]*?)<\/summary>)?\s*$/.exec(raw);
    if (det) {
      let summary = det[2] || 'Mở ra xem';
      const buf = [];
      let depth = 1;
      for (i++; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*<details\b/.test(line)) depth++;
        if (/^\s*<\/details>\s*$/.test(line)) { if (--depth === 0) break; }
        const sum = /^\s*<summary>([\s\S]*?)<\/summary>\s*$/.exec(line);
        if (sum && depth === 1 && !det[2]) { summary = sum[1]; continue; }
        buf.push(line.replace(/^ {2}/, ''));
      }
      /* gộp class của tác giả vào .fold thay vì sinh hai attribute class */
      const attrs = det[1] || '';
      const cls = /class="([^"]*)"/.exec(attrs);
      const html = `<details class="fold${cls ? ' ' + cls[1] : ''}"` +
        `${attrs.replace(/\s*class="[^"]*"/, '')}>` +
        `<summary>${inline(summary, { chips: false })}</summary>` +
        `<div class="fold-body">${mdToHtml(buf.join('\n'))}</div></details>`;
      if (/^\s+</.test(raw) && list && list.items.length) {
        list.items[list.items.length - 1] =
          list.items[list.items.length - 1].replace(/<\/li>$/, html + '</li>');
      } else {
        flush();
        out.push(html);
      }
      continue;
    }

    const head = /^(#{1,4})\s+(.*)$/.exec(raw);
    if (head) {
      flush();
      const level = head[1].length;
      let text = head[2];
      /* heading "#### Track 1.1" trong Audio Script chưa có 🎧 — thêm vào */
      if (level === 4 && /^Track\s+\d+\.\d+/.test(text)) text += ' ' + HEADPHONE;
      out.push(`<h${level} id="${slug(head[2])}">${inline(text, { track })}</h${level}>`);
      continue;
    }

    /* bảng: dòng | a | b | theo sau là dòng phân cách | --- | --- | */
    if (raw.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '')
          .split('|').map((c) => c.trim()));
        i++;
      }
      i--;
      const row = (tag, cells) => `<tr>${cells.map((c) =>
        `<${tag}>${inline(c, { track: trackOf(c) })}</${tag}>`).join('')}</tr>`;
      out.push('<div class="table-wrap"><table>' +
        `<thead>${row('th', rows[0])}</thead>` +
        `<tbody>${rows.slice(2).map((r) => row('td', r)).join('')}</tbody>` +
        '</table></div>');
      continue;
    }

    if (raw.startsWith('>')) {                       // blockquote (gộp dòng liền kề)
      flush();
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      i--;
      const warn = /⚠️|Thiếu nội dung|Khoảng trống/.test(buf.join(' '));
      out.push(`<blockquote${warn ? ' class="warn"' : ''}>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }

    const ol = /^(\d{1,2})\.\s+(.*)$/.exec(raw);
    if (ol) { pushItem('ol', Number(ol[1]), inline(ol[2], { track })); continue; }

    const ul = /^[-*+]\s+(.*)$/.exec(raw);
    if (ul) { pushItem('ul', 0, inline(ul[1], { track })); continue; }

    flush();
    out.push(`<p>${inline(raw, { track })}</p>`);
  }
  flush();
  return out.join('\n');
}

/* ═══════════ 2. TÁCH SÁCH THÀNH CÁC MỤC ═══════════ */

const book = { front: [], sections: [], notes: [], index: [], anchors: new Map() };

function parseBook(md) {
  let current = null;
  for (const line of md.split('\n')) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      current = { title: m[1].trim(), lines: [] };
      book.sections.push(current);
      continue;
    }
    (current ? current.lines : book.front).push(line);
  }

  book.notes = book.front.filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, ''));

  book.sections = book.sections.filter((s) => s.title !== 'Mục lục');

  book.sections.forEach((sec) => {
    const md = sec.lines.join('\n');
    sec.id = slug(sec.title);
    sec.md = md;
    sec.html = `<h2>${inline(sec.title)}</h2>\n` + mdToHtml(md);
    sec.audioCount = (md.match(new RegExp(HEADPHONE, 'gu')) || []).length
                   + (md.match(/^#### Track /gm) || []).length;

    const unit = /^Unit\s+(\d+)\s*—\s*(.+)$/.exec(sec.title);
    sec.isUnit = Boolean(unit);
    sec.num = unit ? unit[1] : null;
    sec.shortTitle = unit ? unit[2] : sec.title;

    /* dòng ghi chú mở đầu mục — dùng làm mô tả trên thẻ ở trang chủ */
    const intro = sec.lines.find((l) => l.startsWith('> ') && !/⚠️/.test(l));
    sec.tagline = intro ? intro.replace(/^>\s?/, '').replace(/[*`]/g, '') : '';

    /* mọi tiêu đề đều là điểm neo, để [liên kết](#…) trong nội dung nhảy đúng chỗ */
    book.anchors.set(sec.id, { secId: sec.id, headId: null });

    sec.lessons = [];
    let head = null;
    for (const line of sec.lines) {
      const anchor = /^#{3,4}\s+(.+)$/.exec(line);
      if (anchor) {
        const id = slug(anchor[1]);
        if (!book.anchors.has(id)) book.anchors.set(id, { secId: sec.id, headId: id });
      }

      const h3 = /^###\s+(.+)$/.exec(line);
      if (h3) {
        head = { id: slug(h3[1]), title: h3[1].trim() };
        sec.lessons.push(head);
        continue;
      }
      if (/^#{1,4}\s/.test(line) || !line.trim() || line.startsWith('>')) continue;
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;      // dòng phân cách của bảng
      if (/^\s*<\/?(details|summary)\b/.test(line)) continue;  // vỏ khối gập
      book.index.push({
        sec, head,
        text: line.replace(/[*`#]/g, '').replace(/\s*\|\s*/g, ' · ')
          .replace(new RegExp(HEADPHONE, 'gu'), '').trim()
      });
    }
  });
}

/* ═══════════ 3. AUDIO ═══════════ */

/* Thư mục audio/ dùng tên TrackU_N.mp3 — U là unit (1–10), N là track thứ N của unit.
   TRACKS_PER_UNIT[u] = số track của unit u+1, khớp đúng các tệp hiện có.
   Nếu book-data.js được sinh lại và có liệt kê các tệp Track* thì lấy theo đó;
   danh sách br2_* cũ (Business Result) bị bỏ qua vì không còn tệp trên đĩa. */
const TRACK_RE = /^Track(\d+)_(\d+)\.mp3$/i;
const TRACKS_PER_UNIT = [5, 6, 5, 3, 4, 5, 4, 5, 5, 3];

const audioNames = (() => {
  const listed = (window.AUDIO_FILES || [])
    .map((f) => (f && f.name) || '').filter((n) => TRACK_RE.test(n));
  if (listed.length) return listed;
  const names = [];
  TRACKS_PER_UNIT.forEach((count, u) => {
    for (let n = 1; n <= count; n++) names.push(`Track${u + 1}_${n}.mp3`);
  });
  return names;
})();

const audioFiles = audioNames
  .map((name) => {
    const [, unit, index] = TRACK_RE.exec(name);
    return { name, src: 'audio/' + name, unit: Number(unit), index: Number(index) };
  })
  .sort((a, b) => a.unit - b.unit || a.index - b.index)
  .map((f, i) => ({ ...f, i, track: `${f.unit}.${f.index}`, key: `${f.unit}_${f.index}` }));

const byName  = new Map(audioFiles.map((f) => [f.name, f]));
const byTrack = new Map(audioFiles.map((f) => [f.key, f]));

const audio      = $('#audio');
const playerEl   = $('#player');
const seekEl     = $('#seek');
const RATES      = [0.75, 1, 1.25, 1.5, 2];

let currentFile = null;

store.del('assign');           // bỏ các gán tay của bản cũ — nay khớp track tự động

const fmtTime = (s) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};
const fileTitle = (f) => `Track ${f.track}`;
const fileLabel = (f) => `Unit ${f.unit} · ${f.name}`;

function setSeekFill() {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  seekEl.style.setProperty('--pct', pct + '%');
  if (!seekEl.dataset.dragging) seekEl.value = String(Math.round(pct * 10));
  $('#npCur').textContent = fmtTime(audio.currentTime);
  $('#npDur').textContent = fmtTime(audio.duration);
}

function play(file, { silent = false } = {}) {
  if (!file) return;
  if (currentFile !== file) {
    currentFile = file;
    audio.src = encodeURI(file.src);
    audio.playbackRate = store.get('rate', 1);
    playerEl.dataset.empty = 'false';
    $('#npTitle').textContent = fileTitle(file);
    $('#npSub').textContent = fileLabel(file);
    if ('mediaSession' in navigator && typeof MediaMetadata === 'function') {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: fileTitle(file), artist: fileLabel(file),
          album: 'English for International Tourism'
        });
      } catch { /* trình duyệt không hỗ trợ */ }
    }
  }
  audio.play().catch(() => { if (!silent) toast('Trình duyệt chặn tự động phát — bấm ▶ để nghe.'); });
  refreshChips();
  renderLibrary();
}

function step(delta) {
  if (!currentFile) return;
  const next = audioFiles[(currentFile.i + delta + audioFiles.length) % audioFiles.length];
  play(next);
}

audio.addEventListener('timeupdate', setSeekFill);
audio.addEventListener('loadedmetadata', setSeekFill);
audio.addEventListener('play',  () => { playerEl.classList.add('is-playing'); refreshChips(); });
audio.addEventListener('pause', () => { playerEl.classList.remove('is-playing'); refreshChips(); });
audio.addEventListener('ended', () => { if (!audio.loop) step(1); });
audio.addEventListener('error', () => {
  if (audio.src) toast('Không mở được tệp audio. Kiểm tra thư mục audio còn nguyên không.');
});

$('#btnPlay').addEventListener('click', () => {
  if (!currentFile) { openLibrary(); return; }
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
});
$('#btnPrev').addEventListener('click', () => step(-1));
$('#btnNext').addEventListener('click', () => step(1));

seekEl.addEventListener('input', () => {
  seekEl.dataset.dragging = '1';
  seekEl.style.setProperty('--pct', (seekEl.value / 10) + '%');
});
seekEl.addEventListener('change', () => {
  delete seekEl.dataset.dragging;
  if (audio.duration) audio.currentTime = (seekEl.value / 1000) * audio.duration;
});

$('#btnRate').addEventListener('click', () => {
  const now = store.get('rate', 1);
  const next = RATES[(RATES.indexOf(now) + 1) % RATES.length];
  store.set('rate', next);
  audio.playbackRate = next;
  $('#btnRate').textContent = next + '×';
});

$('#btnLoop').addEventListener('click', (e) => {
  audio.loop = !audio.loop;
  e.currentTarget.setAttribute('aria-pressed', String(audio.loop));
  toast(audio.loop ? 'Bật lặp lại một bài.' : 'Tắt lặp lại.');
});

/* ── Thư viện audio ───────────────────────────────────────── */
const libraryEl = $('#library');

function openLibrary() {
  $('#libHint').textContent = `${audioFiles.length} tệp · bấm để phát`;
  $('#libSearch').value = '';
  libraryEl.hidden = false;
  renderLibrary();
  setTimeout(() => $('#libSearch').focus(), 60);
}

function closeLibrary() {
  libraryEl.hidden = true;
}

function renderLibrary() {
  if (libraryEl.hidden) return;
  const q = $('#libSearch').value.trim().toLowerCase();
  const hits = audioFiles.filter((f) => !q ||
    `${f.name} track ${f.track} unit ${f.unit}`.toLowerCase().includes(q));
  const list = $('#libList');

  if (!hits.length) {
    list.innerHTML = '<p class="empty">Không có tệp nào khớp.</p>';
    return;
  }

  let html = '', unit = null;
  for (const f of hits) {
    if (f.unit !== unit) {
      unit = f.unit;
      html += `<div class="lib-group">Unit ${unit}</div>`;
    }
    const cur = currentFile && currentFile.name === f.name;
    html += `<button class="lib-item${cur ? ' is-current' : ''}" data-file="${esc(f.name)}">
      <span class="dot">${cur && !audio.paused ? '▮▮' : '▶'}</span>
      <span class="nm">Track ${f.track}</span>
      <span class="sub">${esc(f.name)}</span>
    </button>`;
  }
  list.innerHTML = html;
}

$('#libList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-file]');
  const file = btn && byName.get(btn.dataset.file);
  if (file) play(file);
});

$('#libSearch').addEventListener('input', renderLibrary);
$('#btnLibrary').addEventListener('click', () => openLibrary());
$$('[data-close]', libraryEl).forEach((el) => el.addEventListener('click', closeLibrary));

if (store.get('audioNoteHidden', false)) $('#libWarn').hidden = true;
$('#btnWarnHide').addEventListener('click', () => {
  $('#libWarn').hidden = true;
  store.set('audioNoteHidden', true);
});

/* ── Chip 🎧 trong nội dung ───────────────────────────────── */

const chipFile = (chip) => byTrack.get(chip.dataset.track);

function refreshChips() {
  $$('#docBody [data-chip]').forEach((chip) => {
    const file = chipFile(chip);
    const label = chip.querySelector('.chip-label');
    if (!file) {                      // chỗ sách nhắc "listen" nhưng không có bản ghi
      chip.dataset.state = 'empty';   // (đóng vai theo cặp, phim DVD…)
      chip.disabled = true;
      label.textContent = 'Không có bản ghi';
      chip.title = 'Bộ audio không có tệp cho chỗ này';
      return;
    }
    const playing = currentFile === file && !audio.paused;
    chip.dataset.state = playing ? 'playing' : 'ready';
    label.textContent = `Track ${file.track}`;
    chip.title = `${file.name} — bấm để ${playing ? 'dừng' : 'phát'}`;
  });
}

$('#docBody').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  const file = chip && chipFile(chip);
  if (!file) return;
  if (currentFile === file && !audio.paused) { audio.pause(); return; }
  play(file);
});

/* ═══════════ 4. ĐIỀU HƯỚNG & HIỂN THỊ ═══════════ */

const views = { home: $('#viewHome'), doc: $('#viewDoc'), search: $('#viewSearch') };
let activeSection = null;

function showView(name) {
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== name; });
}

function buildChrome() {
  const units  = book.sections.filter((s) => s.isUnit);
  const others = book.sections.filter((s) => !s.isUnit);

  /* thẻ chọn unit trên thanh trên cùng */
  const sel = $('#unitSelect');
  sel.innerHTML =
    '<option value="">📖 Trang chủ</option>' +
    `<optgroup label="Unit">${units.map((s) =>
      `<option value="${s.id}">Unit ${s.num} — ${esc(s.shortTitle)}</option>`).join('')}</optgroup>` +
    `<optgroup label="Phần khác">${others.map((s) =>
      `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</optgroup>`;
  sel.addEventListener('change', () => { go(sel.value || null); });

  /* mục lục bên trái */
  $('#toc').innerHTML = book.sections.map((s) => `
    <div class="toc-group" data-group="${s.id}">
      <button class="toc-sec" data-go="${s.id}">
        <span class="num">${s.isUnit ? s.num : '§'}</span>
        <span class="label">${esc(s.isUnit ? s.shortTitle : s.title)}</span>
      </button>
      <div class="toc-lessons">${s.lessons.map((l) =>
        `<button class="toc-lesson" data-go="${s.id}" data-head="${l.id}">${esc(l.title)}</button>`
      ).join('')}</div>
    </div>`).join('');

  /* thẻ trên trang chủ */
  const card = (s) => `
    <button class="card" data-go="${s.id}">
      <span class="card-top">
        <span class="card-num">${s.isUnit ? 'Unit ' + s.num : '§'}</span>
        ${s.audioCount ? `<span class="card-audio">${HEADPHONE} ${s.audioCount}</span>` : ''}
      </span>
      <h3>${esc(s.isUnit ? s.shortTitle : s.title)}</h3>
      <p>${esc(s.tagline ||
        (s.lessons.length ? s.lessons.map((l) => l.title).join(' · ') : 'Mở để xem nội dung'))}</p>
    </button>`;
  $('#unitGrid').innerHTML  = units.map(card).join('');
  $('#extraGrid').innerHTML = others.map(card).join('');

  /* số liệu + ghi chú trên trang chủ */
  const lessons = book.sections.reduce((n, s) => n + s.lessons.length, 0);
  const audios  = book.sections.reduce((n, s) => n + s.audioCount, 0);
  $('#heroStats').innerHTML =
    `<span>${units.length} unit</span><span>${lessons} mục</span>` +
    `<span>${HEADPHONE} ${audios} chỗ nghe</span><span>${audioFiles.length} tệp mp3</span>`;
  $('#homeNotes').innerHTML = book.notes
    .map((n) => `<div class="note">${inline(n, { chips: false })}</div>`).join('');
}

function go(sectionId, headId = null, { push = true } = {}) {
  closeNav();

  if (!sectionId) {
    activeSection = null;
    showView('home');
    syncActive();
    $('#unitSelect').value = '';
    if (push) history.pushState({}, '', '#');
    window.scrollTo({ top: 0 });
    return;
  }

  const sec = book.sections.find((s) => s.id === sectionId);
  if (!sec) { go(null, null, { push }); return; }

  activeSection = sec;
  $('#docBody').innerHTML = sec.html;
  refreshChips();

  $('#crumbs').innerHTML =
    `<button data-go="">Trang chủ</button><span>›</span><span>${esc(sec.title)}</span>`;

  const at   = book.sections.indexOf(sec);
  const prev = book.sections[at - 1];
  const next = book.sections[at + 1];
  $('#pager').innerHTML =
    (prev ? `<button data-go="${prev.id}"><small>← Trước</small><span>${esc(prev.title)}</span></button>` : '') +
    (next ? `<button class="next" data-go="${next.id}"><small>Tiếp →</small><span>${esc(next.title)}</span></button>` : '');

  showView('doc');
  $('#unitSelect').value = sec.id;
  store.set('last', sec.id);
  syncActive(headId);

  if (push) history.pushState({}, '', '#' + sec.id + (headId ? '/' + headId : ''));

  if (headId) {
    const target = document.getElementById(headId);
    if (target) {
      /* tiêu đề nằm trong khối gập đang đóng thì mở ra, không thì cuộn tới chỗ trắng */
      for (let el = target.closest('details'); el; el = el.parentElement.closest('details')) {
        el.open = true;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
  window.scrollTo({ top: 0 });
}

function syncActive(headId) {
  $$('.toc-group').forEach((g) => {
    const on = activeSection && g.dataset.group === activeSection.id;
    g.classList.toggle('is-open', Boolean(on));
    $('.toc-sec', g).classList.toggle('is-active', Boolean(on));
  });
  $$('.toc-lesson').forEach((b) => b.classList.toggle('is-active', b.dataset.head === headId));
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-go]');
  if (!btn) return;
  e.preventDefault();
  go(btn.dataset.go || null, btn.dataset.head || null);
});

/* Liên kết [text](#tiêu-đề) trong nội dung và trong ghi chú trang chủ:
   nhảy sang mục chứa tiêu đề đó, không chỉ đổi hash rồi đứng im. */
document.addEventListener('click', (e) => {
  const link = e.target.closest('.prose a[href^="#"], .notes a[href^="#"]');
  if (!link) return;
  const id = decodeURIComponent(link.getAttribute('href').slice(1));
  if (!id) return;
  e.preventDefault();

  const target = book.anchors.get(id);
  if (target) { go(target.secId, target.headId); return; }

  const el = document.getElementById(id);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  toast('Không tìm thấy mục “' + id + '”.');
});

$('#btnHome').addEventListener('click', (e) => { e.preventDefault(); go(null); });

window.addEventListener('popstate', () => routeFromHash({ push: false }));

function routeFromHash({ push } = { push: false }) {
  const [sec, head] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
  go(sec || null, head || null, { push });
}

/* ═══════════ 5. TÌM KIẾM ═══════════ */

let searchTimer = null;

function runSearch(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    // chỉ quay lại nội dung khi đang ở màn hình kết quả, tránh nhảy trang khi gõ ký tự đầu
    if (!views.search.hidden) go(activeSection ? activeSection.id : null, null, { push: false });
    return;
  }

  const hits = [];
  for (const entry of book.index) {
    const at = entry.text.toLowerCase().indexOf(q);
    if (at === -1) continue;
    const from = Math.max(0, at - 60);
    const snippet = (from ? '…' : '') + entry.text.slice(from, at + q.length + 110) + '…';
    hits.push({ ...entry, snippet });
    if (hits.length >= 60) break;
  }

  $('#searchTitle').textContent = hits.length
    ? `${hits.length} kết quả cho “${query.trim()}”`
    : `Không tìm thấy “${query.trim()}”`;

  $('#searchResults').innerHTML = hits.length
    ? hits.map((h) => `
        <button class="result" data-go="${h.sec.id}"${h.head ? ` data-head="${h.head.id}"` : ''}>
          <span class="where">${esc(h.sec.title)}${h.head ? ' › ' + esc(h.head.title) : ''}</span>
          <span class="snip">${esc(h.snippet).replace(
            new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>')}</span>
        </button>`).join('')
    : '<p class="empty">Thử từ khoá khác, hoặc bỏ dấu nháy và ký tự đặc biệt.</p>';

  showView('search');
  window.scrollTo({ top: 0 });
}

$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = e.target.value;
  searchTimer = setTimeout(() => runSearch(value), 180);
});

/* ═══════════ 6. GIAO DIỆN PHỤ ═══════════ */

/* ngăn kéo mục lục trên điện thoại */
const sidebar = $('#sidebar');
const openNav  = () => {
  sidebar.classList.add('is-open');
  $('#scrim').hidden = false;
  $('#btnMenu').setAttribute('aria-expanded', 'true');
};
const closeNav = () => {
  sidebar.classList.remove('is-open');
  $('#scrim').hidden = true;
  $('#btnMenu').setAttribute('aria-expanded', 'false');
};
$('#btnMenu').addEventListener('click', () =>
  sidebar.classList.contains('is-open') ? closeNav() : openNav());
$('#btnCloseNav').addEventListener('click', closeNav);
$('#scrim').addEventListener('click', closeNav);

/* sáng / tối */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('theme', theme);
}
$('#btnTheme').addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

/* thanh tiến độ đọc */
const progressFill = $('#progressFill');
addEventListener('scroll', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  progressFill.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
}, { passive: true });

/* phím tắt */
addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

  if (e.key === 'Escape') {
    if (!libraryEl.hidden) { closeLibrary(); return; }
    if (sidebar.classList.contains('is-open')) { closeNav(); return; }
    if (typing) document.activeElement.blur();
    return;
  }
  if (typing) return;

  if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); return; }
  if (e.key === ' ') { e.preventDefault(); $('#btnPlay').click(); return; }
  if (!currentFile) return;
  if (e.key === 'ArrowRight') audio.currentTime += 5;
  if (e.key === 'ArrowLeft')  audio.currentTime -= 5;
});

/* thông báo ngắn */
let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ═══════════ 7. KHỞI ĐỘNG ═══════════ */

async function loadMarkdown() {
  try {
    const res = await fetch('english-for-international-tourism.md', { cache: 'no-cache' });
    if (res.ok) {
      const text = await res.text();
      if (text.trim().startsWith('#')) return text;
    }
  } catch { /* mở bằng file:// — dùng bản nhúng */ }
  return window.BOOK_MD || '';
}

(async function init() {
  applyTheme(store.get('theme',
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#btnRate').textContent = store.get('rate', 1) + '×';

  const md = await loadMarkdown();
  if (!md) {
    $('#docBody').innerHTML =
      '<p class="empty">Không đọc được <code>english-for-international-tourism.md</code> và cũng không thấy ' +
      '<code>book-data.js</code>. Hãy chạy trang qua một máy chủ tĩnh, ví dụ ' +
      '<code>python -m http.server</code>.</p>';
    showView('doc');
    return;
  }

  parseBook(md);
  buildChrome();

  if (location.hash.length > 1) routeFromHash();
  else go(null, null, { push: false });

  if (!audioFiles.length) {
    toast('Không thấy tệp audio nào — kiểm tra thư mục audio/ (TrackU_N.mp3).');
  }
})();

})();
