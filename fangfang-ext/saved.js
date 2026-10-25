const api = globalThis.browser || globalThis.chrome;
const send = msg => new Promise(res => {
  if (globalThis.browser) globalThis.browser.runtime.sendMessage(msg).then(res, () => res(null));
  else api.runtime.sendMessage(msg, res);
});
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="hf"><rect width="12" height="24"/></clipPath></defs><path class="sf" d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/><path class="sh" clip-path="url(#hf)" d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>';
let state = { saved: [], settings: { rom: "lat", audioBase: "https://unoki99.github.io/fangfang/" } };
let entries = [];

function audioURL(kind, v) {
  const base = state.settings.audioBase.replace(/\/?$/, "/");
  if (kind === "word") return base + "audio/" + Math.floor(v / 1000) + "/" + encodeURIComponent(v + "(1)") + ".mp3";
  return base + "leku/" + Math.floor(+v.split("-")[0] / 1000) + "/" + encodeURIComponent(v) + ".mp3";
}
let player = null;
function playBtn(kind, v, small) {
  const b = el("button", "play" + (small ? " sm" : "")); b.type = "button"; b.innerHTML = PLAY; b.setAttribute("aria-label", "播放");
  b.addEventListener("click", () => {
    if (player) player.pause();
    player = new Audio(audioURL(kind, v));
    document.querySelectorAll(".play.on").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    player.onended = () => b.classList.remove("on");
    player.onerror = () => { b.classList.remove("on"); b.classList.add("fail"); setTimeout(() => b.classList.remove("fail"), 900); };
    player.play().catch(player.onerror);
  });
  return b;
}
const wordState = k => state.saved.includes(k) ? "all" : state.saved.some(s => s.startsWith(k + "\t")) ? "some" : "none";
function starBtn(k, i) {
  const b = el("button", "star" + (i == null ? "" : " dstar")); b.type = "button"; b.innerHTML = STAR;
  const on = i == null ? wordState(k) : (state.saved.includes(k) || state.saved.includes(k + "\t" + i)) ? "all" : "none";
  b.setAttribute("aria-pressed", on === "all" ? "true" : on === "some" ? "mixed" : "false");
  b.setAttribute("aria-label", on === "none" ? "收藏" : "取消收藏");
  b.addEventListener("click", async () => {
    const r = await send(i == null ? { type: "toggleWord", k } : { type: "toggleDef", k, i });
    if (r && r.saved) { state.saved = r.saved; load(); }
  });
  return b;
}
function card(e) {
  const c = el("section", "ent");
  const top = el("div", "top");
  top.append(el("span", "h", e.h), el("span", "rom", e.rom), el("span", "zy", e.zy));
  if (e.reg) top.append(el("span", "reg reg-" + (e.reg === "白" ? "b" : e.reg === "文" ? "m" : "s"), e.reg));
  if (e.own) top.append(el("span", "reg reg-own", "自補"));
  const tools = el("span", "tools");
  if (e.au != null) tools.append(playBtn("word", e.au));
  tools.append(starBtn(e.k));
  top.append(tools); c.append(top);
  if (e.only) c.append(el("div", "part", "已收藏釋義 " + e.only.map(i => i + 1).join("、")));
  if (e.defs.length) {
    const list = el("div", "defs");
    e.defs.forEach((d, i) => {
      const row = el("div", "def");
      row.append(el("span", "dn", d.n || String(i + 1)));
      const body = el("div", "dt");
      if (d.pos) body.append(el("span", "pos", d.pos));
      body.append(d.text);
      if (d.ex.length) {
        const exs = el("div", "exs");
        for (const x of d.ex) {
          const r = el("div", "exi"); r.append(playBtn("ex", x.name, true));
          const t = el("div", "ext"); t.append(el("div", "exh", x.h), el("div", "exr", x.r), el("div", "exm", x.zh));
          r.append(t); exs.append(r);
        }
        body.append(exs);
      }
      row.append(body, starBtn(e.k, i)); list.append(row);
    });
    c.append(list);
  }
  return c;
}
async function load() {
  state = (await send({ type: "state" })) || state;
  entries = (await send({ type: "savedEntries", rom: state.settings.rom })) || [];
  document.querySelectorAll("#rom button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.rom === state.settings.rom)));
  $("count").textContent = entries.length;
  ["csv-download", "csv-copy", "clear"].forEach(id => { $(id).disabled = !entries.length; });
  const list = $("list"); list.textContent = "";
  if (!entries.length) { list.append(el("div", "empty", "還沒有收藏。在網頁上查詞時，點 ☆ 就會加到這裡。")); return; }
  for (const e of entries) list.append(card(e));
}
const cell = v => (/[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
function csv() {
  const rows = [];
  for (const e of entries) {
    const wa = e.au != null ? e.au + "(1)" : "";
    if (!e.defs.length) { rows.push([e.h, e.hl, "", "", "", "", "", wa, ""]); continue; }
    e.defs.forEach((d, i) => {
      if (e.only && !e.only.includes(i)) return;
      const x = d.ex[0];
      rows.push([e.h, e.hl, d.pos, d.text, x ? x.h : "", x ? x.hl : "", x ? x.zh : "", wa, x ? x.name : ""]);
    });
  }
  return rows.map(r => r.map(cell).join(";")).join("\n") + "\n";
}
function stamp() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
function download(text, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function copy(text, btn) {
  const old = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = "已複製"; }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (err) {} ta.remove();
    btn.textContent = ok ? "已複製" : "無法複製";
  }
  setTimeout(() => { btn.textContent = old; }, 1400);
}
const backup = () => JSON.stringify({ app: "fangfang", version: 1, exported: new Date().toISOString(), saved: state.saved, myWords: [], picks: {} });

$("rom").addEventListener("click", async e => {
  const b = e.target.closest("button[data-rom]"); if (!b) return;
  await send({ type: "settings", settings: { rom: b.dataset.rom } }); load();
});
$("csv-download").addEventListener("click", () => download("﻿" + csv(), "台語收藏-" + stamp() + ".csv", "text/csv;charset=utf-8"));
$("csv-copy").addEventListener("click", e => copy(csv(), e.currentTarget));
let armed = 0;
$("clear").addEventListener("click", async () => {
  const b = $("clear");
  if (!armed) { b.textContent = "確定清除？"; b.classList.add("armed"); armed = setTimeout(() => { armed = 0; b.textContent = "全部清除"; b.classList.remove("armed"); }, 3000); return; }
  clearTimeout(armed); armed = 0; b.textContent = "全部清除"; b.classList.remove("armed");
  await send({ type: "setSaved", saved: [] }); load();
});
$("bk-export").addEventListener("click", () => { download(backup(), "方方備份-" + stamp() + ".json", "application/json"); $("msg").textContent = "已匯出。"; });
async function importText(t) {
  const r = await send({ type: "import", text: t });
  $("msg").textContent = !r ? "匯入失敗。" : r.error ? r.error : "已匯入 " + r.added + " 個新詞。";
  load();
}
$("bk-file").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const fr = new FileReader(); fr.onload = () => { importText(String(fr.result)); e.target.value = ""; }; fr.readAsText(f);
});
$("bk-copy").addEventListener("click", e => copy(backup(), e.currentTarget));
$("bk-paste").addEventListener("click", () => { const t = $("bk-text").value.trim(); if (t) { importText(t); $("bk-text").value = ""; } });
api.storage.onChanged.addListener(ch => { if (ch.saved || ch.settings) load(); });
load();
