// 方方 popup dictionary: background script.
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
      const hanMap = new Map();
      let maxLen = 1;
      for (const [h, c] of d.words) {
        const a = hanMap.get(h);
        if (a) { if (!a.includes(c)) a.push(c); } else hanMap.set(h, [c]);
        maxLen = Math.max(maxLen, Array.from(h).length);
      }
      // single characters: 白 (colloquial) reading first, 文 (literary) last, as on the website
      const RANK = { "白": 0, "俗": 1, "": 2, "文": 3 };
      for (const [h, list] of hanMap) {
        if (Array.from(h).length === 1 && list.length > 1) {
          list.sort((a, b) => RANK[d.reg[h + "\t" + a] || ""] - RANK[d.reg[h + "\t" + b] || ""]);
        }
      }
      DB = { d, hanMap, maxLen: Math.min(maxLen, 12), own: new Set(d.own || []) };
      return DB;
    })
    .catch(e => { loading = null; throw new Error("字典載入失敗：" + (e && e.message || e)); });
  return loading;
}

const romOf = (d, c, sys) =>
  (sys === "tl" && d.tl[c]) ? d.tl[c][0] : (sys === "poj" && d.pj[c]) ? d.pj[c] : d.syl[c][1];

function romSentence(d, tpl, sys) {
  return tpl.replace(/\{(\^?)([^}]+)\}/g, (m, cap, c) => {
    const s = d.syl[c] ? romOf(d, c, sys) : c;
    return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });
}

function defCount(db, k) {
  const i = db.d.defs.m[k];
  return i === undefined ? 0 : db.d.defs.t[i].split("\n").length;
}

function entry(db, h, c, sys) {
  const d = db.d, k = h + "\t" + c, codes = c.split(" ").filter(x => d.syl[x]);
  const di = d.defs.m[k];
  const pos = (d.pos[k] || "").split("|");
  const defs = di === undefined ? [] : d.defs.t[di].split("\n").map((line, i) => {
    const m = line.match(/^(\d+)\.\s*(.*)$/);
    const exs = (d.ex[k] && d.ex[k][i]) || [];
    return {
      n: m ? m[1] : "", text: m ? m[2] : line, pos: pos[i] || "",
      ex: exs.map(([eh, tpl, zh, name]) => ({ h: eh, r: romSentence(d, tpl, sys), hl: romSentence(d, tpl, "lat"), zh, name })),
    };
  });
  return {
    k, h, codes,
    rom: codes.map(x => romOf(d, x, sys)).join("-"),
    hl: codes.map(x => d.syl[x][1]).join("-"),
    zy: codes.map(x => d.syl[x][0]).join(""),
    reg: d.reg[k] || "", own: db.own.has(k),
    au: d.au[k] != null ? d.au[k] : null,
    defs,
  };
}

async function lookup(text, sys) {
  const db = await load();
  const chars = Array.from(text);
  const out = [];
  for (let L = Math.min(db.maxLen, chars.length); L >= 1 && out.length < 8; L--) {
    const w = chars.slice(0, L).join("");
    for (const c of db.hanMap.get(w) || []) out.push(entry(db, w, c, sys));
  }
  return { matchLen: out.length ? Array.from(out[0].h).length : 0, entries: out.slice(0, 8) };
}

// ---------- storage ----------
const DEFAULTS = { enabled: true, rom: "lat", volume: 0.4, audioBase: "https://unoki99.github.io/fangfang/" };

async function getAll() {
  const s = await api.storage.local.get(["saved", "settings"]);
  return { saved: Array.isArray(s.saved) ? s.saved : [], settings: Object.assign({}, DEFAULTS, s.settings || {}) };
}
const setSaved = saved => api.storage.local.set({ saved });

// "漢字\tcodes" = every meaning; "漢字\tcodes\t2" = only meaning 3 (same format as the website)
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
  try { b = JSON.parse(text); } catch (e) { return { error: "這不是方方的備份檔。" }; }
  if (!b || b.app !== "fangfang") return { error: "這不是方方的備份檔。" };
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

async function savedEntries(sys) {
  const db = await load();
  const { saved } = await getAll();
  const seen = new Set(), out = [];
  for (const s of saved) {
    const k = s.split("\t").slice(0, 2).join("\t");
    if (seen.has(k)) continue;
    seen.add(k);
    const [h, c] = k.split("\t");
    if (!db.hanMap.has(h) || !c) continue;
    const e = entry(db, h, c, sys);
    e.only = saved.includes(k) ? null : savedDefs(saved, k);
    out.push(e);
  }
  return out;
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

async function handle(msg) {
  switch (msg && msg.type) {
    case "lookup": return lookup(String(msg.text || ""), msg.rom || "lat");
    case "state": return getAll();
    case "settings": {
      const { settings } = await getAll();
      const next = Object.assign(settings, msg.settings || {});
      await api.storage.local.set({ settings: next });
      return next;
    }
    case "toggleWord": return { saved: await toggleWord(msg.k) };
    case "toggleDef": return { saved: await toggleDef(msg.k, msg.i) };
    case "savedEntries": return savedEntries(msg.rom || "lat");
    case "setSaved": await setSaved(Array.isArray(msg.saved) ? msg.saved : []); return { ok: true };
    case "import": return mergeBackup(String(msg.text || ""));
    case "audio": return fetchAudio(String(msg.url || ""));
    case "defCount": { const db = await load(); return defCount(db, msg.k); }
    default: return null;
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse, err => sendResponse({ error: String(err) }));
  return true;
});

// exported for the test harness
globalThis.__fangfang = { handle, load };
