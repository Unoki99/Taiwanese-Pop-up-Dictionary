// \u65b9\u65b9 core: reading the shared dictionary data (data.json v2) the same way everywhere.
// A word is identified by its key "\u6f22\u5b57\tcodes" (codes = the \u901a\u884c reading as anchor syllable codes).
// place = null for \u901a\u884c, or 0\u20139 for one of the 10 places in data.places.
function FangCore(d) {
  const SYL = d.syl, TL = d.tl || {}, PJ = d.pj || {};
  const DIA = d.dia || {}, TOK = d.tok || {}, ALT = d.alt || {};
  const DIA2 = d.dia2 || {};   // other ways a place says the word
  const OR_PLACES = new Set((d.places || []).map((n, i) => ["\u81fa\u5357", "\u9ad8\u96c4"].some(x => n.startsWith(x)) ? i : -1).filter(i => i >= 0));   // places where o is always \u311c
  const isCode = t => Object.prototype.hasOwnProperty.call(SYL, t);
  const DEX = d.dex || {};     // places whose reading MOE states for the word (the others are worked out by rule)
  const mainOf = key => key.slice(key.indexOf("\t") + 1);

  // a local syllable that sounds like the \u901a\u884c one: in \u81fa\u5357 / \u9ad8\u96c4, o \u2192 or is how \u901a\u884c o is said too
  const sameSound = (a, b, place) => a === b || (OR_PLACES.has(Number(place)) && a.replace(/\u00f8/g, "\u0275") === b);
  // the place says the word differently from \u901a\u884c (not counting \u81fa\u5357/\u9ad8\u96c4 o \u2192 or)
  function differs(key, place) {
    if (place == null || !DIA[key] || !DIA[key][place]) return false;
    const a = mainOf(key).split(" "), b = DIA[key][place].split(" ");
    if (a.length !== b.length) return true;
    return b.some((x, i) => !sameSound(a[i], x, place));
  }
  const stated = (key, place) => place != null && (DEX[key] || "").includes(String(place));
  // syllables (by position) whose reading for the place is worked out by rule, not stated by MOE
  function guessed(key, place) {
    if (place == null || stated(key, place) || !DIA[key] || !DIA[key][place]) return new Set();
    const a = mainOf(key).split(" "), b = DIA[key][place].split(" ");
    if (a.length !== b.length) return new Set(b.map((_, i) => i));
    return new Set(b.map((x, i) => sameSound(a[i], x, place) ? -1 : i).filter(i => i >= 0));
  }

  // one syllable in a script: lat (\u7693\u7f85) / tl (\u53f0\u7f85) / poj (\u767d\u8a71\u5b57) / zy (\u65b9\u97f3)
  function syl(c, sys, place) {
    const s = SYL[c];
    if (!s) return c;
    if (sys === "zy") {
      // with a place chosen, T\u00e2i-l\u00f4 o is \u311b (\u311c is kept for or / er there)
      // (except \u81fa\u5357 and \u9ad8\u96c4, where o is always said \u311c)
      return place != null && c.includes("\u00f8") && !OR_PLACES.has(Number(place)) ? s[0].replace("\u311c", "\u311b") : s[0];
    }
    if (sys === "tl") return TL[c] ? TL[c][0] : s[1];
    if (sys === "poj") return PJ[c] || s[1];
    return s[1];
  }

  // the reading of a word in a dialect (codes string)
  function codesFor(key, place) {
    if (place != null && DIA[key] && DIA[key][place]) return DIA[key][place];
    return key.slice(key.indexOf("\t") + 1);
  }

  // tokens (codes plus separators: "--" light tone, "_" space, punctuation, "^" capital)
  function tokensFor(key, place, codes) {
    const cs = (codes || codesFor(key, place)).split(" ").filter(Boolean);
    const base = TOK[key];
    if (!base) return cs;
    let i = 0;
    const out = base.split(" ").map(t => {
      const cap = t[0] === "^", c = cap ? t.slice(1) : t;
      if (!isCode(c)) return t;
      const n = cs[i++] || c;
      return (cap ? "^" : "") + n;
    });
    return out;
  }

  // like render, as [text, guessed] pieces so guessed syllables can be shown in red
  function renderPieces(tokens, sys, place, g) {
    const out = [];
    const put = (t, gu) => { if (!t) return; const l = out[out.length - 1]; if (l && l[1] === gu) l[0] += t; else out.push([t, gu]); };
    let prevCode = false, n = 0;
    for (const t of tokens) {
      const cap = t[0] === "^", c = cap ? t.slice(1) : t;
      if (isCode(c)) {
        if (sys !== "zy" && prevCode) put("-", false);
        let s = syl(c, sys, place);
        if (cap && sys !== "zy") s = s.charAt(0).toUpperCase() + s.slice(1);
        put(s, g.has(n)); n++; prevCode = true;
      } else if (t === "--") { if (sys !== "zy") put("--", false); prevCode = false; }
      else if (t === "_") { put(" ", false); prevCode = false; }
      else if (t[0] === "~") { put(t.slice(1), false); prevCode = false; }
      else { put(t, false); prevCode = false; }
    }
    return out;
  }
  const wordPieces = (key, sys, place) => renderPieces(tokensFor(key, place), sys, place, guessed(key, place));

  function render(tokens, sys, place) {
    let out = "", prevCode = false;
    for (const t of tokens) {
      const cap = t[0] === "^", c = cap ? t.slice(1) : t;
      if (isCode(c)) {
        if (sys !== "zy" && prevCode) out += "-";
        let s = syl(c, sys, place);
        if (cap && sys !== "zy") s = s.charAt(0).toUpperCase() + s.slice(1);
        out += s; prevCode = true;
      } else if (t === "--") { if (sys !== "zy") out += "--"; prevCode = false; }
      else if (t === "_") { out += " "; prevCode = false; }
      else if (t[0] === "~") { out += t.slice(1); prevCode = false; }
      else { out += t; prevCode = false; }
    }
    return out;
  }

  // a whole word in a script, for a dialect
  const word = (key, sys, place) => render(tokensFor(key, place), sys, place);
  // a plain codes string (no word key), e.g. an alternative reading
  const codes = (cs, sys, place, tokens) => render(tokens ? tokens.split(" ") : cs.split(" ").filter(Boolean), sys, place);

  // example sentence template "{^code}\u2026"
  const sentence = (tpl, sys) => tpl.replace(/\{(\^?)([^}]+)\}/g, (m, cap, c) => {
    const s = isCode(c) ? syl(c, sys, null) : c;
    return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });

  // other readings of a word: alternatives (\u53c8 / \u4fd7 / \u5408 / "/"), plus the \u901a\u884c reading when a dialect is shown
  function others(key, place) {
    const out = [];
    const main = key.slice(key.indexOf("\t") + 1);
    const shown = codesFor(key, place);
    const also = place != null && DIA2[key] ? (DIA2[key][String(place)] || []) : [];
    for (const c of also) if (c !== shown) out.push({ codes: c, label: "\u4e5f\u8b1b", tokens: null });
    if (differs(key, place) && !also.includes(main)) out.push({ codes: main, label: "\u901a\u884c", tokens: TOK[key] || null });
    for (const [c, label, tokens] of ALT[key] || []) {
      if (c === shown) continue;
      out.push({ codes: c, label: label || "", tokens: tokens || null });
    }
    return out;
  }

  return { syl, codesFor, tokensFor, render, word, codes, sentence, others, isCode, differs, guessed, stated, wordPieces };
}
if (typeof module !== "undefined") module.exports = FangCore;

