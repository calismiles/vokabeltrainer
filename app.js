'use strict';
/* Vokabeltrainer – Lernkartei (5 Fächer), Eintippen mit strenger Rechtschreibprüfung,
   Lückensätze, Testvorbereitung. Alle Daten bleiben im Browser (localStorage). */

// ---------- Konstanten ----------
const LANGS = {
  en: { name: 'Englisch', tts: 'en-GB', accents: [] },
  fr: { name: 'Französisch', tts: 'fr-FR',
        accents: ['é', 'è', 'ê', 'ë', 'à', 'â', 'ç', 'î', 'ï', 'ô', 'ù', 'û', 'œ', 'É', 'À', 'Ç'] },
};
// Tage bis zur nächsten Abfrage, wenn eine Karte in Fach n landet (Fach 5 wiederholt: 30)
const INTERVAL = [0, 1, 2, 4, 8, 16];
const BOX_NAMES = ['neu', 'Fach 1', 'Fach 2', 'Fach 3', 'Fach 4', 'Fach 5'];
const BOX_COLORS = ['var(--box0)', 'var(--box1)', 'var(--box2)', 'var(--box3)', 'var(--box4)', 'var(--box5)'];
const DIR_LABEL = { p: 'Deutsch → Fremdsprache', r: 'Fremdsprache → Deutsch', mix: 'gemischt' };
const DEFAULT_SETTINGS = { dir: 'p', goal: 20, newPerSession: 10, sessionMax: 25, speak: true, lang: 'en', selected: { en: [], fr: [] } };

// ---------- Speicher ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { toast('Speichern fehlgeschlagen!'); }
  },
};

const S = {
  builtin: [],                                          // Units aus data/*.json
  user: store.get('vt-user-decks', []),                 // selbst angelegte Units
  progress: store.get('vt-progress', {}),               // "wortId|richtung" -> {b, d, n, w}
  settings: Object.assign({}, DEFAULT_SETTINGS, store.get('vt-settings', {})),
  stats: store.get('vt-stats', { days: {} }),           // Tag -> Anzahl Antworten
  session: null,
};
const save = {
  progress: () => store.set('vt-progress', S.progress),
  user: () => store.set('vt-user-decks', S.user),
  settings: () => store.set('vt-settings', S.settings),
  stats: () => store.set('vt-stats', S.stats),
};

// ---------- Hilfsfunktionen ----------
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const disp = s => esc(String(s ?? '').replace(/\s*;\s*/g, ' / '));   // Alternativen lesbar anzeigen
const uid = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}
function setTitle(t) { document.getElementById('title').textContent = t; }

const allDecks = () => [...S.builtin, ...S.user];
const decksOf = lang => allDecks().filter(d => d.lang === lang);
const deckById = id => allDecks().find(d => d.id === id);
const dirsFor = dir => dir === 'mix' ? ['p', 'r'] : [dir];
// passive Wörter (nur verstehen) werden nur Fremdsprache → Deutsch abgefragt
const wDirs = (w, dirs) => w.passiv ? dirs.filter(d => d === 'r') : dirs;
const key = (wid, dir) => wid + '|' + dir;
const prog = (wid, dir) => S.progress[key(wid, dir)] || { b: 0, d: 0, n: 0, w: 0 };

// ---------- Antwortprüfung ----------
const clean = s => String(s ?? '').normalize('NFC').replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim();
const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// "(to) go" -> ["to go", "go"]
function expandOptional(s) {
  const m = s.match(/\(([^)]*)\)/);
  if (!m) return [s];
  const withIt = s.replace(m[0], m[1]), without = s.replace(m[0], '');
  return [...expandOptional(withIt), ...expandOptional(without)].map(clean);
}
// Alternativen sind mit ";" getrennt
function variants(target) {
  return String(target).split(';').map(clean).filter(Boolean).flatMap(expandOptional);
}
// deutsche Antworten: Artikel und Groß-/Kleinschreibung egal
const normDe = s => clean(s).toLowerCase().replace(/^(der|die|das|ein|eine|sich) /, '');

