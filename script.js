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

function inline(text, { chips = true } = {}) {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  if (chips) {
    s = s.split(HEADPHONE).join(
      '<button type="button" class="chip-audio" data-chip data-state="empty">' +
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

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    const head = /^(#{1,4})\s+(.*)$/.exec(raw);
    if (head) {
      flush();
      const level = head[1].length;
      let text = head[2];
      if (level === 4 && /^Track\s/.test(text)) text += ' ' + HEADPHONE;
      out.push(`<h${level} id="${slug(head[2])}">${inline(text)}</h${level}>`);
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
    if (ol) { pushItem('ol', Number(ol[1]), inline(ol[2])); continue; }

    const ul = /^[-*+]\s+(.*)$/.exec(raw);
    if (ul) { pushItem('ul', 0, inline(ul[1])); continue; }

    flush();
    out.push(`<p>${inline(raw)}</p>`);
  }
  flush();
  return out.join('\n');
}

/* ═══════════ 2. TÁCH SÁCH THÀNH CÁC MỤC ═══════════ */

const book = { front: [], sections: [], notes: [], index: [] };

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

    sec.lessons = [];
    let head = null;
    for (const line of sec.lines) {
      const h3 = /^###\s+(.+)$/.exec(line);
      if (h3) {
        head = { id: slug(h3[1]), title: h3[1].trim() };
        sec.lessons.push(head);
        continue;
      }
      if (/^#{1,4}\s/.test(line) || !line.trim() || line.startsWith('>')) continue;
      book.index.push({
        sec, head,
        text: line.replace(/[*`#]/g, '').replace(new RegExp(HEADPHONE, 'gu'), '').trim()
      });
    }
  });
}

/* ═══════════ 3. AUDIO ═══════════ */

const audioFiles = (window.AUDIO_FILES || []).map((f, i) => ({ ...f, i }));
const byName = new Map(audioFiles.map((f) => [f.name, f]));

const audio      = $('#audio');
const playerEl   = $('#player');
const seekEl     = $('#seek');
const RATES      = [0.75, 1, 1.25, 1.5, 2];

let assignments  = store.get('assign', {});
let currentFile  = null;
let assignTarget = null;                              // key của chip đang chờ gán

const fmtTime = (s) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};
const fileLabel = (f) => `Nhóm ${f.group} · bài ${f.index}`;

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
    $('#npTitle').textContent = file.name;
    $('#npSub').textContent = fileLabel(file);
    if ('mediaSession' in navigator && typeof MediaMetadata === 'function') {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: file.name, artist: fileLabel(file),
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

function openLibrary(chipKey = null) {
  assignTarget = chipKey;
  $('#libTitle').textContent = chipKey ? 'Gán audio cho bài nghe này' : 'Thư viện audio';
  $('#libHint').textContent = chipKey
    ? 'Chọn một tệp để gán và phát — lựa chọn được nhớ lại lần sau.'
    : `${audioFiles.length} tệp · bấm để phát`;
  $('#btnUnassign').hidden = !(chipKey && assignments[chipKey]);
  libraryEl.hidden = false;
  renderLibrary();
  setTimeout(() => $('#libSearch').focus(), 60);
}

function closeLibrary() {
  libraryEl.hidden = true;
  assignTarget = null;
}

function renderLibrary() {
  if (libraryEl.hidden) return;
  const q = $('#libSearch').value.trim().toLowerCase();
  const hits = audioFiles.filter((f) => !q || f.name.toLowerCase().includes(q));
  const list = $('#libList');

  if (!hits.length) {
    list.innerHTML = '<p class="empty">Không có tệp nào khớp.</p>';
    return;
  }

  let html = '', group = null;
  for (const f of hits) {
    if (f.group !== group) {
      group = f.group;
      html += `<div class="lib-group">Nhóm ${group}</div>`;
    }
    const cur = currentFile && currentFile.name === f.name;
    html += `<button class="lib-item${cur ? ' is-current' : ''}" data-file="${esc(f.name)}">
      <span class="dot">${cur && !audio.paused ? '▮▮' : '▶'}</span>
      <span class="nm">${esc(f.name)}</span>
      <span class="sub">bài ${f.index}</span>
    </button>`;
  }
  list.innerHTML = html;
}

$('#libList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-file]');
  if (!btn) return;
  const file = byName.get(btn.dataset.file);
  if (!file) return;
  if (assignTarget) {
    assignments[assignTarget] = file.name;
    store.set('assign', assignments);
    toast(`Đã gán ${file.name} cho bài nghe này.`);
    closeLibrary();
  }
  play(file);
});

$('#libSearch').addEventListener('input', renderLibrary);
$('#btnLibrary').addEventListener('click', () => openLibrary());
$('#btnUnassign').addEventListener('click', () => {
  if (!assignTarget) return;
  delete assignments[assignTarget];
  store.set('assign', assignments);
  refreshChips();
  closeLibrary();
  toast('Đã bỏ gán.');
});
$$('[data-close]', libraryEl).forEach((el) => el.addEventListener('click', closeLibrary));

if (store.get('warnHidden', false)) $('#libWarn').hidden = true;
$('#btnWarnHide').addEventListener('click', () => {
  $('#libWarn').hidden = true;
  store.set('warnHidden', true);
});

/* ── Chip 🎧 trong nội dung ───────────────────────────────── */
function refreshChips() {
  $$('#docBody [data-chip]').forEach((chip) => {
    const file = byName.get(assignments[chip.dataset.key]);
    const label = chip.querySelector('.chip-label');
    if (!file) {
      chip.dataset.state = 'empty';
      label.textContent = 'Chọn audio';
      chip.title = 'Chưa gán tệp audio — bấm để chọn';
      return;
    }
    const playing = currentFile && currentFile.name === file.name && !audio.paused;
    chip.dataset.state = playing ? 'playing' : 'ready';
    label.textContent = file.name.replace(/^br2_003_/, '').replace(/\.mp3$/, '');
    chip.title = `${file.name} — bấm để phát; Shift+bấm (hoặc nhấn giữ) để đổi tệp`;
  });
}

$('#docBody').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (!chip) return;
  const file = byName.get(assignments[chip.dataset.key]);
  if (!file || e.shiftKey) { openLibrary(chip.dataset.key); return; }
  if (currentFile && currentFile.name === file.name && !audio.paused) { audio.pause(); return; }
  play(file);
});

/* nhấn giữ trên điện thoại = đổi tệp đã gán */
$('#docBody').addEventListener('contextmenu', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (!chip) return;
  e.preventDefault();
  openLibrary(chip.dataset.key);
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
      <p>${s.lessons.length ? esc(s.lessons.map((l) => l.title).join(' · ')) : 'Mở để xem nội dung'}</p>
    </button>`;
  $('#unitGrid').innerHTML  = units.map(card).join('');
  $('#extraGrid').innerHTML = others.map(card).join('');

  /* số liệu + ghi chú trên trang chủ */
  const lessons = book.sections.reduce((n, s) => n + s.lessons.length, 0);
  const audios  = book.sections.reduce((n, s) => n + s.audioCount, 0);
  $('#heroStats').innerHTML =
    `<span>${units.length} unit</span><span>${lessons} bài học</span>` +
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
  $$('#docBody [data-chip]').forEach((chip, i) => { chip.dataset.key = `${sec.id}#${i}`; });
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
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
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
    const res = await fetch('business-result.md', { cache: 'no-cache' });
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
      '<p class="empty">Không đọc được <code>business-result.md</code> và cũng không thấy ' +
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
    toast('Không thấy tệp audio nào — kiểm tra lại book-data.js.');
  }
})();

})();