// \u65b9\u65b9 popup dictionary: background script.
// Holds the dictionary (too big for the page script on iOS), answers lookups,
// and keeps saved words and settings in extension storage (shared by every tab).
const api = globalThis.browser || globalThis.chrome;

let DB = null;
let loading = null;

function load() {
  if (DB) return Promise.resolve(DB);
  if (loading) return loading;
  loading = fetch(api.runtime.getURL("data.json"))
    .then(r => { if (!r.ok && r.status) throw new Error("data.json HTTP " + r.status); return r.json(); })
    .then(d => {
      const F = FangCore(d);
      const hanMap = new Map();
      let maxLen = 1;
      const add = (h, k) => {
        const a = hanMap.get(h);
        if (a) { if (!a.includes(k)) a.push(k); } else hanMap.set(h, [k]);
        maxLen = Math.max(maxLen, Array.from(h).length);
      };
      for (const [h, c] of d.words) add(h, h + "\t" + c);
      // variant characters (\u7570\u7528\u5b57) find the same entries
      for (const [v, keys] of Object.entries(d.var || {})) for (const k of keys) add(v, k);
      // single characters: \u767d (colloquial) reading first, \u6587 (literary) last
      const RANK = { "\u767d": 0, "\u4fd7": 1, "": 2, "\u6587": 3 };
      for (const [h, list] of hanMap) {
        if (Array.from(h).length === 1 && list.length > 1) {
          list.sort((a, b) => RANK[d.reg[a] || ""] - RANK[d.reg[b] || ""]);
        }
      }
      // 台羅 / 白話字: numbered 台羅 syllable (tsiah8) -> codes, and codes string -> words
      const latMap = new Map();
      for (const [c, v] of Object.entries(d.tl || {})) {
        if (!v || v.length < 2) continue;
        const a = latMap.get(v[1]);
        if (a) { if (!a.includes(c)) a.push(c); } else latMap.set(v[1], [c]);
      }
      const codeMap = new Map();
      const addC = (cs, k) => { const a = codeMap.get(cs); if (a) { if (!a.includes(k)) a.push(k); } else codeMap.set(cs, [k]); };
      for (const [h, c] of d.words) addC(c, h + "\t" + c);
      for (const [k, list] of Object.entries(d.alt || {})) for (const a of list) if (a && a[0]) addC(a[0].split(" ").filter(x => x !== "_").join(" "), k);
      DB = { d, F, hanMap, latMap, codeMap, maxLen: Math.min(maxLen, 12), own: new Set(d.own || []), sub: new Set(d.sub || []) };
      return DB;
    })
    .catch(e => { loading = null; throw new Error("\u5b57\u5178\u8f09\u5165\u5931\u6557\uff1a" + (e && e.message || e)); });
  return loading;
}