function align(a, b) {
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, (_, i) => { const r = new Array(m + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.unshift({ t: a[i - 1] === b[j - 1] ? 'eq' : 'sub', c: a[i - 1] }); i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.unshift({ t: 'ins', c: a[i - 1] }); i--; }
    else { ops.unshift({ t: 'del', c: b[j - 1] }); j--; }
  }
  return { dist: D[n][m], ops };
}

// strict = Fremdsprache: Groß-/Kleinschreibung und Akzente zählen
function check(input, target, strict) {
  const typed = clean(input);
  const vs = variants(target);
  const norm = strict ? (x => x) : normDe;
  const ok = typed !== '' && vs.some(v => norm(v) === norm(typed));
  let best = vs[0] || '', bestAl = null;
  for (const v of vs) { const al = align(typed, v); if (!bestAl || al.dist < bestAl.dist) { best = v; bestAl = al; } }
  let tip = '';
  if (!ok && typed) {
    if (vs.some(v => v.toLowerCase() === typed.toLowerCase())) tip = 'Achte auf Groß- und Kleinschreibung!';
    else if (vs.some(v => stripAccents(v) === stripAccents(typed))) tip = 'Achte auf die Akzente!';
    else if (bestAl && bestAl.dist === 1) tip = 'Ganz knapp – nur ein Buchstabe!';
    else if (bestAl && bestAl.dist === 2) tip = 'Fast – zwei Buchstaben stimmen nicht.';
  }
  return { ok, typed, best, ops: bestAl ? bestAl.ops : [], dist: bestAl ? bestAl.dist : 99, tip };
}
function diffHtml(ops) {
  return ops.map(o => o.t === 'eq' ? esc(o.c)
    : o.t === 'del' ? '<span class="missing">_</span>'
    : `<span class="wrong">${o.c === ' ' ? '&nbsp;' : esc(o.c)}</span>`).join('');
}

// ---------- Aussprache ----------
function speak(text, lang) {
  if (!S.settings.speak || !('speechSynthesis' in window) || !text) return;
  const u = new SpeechSynthesisUtterance(String(text).replace(/[{}()]/g, '').split(';')[0]);
  u.lang = LANGS[lang].tts; u.rate = 0.9;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ---------- Statistik ----------
function countAnswer() {
  const t = today(); S.stats.days[t] = (S.stats.days[t] || 0) + 1; save.stats();
}
function streak() {
  const g = S.settings.goal, t = today();
  let d = (S.stats.days[t] || 0) >= g ? t : t - 1, n = 0;
  while ((S.stats.days[d] || 0) >= g) { n++; d--; }
  return n;
}
function boxCounts(deck, dirs) {
  const c = [0, 0, 0, 0, 0, 0];
  for (const w of deck.words) for (const dir of wDirs(w, dirs)) c[prog(w.id, dir).b]++;
  return c;
}
function boxBar(c) {
  const total = c.reduce((a, b) => a + b, 0) || 1;
  return `<div class="boxbar">${c.map((n, i) => n ? `<div style="width:${n / total * 100}%;background:${BOX_COLORS[i]}"></div>` : '').join('')}</div>`;
}
const LEGEND = `<div class="legend">${['neu', 'wackelig (1–2)', 'mittel (3–4)', 'sicher (5)'].map((l, i) =>
  `<span style="--c:${[BOX_COLORS[0], BOX_COLORS[1], BOX_COLORS[3], BOX_COLORS[5]][i]}">${l}</span>`).join('')}</div>`;

// ---------- Installieren ----------
let installEvt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e;
  if (!S.session && document.getElementById('install-slot')) renderHome();
});
window.addEventListener('appinstalled', () => { installEvt = null; toast('Installiert! Du findest die App jetzt auf dem Startbildschirm.'); });
function installCard() {
  if (isInstalled()) return '';
  if (installEvt) return `<div class="card row"><span class="grow">📲 Als App aufs Handy holen</span>
    <button class="btn-primary" id="do-install">Installieren</button></div>`;
  return `<details class="card"><summary>📲 Als App aufs Handy holen</summary>
    <p class="muted">Chrome: Menü ⋮ → „Zum Startbildschirm hinzufügen“ → „Installieren“.<br>
    Firefox: Menü ⋮ → „Zum Startbildschirm hinzufügen“.<br>
    Danach startet die App über das Icon „Vokabeln“ und funktioniert auch ohne Internet.</p></details>`;
}