const TYPE_LABEL = { 1: "\u81fa\u83ef\u5171\u540c", 3: "\u9644\u9304" };

function defCount(db, k) {
  const i = db.d.defs.m[k];
  return i === undefined ? 0 : db.d.defs.t[i].split("\n").length;
}

// a linked word (synonym / antonym) for display
function linkInfo(db, k, sys, place) {
  const h = k.split("\t")[0];
  if (k.endsWith("\t")) return { h, rom: "" };
  return { h, rom: db.F.word(k, sys, place), k };
}

function entry(db, k, sys, place) {
  const d = db.d, F = db.F;
  const h = k.slice(0, k.indexOf("\t"));
  const di = d.defs.m[k];
  const pos = (d.pos[k] || "").split("|");
  const sy = d.sy[k] || {}, an = d.an[k] || {};
  const defs = di === undefined ? [] : d.defs.t[di].split("\n").map((line, i) => {
    const m = line.match(/^(\d+)\.\s*(.*)$/);
    const exs = (d.ex[k] && d.ex[k][i]) || [];
    return {
      n: m ? m[1] : "", text: m ? m[2] : line, pos: pos[i] || "",
      ex: exs.map(([eh, tpl, zh, name]) => ({ h: eh, r: F.sentence(tpl, sys), hl: F.sentence(tpl, "lat"), zh, name })),
      syn: (sy[i] || []).map(x => linkInfo(db, x, sys, place)),
      ant: (an[i] || []).map(x => linkInfo(db, x, sys, place)),
    };
  });
  const shown = F.codesFor(k, place);
  return {
    k, h, codes: shown.split(" "),
    rom: F.word(k, sys, place),
    romP: F.wordPieces(k, sys, place),          // with guessed syllables marked (shown in red)
    zyP: F.wordPieces(k, "zy", place),
    guess: F.guessed(k, place).size > 0,
    hl: F.word(k, "lat", place),
    zy: F.word(k, "zy", place),
    reg: d.reg[k] || "", own: db.own.has(k), sub: db.sub.has(k),
    type: TYPE_LABEL[d.typ[k]] || "",
    dialect: F.differs(k, place) ? d.places[place] : "",
    others: F.others(k, place).map(o => {
      const pl = o.label === "\u901a\u884c" ? null : place;          // the \u901a\u884c reading is shown with \u901a\u884c \u65b9\u97f3
      return { label: o.label, rom: F.codes(o.codes, sys, pl, o.tokens), zy: F.codes(o.codes, "zy", pl, o.tokens) };
    }),
    au: d.au[k] != null ? d.au[k] : null,
    // whole-word links, minus those already shown under a meaning
    syn: (sy.e || []).filter(x => !Object.keys(sy).some(i => i !== "e" && sy[i].includes(x))).map(x => linkInfo(db, x, sys, place)),
    ant: (an.e || []).filter(x => !Object.keys(an).some(i => i !== "e" && an[i].includes(x))).map(x => linkInfo(db, x, sys, place)),
    cats: (d.cat[k] || []).map(i => d.cats[i]),
    defs,
  };
}