// ---------- Startseite ----------
function renderHome() {
  S.session = null; setTitle('Vokabeltrainer');
  const lang = S.settings.lang, decks = decksOf(lang), sel = S.settings.selected[lang] || [];
  const active = sel.length ? decks.filter(d => sel.includes(d.id)) : decks;
  const dirs = dirsFor(S.settings.dir), t = today();
  let due = 0, fresh = 0, sentences = 0;
  for (const d of active) for (const w of d.words) {
    for (const dir of wDirs(w, dirs)) { const p = prog(w.id, dir); if (p.b === 0) fresh++; else if (p.d <= t) due++; }
    if (w.s && !w.passiv) sentences++;
  }
  const done = S.stats.days[t] || 0, goal = S.settings.goal;
  const L = LANGS[lang].name;
  $app.innerHTML = `
    <div class="tabs">${Object.entries(LANGS).map(([k, v]) =>
      `<button data-lang="${k}" class="${k === lang ? 'active' : ''}">${v.name}</button>`).join('')}</div>
    <div class="card stats">
      <div class="stat"><div class="big">${done}/${goal}</div><div class="muted">heute geübt</div>
        <div class="goalbar"><div style="width:${Math.min(100, done / goal * 100)}%"></div></div></div>
      <div class="stat"><div class="big">🔥 ${streak()}</div><div class="muted">Tage in Folge</div></div>
    </div>
    <div class="card">
      <div class="field"><label>Richtung</label>
        <div class="tabs" id="dirtabs">${['p', 'r', 'mix'].map(d =>
          `<button data-dir="${d}" class="btn-small ${S.settings.dir === d ? 'active' : ''}">${
            d === 'p' ? 'Deutsch → ' + L : d === 'r' ? L + ' → Deutsch' : 'gemischt'}</button>`).join('')}</div></div>
      <p class="muted">${sel.length ? `${sel.length} Unit(s) ausgewählt` : 'Alle Units'} · heute fällig: <b>${due}</b> · neu: <b>${fresh}</b></p>
      <button class="btn-primary btn-big" id="go-learn" ${due + fresh ? '' : 'disabled'}>Lernen starten</button>
      <div class="row" style="margin-top:8px">
        <button class="grow" id="go-sent" ${sentences ? '' : 'disabled'}>Lückensätze</button>
        <button class="grow" id="go-test">Test üben</button>
      </div>
      ${due + fresh ? '' : '<p class="muted">Für heute ist alles erledigt. 🎉</p>'}
    </div>
    <div id="install-slot">${installCard()}</div>
    <h2>Units <span class="muted">(antippen zum Auswählen)</span></h2>
    ${decks.length ? decks.map(d => {
      const c = boxCounts(d, dirs);
      return `<div class="card unit ${sel.includes(d.id) ? 'selected' : ''}" data-deck="${d.id}">
        <h3>${esc(d.title)}</h3>
        <div class="muted">${d.words.length} Wörter${d.user ? ' · selbst angelegt' : ''}</div>
        ${boxBar(c)}
        <div class="row"><button class="btn-small" data-words="${d.id}">Wörter ansehen</button></div>
      </div>`;
    }).join('') + LEGEND : '<p class="muted">Noch keine Units. Über ☰ kannst du eine anlegen.</p>'}
  `;
  $app.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { S.settings.lang = b.dataset.lang; save.settings(); renderHome(); });
  $app.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { S.settings.dir = b.dataset.dir; save.settings(); renderHome(); });
  $app.querySelectorAll('[data-deck]').forEach(el => el.onclick = e => {
    if (e.target.closest('button')) return;
    const id = el.dataset.deck, s = S.settings.selected[lang] = S.settings.selected[lang] || [];
    const i = s.indexOf(id); i >= 0 ? s.splice(i, 1) : s.push(id);
    save.settings(); renderHome();
  });
  $app.querySelectorAll('[data-words]').forEach(b => b.onclick = () => renderUnit(b.dataset.words));
  const inst = document.getElementById('do-install');
  if (inst) inst.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderHome(); };
  document.getElementById('go-learn').onclick = () => startSession('learn', active);
  document.getElementById('go-sent').onclick = () => startSession('sent', active);
  document.getElementById('go-test').onclick = () => {
    if (!sel.length) { toast('Wähle zuerst die Unit(s) für den Test aus.'); return; }
    startSession('test', active);
  };
}

// ---------- Abfrage ----------
function startSession(mode, decks) {
  const t = today(), dirs = mode === 'sent' ? ['s'] : dirsFor(S.settings.dir);
  const cards = [];
  for (const d of decks) for (const w of d.words) for (const dir of wDirs(w, dirs)) {
    if (dir === 's' && !w.s) continue;
    cards.push({ w, deck: d, dir, p: prog(w.id, dir) });
  }
  let queue;
  if (mode === 'test') queue = shuffle(cards);
  else {
    const due = shuffle(cards.filter(c => c.p.b > 0 && c.p.d <= t)).slice(0, S.settings.sessionMax);
    const fresh = cards.filter(c => c.p.b === 0).slice(0, S.settings.newPerSession); // neue in Buchreihenfolge
    queue = shuffle([...due, ...fresh]);
  }
  if (!queue.length) { toast(mode === 'sent' ? 'Gerade keine Lückensätze fällig.' : 'Nichts zu üben.'); return; }
  S.session = { mode, queue, i: 0, right: 0, wrong: 0, missed: new Set(), firstTry: new Set(), total: queue.length, answered: false };
  renderCard();
}

function renderCard() {
  const s = S.session; if (!s) return renderHome();
  if (s.i >= s.queue.length) return renderDone();
  const c = s.queue[s.i], lang = c.deck.lang, L = LANGS[lang].name;
  setTitle(s.mode === 'test' ? 'Test üben' : s.mode === 'sent' ? 'Lückensätze' : 'Lernen');
  const answerLang = c.dir === 'r' ? 'de' : lang;
  let q;
  if (c.dir === 's') {
    const parts = c.w.s.split(/\{[^}]*\}/);
    q = `<div class="prompt-lang">Ergänze (${L})</div>
      <div class="sentence">${parts.map(esc).join('<span class="gap">&nbsp;</span>')}</div>
      <div class="hint">(${disp(c.w.de)})</div>${c.w.sDe ? `<div class="muted">${esc(c.w.sDe)}</div>` : ''}`;
  } else if (c.dir === 'p') {
    q = `<div class="prompt-lang">Deutsch → ${L}</div><div class="prompt">${disp(c.w.de)}</div>`;
  } else {
    q = `<div class="prompt-lang">${L} → Deutsch</div><div class="prompt">${disp(c.w.fx)}
      <button class="btn-small" id="say" aria-label="Vorlesen">🔊</button></div>`;
  }
  const acc = answerLang === 'de' ? [] : LANGS[lang].accents;
  const box = c.p.b;
  $app.innerHTML = `
    <div class="progress-top"><span>${s.i + 1} / ${s.queue.length}</span>
      <span><span class="box-chip" style="background:${BOX_COLORS[box]}">${BOX_NAMES[box]}</span></span>
      <span>✔ ${s.right} · ✘ ${s.wrong}</span></div>
    <div class="goalbar"><div style="width:${s.i / s.queue.length * 100}%"></div></div>
    <div class="card quiz-card">${q}
      <input class="answer-input" id="ans" lang="${answerLang}" autocomplete="off" autocorrect="off"
        autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="Antwort eintippen">
      ${acc.length ? `<div class="accents">${acc.map(a => `<button data-acc="${a}">${a}</button>`).join('')}</div>` : ''}
      <div id="fb"></div>
      <button class="btn-primary btn-big" id="next" style="margin-top:12px">Prüfen</button>
    </div>
    <button class="btn-small" id="quit">Beenden</button>`;
  const inp = document.getElementById('ans');
  inp.focus();
  if (c.dir === 'r') { const sb = document.getElementById('say'); sb.onclick = () => speak(c.w.fx, lang); }
  $app.querySelectorAll('[data-acc]').forEach(b => {
    b.onpointerdown = e => e.preventDefault(); // Tastatur bleibt offen
    b.onclick = () => {
      const a = b.dataset.acc, st = inp.selectionStart ?? inp.value.length, en = inp.selectionEnd ?? st;
      inp.value = inp.value.slice(0, st) + a + inp.value.slice(en);
      inp.setSelectionRange(st + 1, st + 1); inp.focus();
    };
  });
  const next = document.getElementById('next');
  s.answered = false;
  next.onclick = () => s.answered ? advance() : answer(c, inp.value);
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); next.click(); } };
  document.getElementById('quit').onclick = () => { if (s.i > 0) renderDone(); else renderHome(); };
}