// ---------- 台羅 / 白話字 ----------
const TONE_MARK = { "\u0301": 2, "\u0300": 3, "\u0302": 5, "\u030C": 6, "\u0306": 6, "\u0304": 7, "\u030D": 8, "\u030B": 9 };
// one 台羅 or 白話字 syllable (with tone marks or a tone number) -> numbered 台羅 (tsiah8), or null
function numberedTL(s0) {
  let s = s0.normalize("NFD").toLowerCase();
  let tone = 0;
  const m = s.match(/([1-9])$/);
  if (m) { tone = +m[1]; s = s.slice(0, -1); }
  let letters = "";
  for (const ch of s) {
    if (TONE_MARK[ch]) { if (!tone) tone = TONE_MARK[ch]; }
    else if (ch === "\u0358" || !/[\u0300-\u036f]/.test(ch)) letters += ch;
  }
  letters = letters.replace(/o\u0358/g, "oo").replace(/o\u00b7/g, "oo").replace(/\u207f/g, "nn");   // 白話字 o͘ / o· and ⁿ
  if (!/^[a-z]+$/.test(letters)) return null;
  // 白話字 spellings -> 台羅
  letters = letters.replace(/^chh/, "tsh").replace(/^ch/, "ts").replace(/oa/g, "ua").replace(/oe/g, "ue")
    .replace(/eng$/, "ing").replace(/ek$/, "ik");
  if (!tone) tone = /[ptkh]$/.test(letters) ? 4 : 1;
  return letters + tone;
}

// a 台羅 / 白話字 word (syllables joined with - or --): the longest dictionary words from its start
async function lookupLat(text, sys, place) {
  const db = await load();
  const parts = [];                       // { syl, end } end = position in text after this syllable
  const re = /[^-]+/g;
  let m;
  while ((m = re.exec(text))) parts.push({ syl: m[0], end: m.index + m[0].length });
  const lists = [];
  for (const p of parts) {
    const n = numberedTL(p.syl);
    const cs = n && db.latMap.get(n);
    if (!cs) break;
    lists.push(cs);
  }
  const out = [], seen = new Set();
  let matchLen = 0;
  for (let L = Math.min(lists.length, 8); L >= 1 && out.length < 8; L--) {
    let combos = [[]];
    for (const l of lists.slice(0, L)) {
      const next = [];
      for (const a of combos) for (const c of l) if (next.length < 32) next.push(a.concat(c));
      combos = next;
    }
    for (const cs of combos) {
      for (const k of db.codeMap.get(cs.join(" ")) || []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const e = entry(db, k, sys, place);
        e.matchLen = parts[L - 1].end;
        out.push(e);
        if (!matchLen) matchLen = e.matchLen;
      }
    }
  }
  return { matchLen, entries: out.slice(0, 8) };
}

async function lookup(text, sys, place) {
  const db = await load();
  const chars = Array.from(text);
  const out = [], seen = new Set();
  for (let L = Math.min(db.maxLen, chars.length); L >= 1 && out.length < 8; L--) {
    const w = chars.slice(0, L).join("");
    for (const k of db.hanMap.get(w) || []) {
      if (seen.has(k)) continue;
      seen.add(k);
      const e = entry(db, k, sys, place);
      e.matchLen = L;
      if (k.split("\t")[0] !== w) e.variantOf = k.split("\t")[0];
      out.push(e);
    }
  }
  return { matchLen: out.length ? out[0].matchLen : 0, entries: out.slice(0, 8) };
}

// ---------- storage ----------
const DEFAULTS = { enabled: true, rom: "lat", place: null, volume: 0.4, audioBase: "https://unoki99.github.io/fangfang/" };

async function getAll() {
  const s = await api.storage.local.get(["saved", "settings"]);
  return { saved: Array.isArray(s.saved) ? s.saved : [], settings: Object.assign({}, DEFAULTS, s.settings || {}) };
}
const setSaved = saved => api.storage.local.set({ saved });

// "\u6f22\u5b57\tcodes" = every meaning; "\u6f22\u5b57\tcodes\t2" = only meaning 3 (same format as the website)
const savedDefs = (saved, k) => saved.filter(s => s.startsWith(k + "\t") && s.split("\t").length === 3).map(s => +s.split("\t")[2]);