function answer(c, input) {
  const s = S.session, lang = c.deck.lang;
  const target = c.dir === 'r' ? c.w.de : c.dir === 's' ? (c.w.s.match(/\{([^}]*)\}/) || [, ''])[1] : c.w.fx;
  const res = check(input, target, c.dir !== 'r');
  s.answered = true;
  grade(c, res.ok);
  const fb = document.getElementById('fb'), inp = document.getElementById('ans');
  inp.readOnly = true;
  const full = c.dir === 'r' ? `${c.w.fx} = ${c.w.de}` : c.dir === 's' ? c.w.s.replace(/[{}]/g, '') : `${c.w.de} = ${c.w.fx}`;
  if (res.ok) {
    fb.innerHTML = `<div class="feedback ok"><b>Richtig!</b> ${variants(target).length > 1 ? `<div class="muted">Auch möglich: ${disp(target)}</div>` : ''}
      <div class="muted">${disp(full)}</div></div>`;
  } else {
    fb.innerHTML = `<div class="feedback bad">
      ${res.tip ? `<b>${esc(res.tip)}</b><br>` : '<b>Leider falsch.</b><br>'}
      ${res.typed ? `Deine Antwort: <span class="diff">${res.dist <= 3 ? diffHtml(res.ops) : esc(res.typed)}</span><br>` : ''}
      Richtig: <span class="solution">${esc(target.split(';')[0])}</span>
      ${variants(target).length > 1 ? `<div class="muted">Möglich: ${disp(target)}</div>` : ''}
      <div class="muted">${disp(full)}</div>
      <p class="muted">Kommt in dieser Runde gleich noch einmal.</p>
      ${c.dir === 'r' && res.typed ? '<button class="btn-small" id="override">Meine Antwort bedeutet dasselbe</button>' : ''}
    </div>`;
    const ov = document.getElementById('override');
    if (ov) ov.onclick = () => { undoWrong(c); ov.remove(); toast('Als richtig gezählt.'); };
  }
  if (c.dir !== 'r') speak(c.dir === 's' ? c.w.s : c.w.fx, lang);
  else speak(c.w.fx, lang);
  document.getElementById('next').textContent = 'Weiter';
  document.getElementById('next').focus();
}

// Lernkartei-Logik
function grade(c, ok) {
  const s = S.session, k = key(c.w.id, c.dir), t = today();
  const p = Object.assign({ b: 0, d: 0, n: 0, w: 0 }, S.progress[k]);
  s.last = { k, before: S.progress[k] ? { ...S.progress[k] } : null, requeued: false };
  countAnswer();
  if (ok) {
    s.right++; p.n++;
    if (s.mode === 'test') { if (p.b === 0) { p.b = 1; p.d = t + 1; } }
    else if (s.missed.has(k) || p.b === 0) { p.b = 1; p.d = t + 1; }          // heute gelernt/wiederholt -> morgen wieder
    else { const was = p.b; p.b = Math.min(5, p.b + 1); p.d = t + (was === 5 ? 30 : INTERVAL[p.b]); }
  } else {
    s.wrong++; p.w++; p.b = 1; p.d = t; s.missed.add(k);
    const pos = Math.min(s.queue.length, s.i + 4);                           // gleich noch einmal
    s.queue.splice(pos, 0, { ...c, p: { ...p } }); s.last.requeued = pos;
  }
  S.progress[k] = p; save.progress();
}
function undoWrong(c) {
  const s = S.session, L = s.last; if (!L) return;
  if (L.requeued !== false) s.queue.splice(L.requeued, 1);
  s.missed.delete(L.k); s.wrong--;
  if (L.before) S.progress[L.k] = L.before; else delete S.progress[L.k];
  S.stats.days[today()]--; // grade() zählt die Antwort neu
  grade(c, true);
}
function advance() { S.session.i++; renderCard(); }

function renderDone() {
  const s = S.session; setTitle('Geschafft');
  const g = S.settings.goal, d = S.stats.days[today()] || 0;
  $app.innerHTML = `<div class="card done">
    <div class="big">${s.wrong === 0 ? '🏆' : '🎉'}</div>
    <h2>Runde beendet</h2>
    <p>✔ ${s.right} richtig · ✘ ${s.wrong} falsch</p>
    <p>${d >= g ? `Tagesziel erreicht! 🔥 ${streak()} Tag(e) in Folge.` : `Noch ${g - d} Antworten bis zum Tagesziel.`}</p>
    ${s.mode === 'test' ? '<p class="muted">Im Testmodus rücken richtige Karten nicht vor – falsche kommen zurück in Fach 1.</p>' : ''}
    <button class="btn-primary btn-big" id="home">Zur Übersicht</button></div>`;
  document.getElementById('home').onclick = renderHome;
  S.session = null;
}

// ---------- Unit-Ansicht ----------
function renderUnit(id) {
  const d = deckById(id); if (!d) return renderHome();
  setTitle(d.title);
  const dirs = dirsFor(S.settings.dir);
  $app.innerHTML = `
    <p class="muted">${LANGS[d.lang].name} · ${d.words.length} Wörter · Punkt = Fach (${DIR_LABEL[S.settings.dir]})</p>
    ${boxBar(boxCounts(d, dirs))}${LEGEND}
    <ul class="wordlist">${d.words.map((w, i) => {
      const ds = wDirs(w, dirs), b = ds.length ? Math.min(...ds.map(x => prog(w.id, x).b)) : 0;
      return `<li><span class="dot" style="background:${ds.length ? BOX_COLORS[b] : 'transparent'}"></span>
        <div class="grow"><b>${disp(w.fx)}</b> – ${disp(w.de)}${w.passiv ? ' <span class="muted">(nur verstehen)</span>' : ''}${w.s ? `<div class="muted">${esc(w.s.replace(/[{}]/g, ''))}</div>` : ''}</div>
        <button class="btn-small" data-say="${i}">🔊</button>
        ${d.user ? `<button class="btn-small" data-edit="${i}">✎</button>` : ''}</li>`;
    }).join('')}</ul>
    ${d.user ? `<h2>Wort hinzufügen</h2>${wordForm()}
      <button class="btn-primary" id="add">Hinzufügen</button>
      <h2>Unit</h2><button class="btn-danger" id="del">Unit löschen</button>` : ''}`;
  $app.querySelectorAll('[data-say]').forEach(b => b.onclick = () => {
    const was = S.settings.speak; S.settings.speak = true; speak(d.words[+b.dataset.say].fx, d.lang); S.settings.speak = was;
  });
  if (!d.user) return;
  $app.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => renderEdit(d, +b.dataset.edit));
  document.getElementById('add').onclick = () => {
    const w = readWordForm(); if (!w) return;
    d.words.push({ id: uid(), ...w }); save.user(); toast('Gespeichert'); renderUnit(id);
  };
  document.getElementById('del').onclick = () => {
    if (!confirm(`Unit „${d.title}“ wirklich löschen?`)) return;
    S.user = S.user.filter(x => x.id !== id); save.user(); renderHome();
  };
}
function wordForm(w = {}) {
  return `<div class="field"><label>Fremdsprache (Alternativen mit ; trennen, optional in Klammern)</label>
      <input type="text" id="f-fx" value="${esc(w.fx)}" autocapitalize="none" autocomplete="off"></div>
    <div class="field"><label>Deutsch</label><input type="text" id="f-de" value="${esc(w.de)}" autocomplete="off"></div>
    <div class="field"><label>Beispielsatz (optional) – Lücke in {geschweifte Klammern}</label>
      <input type="text" id="f-s" value="${esc(w.s)}" placeholder="I {go} to school by bus." autocapitalize="none"></div>`;
}
function readWordForm() {
  const fx = clean(document.getElementById('f-fx').value), de = clean(document.getElementById('f-de').value);
  const s = document.getElementById('f-s').value.trim();
  if (!fx || !de) { toast('Bitte beide Felder ausfüllen.'); return null; }
  if (s && !/\{[^}]+\}/.test(s)) { toast('Im Satz fehlt die {Lücke}.'); return null; }
  return s ? { fx, de, s } : { fx, de };
}
function renderEdit(d, i) {
  const w = d.words[i]; setTitle('Wort bearbeiten');
  $app.innerHTML = `${wordForm(w)}<div class="row"><button class="btn-primary" id="save">Speichern</button>
    <button id="cancel">Abbrechen</button><button class="btn-danger" id="del">Löschen</button></div>`;
  document.getElementById('save').onclick = () => {
    const n = readWordForm(); if (!n) return;
    d.words[i] = { id: w.id, ...n }; save.user(); renderUnit(d.id);
  };
  document.getElementById('cancel').onclick = () => renderUnit(d.id);
  document.getElementById('del').onclick = () => {
    if (!confirm(`„${w.fx}“ wirklich löschen?`)) return;
    d.words.splice(i, 1); save.user(); renderUnit(d.id);
  };
}