async function toggleWord(k) {
  const { saved } = await getAll();
  const at = saved.findIndex(s => s === k || s.startsWith(k + "\t"));
  const wasAll = saved.includes(k);
  const next = saved.filter(s => s !== k && !s.startsWith(k + "\t"));
  if (!wasAll) next.splice(at >= 0 ? at : 0, 0, k);
  await setSaved(next);
  return next;
}

async function toggleDef(k, i) {
  const db = await load();
  const { saved } = await getAll();
  const n = defCount(db, k);
  const at = saved.findIndex(s => s === k || s.startsWith(k + "\t"));
  const defs = new Set(saved.includes(k) ? [...Array(n).keys()] : savedDefs(saved, k));
  if (defs.has(i)) defs.delete(i); else defs.add(i);
  const next = saved.filter(s => s !== k && !s.startsWith(k + "\t"));
  const add = defs.size === n && n > 0 ? [k] : [...defs].sort((x, y) => x - y).map(j => k + "\t" + j);
  next.splice(at >= 0 ? at : 0, 0, ...add);
  await setSaved(next);
  return next;
}

async function mergeBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch (e) { return { error: "\u9019\u4e0d\u662f\u65b9\u65b9\u7684\u5099\u4efd\u6a94\u3002" }; }
  if (!b || b.app !== "fangfang") return { error: "\u9019\u4e0d\u662f\u65b9\u65b9\u7684\u5099\u4efd\u6a94\u3002" };
  const db = await load();
  const { saved } = await getAll();
  const words = new Map();
  for (const s of [...saved, ...(Array.isArray(b.saved) ? b.saved : [])]) {
    if (typeof s !== "string") continue;
    const parts = s.split("\t"), k = parts.slice(0, 2).join("\t");
    if (!words.has(k)) words.set(k, new Set());
    words.get(k).add(parts.length === 3 ? +parts[2] : "all");
  }
  const before = new Set(saved.map(s => s.split("\t").slice(0, 2).join("\t"))).size;
  const next = [];
  for (const [k, set] of words) {
    const n = defCount(db, k);
    const defs = [...set].filter(x => x !== "all");
    if (set.has("all") || (n > 0 && defs.length >= n)) next.push(k);
    else defs.sort((x, y) => x - y).forEach(i => next.push(k + "\t" + i));
  }
  await setSaved(next);
  return { added: words.size - before };
}

async function savedEntries(sys, place) {
  const db = await load();
  const { saved } = await getAll();
  const seen = new Set(), out = [];
  const keys = new Set(db.d.words.map(([h, c]) => h + "\t" + c));
  for (const s of saved) {
    const k = s.split("\t").slice(0, 2).join("\t");
    if (seen.has(k)) continue;
    seen.add(k);
    if (!keys.has(k)) continue;
    const e = entry(db, k, sys, place);
    e.only = saved.includes(k) ? null : savedDefs(saved, k);
    out.push(e);
  }
  return out;
}

async function handle(msg) {
  const place = msg && msg.place != null && msg.place !== "" ? +msg.place : null;
  switch (msg && msg.type) {
    case "lookup": return lookup(String(msg.text || ""), msg.rom || "lat", place);
    case "lookupLat": return lookupLat(String(msg.text || ""), msg.rom || "lat", place);
    case "state": return getAll();
    case "places": { const db = await load(); return db.d.places; }
    case "settings": {
      const { settings } = await getAll();
      const next = Object.assign(settings, msg.settings || {});
      await api.storage.local.set({ settings: next });
      return next;
    }
    case "toggleWord": return { saved: await toggleWord(msg.k) };
    case "toggleDef": return { saved: await toggleDef(msg.k, msg.i) };
    case "savedEntries": return savedEntries(msg.rom || "lat", place);
    case "setSaved": await setSaved(Array.isArray(msg.saved) ? msg.saved : []); return { ok: true };
    case "import": return mergeBackup(String(msg.text || ""));
    case "audio": return fetchAudio(String(msg.url || ""));
    case "defCount": { const db = await load(); return defCount(db, msg.k); }
    default: return null;
  }
}

// audio is fetched here (extension origin) so a page's security rules can't block it
async function fetchAudio(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { error: "HTTP " + r.status };
    const u8 = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(bin) };
  } catch (e) { return { error: String(e) }; }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse, err => sendResponse({ error: String(err) }));
  return true;
});

// exported for the test harness
globalThis.__fangfang = { handle, load };