// ---------- Menü ----------
function renderMenu() {
  S.session = null; setTitle('Einstellungen');
  const st = S.settings;
  $app.innerHTML = `
    <h2>Neue Unit anlegen</h2>
    <div class="card">
      <div class="field"><label>Sprache</label><select id="n-lang">${Object.entries(LANGS).map(([k, v]) =>
        `<option value="${k}" ${k === st.lang ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
      <div class="field"><label>Name</label><input type="text" id="n-title" placeholder="z. B. Unit 3 – Station 1"></div>
      <div class="field"><label>Wörter (optional, eine Zeile pro Wort: Fremdsprache = Deutsch = Satz mit {Lücke})</label>
        <textarea id="n-text" placeholder="to go = gehen = I {go} to school by bus.&#10;the dog = der Hund"></textarea></div>
      <button class="btn-primary" id="n-create">Anlegen</button>
    </div>
    <h2>Lernen</h2>
    <div class="card">
      <div class="field"><label>Tagesziel (Antworten pro Tag)</label><input type="number" id="s-goal" min="5" max="200" value="${st.goal}"></div>
      <div class="field"><label>Neue Wörter pro Runde</label><input type="number" id="s-new" min="1" max="50" value="${st.newPerSession}"></div>
      <div class="field"><label>Höchstens fällige Wörter pro Runde</label><input type="number" id="s-max" min="5" max="200" value="${st.sessionMax}"></div>
      <label class="check"><input type="checkbox" id="s-speak" ${st.speak ? 'checked' : ''}> Aussprache vorlesen</label>
    </div>
    <h2>Sicherung</h2>
    <div class="card">
      <p class="muted">Lernstand und eigene Units liegen nur auf diesem Handy. Ab und zu sichern!</p>
      <div class="row"><button id="b-export">Sicherung speichern</button>
        <label class="btn">Sicherung / Unit laden<input type="file" id="b-import" accept=".json,application/json" hidden></label></div>
    </div>
    <h2>So funktioniert's</h2>
    <div class="card muted">
      Jedes Wort wandert durch 5 Fächer. Richtig → ein Fach weiter, es kommt erst nach 1, 2, 4, 8, 16 Tagen wieder.
      Falsch → zurück in Fach 1, und es kommt in derselben Runde gleich noch einmal.
      Am besten jeden Tag kurz üben statt einmal lang – so bleibt am meisten hängen.
      „Test üben“ fragt alle Wörter der ausgewählten Units ab, egal welches Fach.
    </div>
    <details class="card"><summary class="muted">Für Eltern</summary>
      <p class="muted">Löscht alle Fächer und die Tage-Serie. Units bleiben erhalten.</p>
      <button class="btn-small btn-danger" id="reset">Lernstand zurücksetzen …</button></details>`;
  const num = (id, k, min) => document.getElementById(id).onchange = e => { st[k] = Math.max(min, +e.target.value || min); save.settings(); };
  num('s-goal', 'goal', 5); num('s-new', 'newPerSession', 1); num('s-max', 'sessionMax', 5);
  document.getElementById('s-speak').onchange = e => { st.speak = e.target.checked; save.settings(); };
  document.getElementById('n-create').onclick = () => {
    const title = document.getElementById('n-title').value.trim(), lang = document.getElementById('n-lang').value;
    if (!title) { toast('Bitte einen Namen eingeben.'); return; }
    const words = parseLines(document.getElementById('n-text').value);
    const d = { id: uid(), lang, title, user: true, words };
    S.user.push(d); save.user(); st.lang = lang; save.settings(); renderUnit(d.id);
  };
  document.getElementById('b-export').onclick = exportBackup;
  document.getElementById('b-import').onchange = e => importFile(e.target.files[0]);
  document.getElementById('reset').onclick = () => {
    const a = prompt('Der gesamte Lernstand wird gelöscht – das lässt sich nicht rückgängig machen.\nZum Bestätigen LÖSCHEN eintippen:');
    if (!a || a.trim().toUpperCase() !== 'LÖSCHEN') { toast('Nichts gelöscht.'); return; }
    S.progress = {}; S.stats = { days: {} }; save.progress(); save.stats(); toast('Zurückgesetzt'); renderHome();
  };
}
function parseLines(text) {
  return text.split('\n').map(l => l.split('=').map(x => x.trim())).filter(p => p[0] && p[1])
    .map(([fx, de, s]) => s && /\{[^}]+\}/.test(s) ? { id: uid(), fx, de, s } : { id: uid(), fx, de });
}
function exportBackup() {
  const data = { app: 'vokabeltrainer', version: 1, date: new Date().toISOString(),
    progress: S.progress, user: S.user, settings: S.settings, stats: S.stats };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `vokabeltrainer-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app === 'vokabeltrainer') {
      if (!confirm('Sicherung laden? Der jetzige Lernstand auf diesem Handy wird ersetzt.')) return;
      S.progress = data.progress || {}; S.user = data.user || []; S.stats = data.stats || { days: {} };
      S.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
      save.progress(); save.user(); save.stats(); save.settings(); toast('Sicherung geladen'); renderHome();
    } else if (data.words && data.lang) {          // einzelne Unit
      const d = { ...data, id: data.id || uid(), user: true };
      if (deckById(d.id)) { toast('Diese Unit gibt es schon.'); return; }
      S.user.push(d); save.user(); toast('Unit hinzugefügt'); renderUnit(d.id);
    } else toast('Unbekanntes Dateiformat.');
  } catch { toast('Datei konnte nicht gelesen werden.'); }
}

// ---------- Start ----------
async function loadBuiltin() {
  try {
    const idx = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
    const decks = await Promise.all(idx.decks.map(f => fetch('data/' + f, { cache: 'no-cache' }).then(r => r.json())));
    S.builtin = decks.filter(d => d && d.words);
  } catch (e) { console.warn('Units konnten nicht geladen werden', e); }
}
document.getElementById('btn-home').onclick = () => {
  if (S.session && S.session.i > 0 && !confirm('Runde abbrechen? Bisherige Antworten sind gespeichert.')) return;
  renderHome();
};
document.getElementById('btn-menu').onclick = renderMenu;
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
loadBuiltin().then(renderHome);
