// \u65b9\u65b9 popup dictionary: runs on web pages.
// Mac: hover over \u6f22\u5b57 to look it up. iPhone/iPad: drag the \u65b9 puck over the text.
(() => {
"use strict";
if (window.__fangfangLoaded) return;
window.__fangfangLoaded = true;

const api = globalThis.browser || globalThis.chrome;
function send(msg) {
  return new Promise(resolve => {
    try {
      if (globalThis.browser) globalThis.browser.runtime.sendMessage(msg).then(resolve, () => resolve(null));
      else api.runtime.sendMessage(msg, r => resolve(r));
    } catch (e) { resolve(null); }
  });
}

let settings = { enabled: true, rom: "lat", volume: 0.4, audioBase: "https://unoki99.github.io/fangfang/" };
let saved = [];
const HAN = /[\p{Script=Han}\u3007]/u;
// a character that can be part of a 台羅 / 白話字 word
const LAT = /[\p{Script=Latin}\p{M}\u207f\u00b7\-0-9]/u;
// …and a sign that it really is one (tone marks, ⁿ, o͘, a tone number, or syllables joined with -)
const LAT_SIGN = /[\u0300-\u036f\u207f\u0358]|[a-z][1-9]\b|[a-z]-+[a-z]/i;
const touchMode = matchMedia("(hover: none) and (pointer: coarse)").matches;

// ---------- page-level styles: highlight of the matched characters + the \u7693\u7f85 font ----------
const pageStyle = document.createElement("style");
pageStyle.textContent =
  "::highlight(fangfang){background-color:rgba(241,227,174,.55);color:inherit}" +
  "@font-face{font-family:'Fangfang Haolo';src:url('" + api.runtime.getURL("haolo.woff") + "') format('woff')}";
(document.head || document.documentElement).append(pageStyle);

// ---------- popup container (shadow DOM keeps page styles out) ----------
const host = document.createElement("fangfang-popup");
host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;";
const root = host.attachShadow({ mode: "open" });
root.innerHTML = "<style>" + STYLES() + "</style><div class='pop' hidden></div><div class='puck' hidden><span>\u65b9</span></div>";
document.documentElement.append(host);
const pop = root.querySelector(".pop");
const puck = root.querySelector(".puck");

send({ type: "state" }).then(s => {
  if (!s) return;
  settings = s.settings; saved = s.saved;
  setupPuck();
});
api.storage.onChanged.addListener(ch => {
  if (ch.saved) { saved = ch.saved.newValue || []; syncStars(); }
  if (ch.settings) {
    settings = Object.assign(settings, ch.settings.newValue || {});
    if (!settings.enabled) hide();
    if (gain) gain.gain.value = vol();
    if (player) player.volume = vol();
    updatePuck();
  }
});

// ---------- finding the character under a point ----------
function caretAt(x, y) {
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r && { node: r.startContainer, offset: r.startOffset };
  }
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  return null;
}
function charAt(x, y) {
  const c = caretAt(x, y);
  if (!c || !c.node || c.node.nodeType !== 3) return null;
  const t = c.node.data;
  for (let off of [c.offset, c.offset - 1]) {
    if (off < 0 || off >= t.length) continue;
    if (off > 0 && /[\uDC00-\uDFFF]/.test(t[off])) off--;
    const len = t.codePointAt(off) > 0xffff ? 2 : 1;
    const r = document.createRange();
    r.setStart(c.node, off); r.setEnd(c.node, off + len);
    const b = r.getBoundingClientRect();
    if (x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 2 && y <= b.bottom + 2) {
      return { node: c.node, offset: off, rect: b, ch: String.fromCodePoint(t.codePointAt(off)) };
    }
  }
  return null;
}
// the run of \u6f22\u5b57 starting at a point, possibly across several text nodes
function textFrom(node, offset, max = 14) {
  const parts = [];
  let text = "", count = 0, n = node, o = offset;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  walker.currentNode = node;
  while (n && count < max) {
    const s = n.data.slice(o);
    let used = 0, stop = false;
    for (const ch of s) {
      if (!HAN.test(ch) || count >= max) { stop = true; break; }
      text += ch; used += ch.length; count++;
    }
    parts.push({ node: n, start: o, end: o + used });
    if (stop) break;
    n = walker.nextNode(); o = 0;
  }
  return { text, parts };
}
function rangeFor(parts, chars) {
  const r = document.createRange();
  let left = chars;
  r.setStart(parts[0].node, parts[0].start);
  for (const p of parts) {
    let i = p.start;
    while (i < p.end && left > 0) { i += p.node.data.codePointAt(i) > 0xffff ? 2 : 1; left--; }
    r.setEnd(p.node, i);
    if (!left) break;
  }
  return r;
}
function highlight(range) {
  try {
    if (!globalThis.CSS || !CSS.highlights) return;
    if (range) CSS.highlights.set("fangfang", new Highlight(range)); else CSS.highlights.delete("fangfang");
  } catch (e) {}
}

// ---------- looking up ----------
let reqId = 0, shownKey = "", hideTimer = 0, dictReady = false;
// a one-line message in the popup (loading / errors)
function notice(msg, anchor) {
  cancelHide();
  shownKey = "";
  pop.textContent = "";
  const n = document.createElement("div");
  n.className = "notice"; n.textContent = msg;
  pop.append(n);
  place(new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0), anchor);
}
// the 台羅 / 白話字 word around a point in a text node: { start, text }
function latinWord(node, offset) {
  const t = node.data;
  let a = offset, b = offset;
  while (a > 0 && LAT.test(t[a - 1])) a--;
  while (b < t.length && LAT.test(t[b])) b++;
  while (a < b && /[-0-9]/.test(t[a]) && !/[0-9]/.test(t[a])) a++;    // no leading hyphens
  while (b > a && t[b - 1] === "-") b--;
  const text = t.slice(a, b);
  return text && LAT_SIGN.test(text.normalize("NFD")) ? { start: a, text } : null;
}
async function lookupLatAt(c, anchor) {
  const w = latinWord(c.node, c.offset);
  if (!w) { if (!anchor) scheduleHide(); return; }
  const key = "lat:" + w.start + ":" + c.node.data.length + ":" + w.text;
  if (key === shownKey && !pop.hidden) { cancelHide(); return; }
  const id = ++reqId;
  const res = await send({ type: "lookupLat", text: w.text, rom: settings.rom, place: settings.place });
  if (id !== reqId) return;
  if (!res || res.error || !res.entries || !res.entries.length) { if (!anchor) scheduleHide(); return; }
  dictReady = true;
  cancelHide();
  shownKey = key;
  const range = document.createRange();
  range.setStart(c.node, w.start);
  range.setEnd(c.node, Math.min(c.node.data.length, w.start + res.matchLen));
  highlight(range);
  renderPopup(res.entries);
  place(range.getBoundingClientRect(), anchor);
}
async function lookupAt(x, y, anchor) {
  const c = charAt(x, y);
  if (c && !HAN.test(c.ch) && LAT.test(c.ch) && c.ch !== "-") return lookupLatAt(c, anchor);
  if (!c || !HAN.test(c.ch)) { if (!anchor) scheduleHide(); return; }
  const key = c.offset + ":" + c.node.data.length + ":" + c.node.data.slice(c.offset, c.offset + 6);
  if (key === shownKey && !pop.hidden) { cancelHide(); return; }
  const { text, parts } = textFrom(c.node, c.offset);
  if (!text) return;
  const id = ++reqId;
  let slow = 0;
  if (!dictReady) slow = setTimeout(() => { if (id === reqId) notice("\u5b57\u5178\u8f09\u5165\u4e2d\u2026", anchor); }, 400);
  const res = await send({ type: "lookup", text, rom: settings.rom, place: settings.place });
  clearTimeout(slow);
  if (id !== reqId) return;
  if (!res || res.error) { notice("\u67e5\u8a5e\u51fa\u932f\uff1a" + (res ? res.error : "\u64f4\u5145\u529f\u80fd\u6c92\u6709\u56de\u61c9"), anchor); return; }
  dictReady = true;
  if (!res.entries || !res.entries.length) { if (!anchor) scheduleHide(); return; }
  cancelHide();
  shownKey = key;
  const range = rangeFor(parts, res.matchLen);
  highlight(range);
  renderPopup(res.entries);
  place(range.getBoundingClientRect(), anchor);
}
function scheduleHide() {
  if (hideTimer || pop.hidden) return;
  hideTimer = setTimeout(hide, 350);
}
function cancelHide() { clearTimeout(hideTimer); hideTimer = 0; }
function hide() {
  cancelHide();
  pop.hidden = true; pop.textContent = ""; shownKey = "";
  highlight(null);
}

// ---------- Mac: hover ----------
let lastMove = 0, pending = null;
// also used on iPad with a trackpad or mouse (the pointer hovers there too)
let hoverWired = false;
function wireHover() {
  if (hoverWired) return;
  hoverWired = true;
  document.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse" || !settings.enabled || dragging) return;
    if (e.target === host) { cancelHide(); return; }        // the pointer is over the popup
    pending = [e.clientX, e.clientY];
    const now = performance.now();
    if (now - lastMove < 45) { setTimeout(flush, 50); return; }
    lastMove = now; flush();
  }, { passive: true });
  document.addEventListener("keydown", e => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", () => { if (!pop.hidden) hide(); }, { passive: true });
  pop.addEventListener("mouseleave", scheduleHide);
}
if (!touchMode) wireHover();
else {
  // iPad: start hover lookups the first time a trackpad/mouse pointer appears
  const first = e => { if (e.pointerType === "mouse") { document.removeEventListener("pointermove", first, true); wireHover(); } };
  document.addEventListener("pointermove", first, true);
}
function flush() {
  if (!pending) return;
  const [x, y] = pending; pending = null;
  lookupAt(x, y);
}

// ---------- iPhone / iPad: draggable puck ----------
const PUCK = 50;
let puckPos = null, dragging = false;
function setupPuck() {
  if (!touchMode) return;
  puckPos = { x: innerWidth - PUCK - 18, y: innerHeight * 0.62 };
  movePuck();
  updatePuck();
  let start = null, moved = false, last = 0;
  puck.addEventListener("pointerdown", e => {
    e.preventDefault();
    puck.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, px: puckPos.x, py: puckPos.y };
    moved = false; dragging = true;
  });
  puck.addEventListener("pointermove", e => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    puckPos.x = Math.max(4, Math.min(innerWidth - PUCK - 4, start.px + dx));
    puckPos.y = Math.max(4, Math.min(innerHeight - PUCK - 4, start.py + dy));
    movePuck();
    if (!settings.enabled) return;
    const now = performance.now();
    if (now - last > 60) { last = now; lookupAt(puckPos.x + PUCK / 2, puckPos.y - 20, "puck"); }
  });
  const end = () => {
    if (!start) return;
    if (!moved) {                                   // a tap turns lookups on or off
      send({ type: "settings", settings: { enabled: !settings.enabled } });
    } else if (settings.enabled) {
      lookupAt(puckPos.x + PUCK / 2, puckPos.y - 20, "puck");
    }
    start = null; dragging = false;
  };
  puck.addEventListener("pointerup", end);
  puck.addEventListener("pointercancel", end);
  document.addEventListener("pointerdown", e => { if (e.target !== host) hide(); }, true);
}
function movePuck() { puck.style.left = puckPos.x + "px"; puck.style.top = puckPos.y + "px"; }
function updatePuck() {
  if (!touchMode || !puckPos) return;
  puck.hidden = false;
  puck.classList.toggle("off", !settings.enabled);
}

// ---------- placing the popup ----------
function place(rect, anchor) {
  pop.hidden = false;
  const vw = innerWidth, vh = innerHeight;
  if (anchor === "puck") {                         // phone: dock at the top or bottom, away from the finger
    pop.classList.add("docked");
    const lowPuck = puckPos.y > vh / 2;
    pop.style.left = "8px"; pop.style.right = "8px"; pop.style.width = "auto";
    pop.style.maxHeight = Math.round(vh * 0.45) + "px";
    if (lowPuck) { pop.style.top = "max(8px, env(safe-area-inset-top))"; pop.style.bottom = "auto"; }
    else { pop.style.bottom = "max(8px, env(safe-area-inset-bottom))"; pop.style.top = "auto"; }
    return;
  }
  pop.classList.remove("docked");
  pop.style.right = "auto"; pop.style.bottom = "auto";
  const w = Math.min(400, vw - 16);
  pop.style.width = w + "px";
  pop.style.maxHeight = "min(70vh, 560px)";
  let left = Math.max(8, Math.min(rect.left, vw - w - 8));
  pop.style.left = left + "px";
  const h = Math.min(pop.scrollHeight, vh * 0.7);
  let top = rect.bottom + 8;
  if (top + h > vh - 8 && rect.top - h - 8 > 8) top = rect.top - h - 8;
  pop.style.top = Math.max(8, top) + "px";
}

// ---------- popup content ----------
const isSavedWord = k => saved.some(s => s === k || s.startsWith(k + "\t"));
const wordState = k => saved.includes(k) ? "all" : isSavedWord(k) ? "some" : "none";
const defOn = (k, i) => saved.includes(k) || saved.includes(k + "\t" + i);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="hf"><rect width="12" height="24"/></clipPath></defs><path class="sf" d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/><path class="sh" clip-path="url(#hf)" d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>';

function audioURL(kind, v) {
  const base = settings.audioBase.replace(/\/?$/, "/");
  if (kind === "word") return base + "audio/" + Math.floor(v / 1000) + "/" + encodeURIComponent(v + "(1)") + ".mp3";
  return base + "leku/" + Math.floor(+v.split("-")[0] / 1000) + "/" + encodeURIComponent(v) + ".mp3";
}
let player = null, actx = null, srcNode = null, gain = null;
const vol = () => { const v = +settings.volume; return isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.4; };
const bufCache = new Map();
function stopAudio() {
  if (player) { player.pause(); player = null; }
  if (srcNode) { try { srcNode.stop(); } catch (e) {} srcNode = null; }
}
// Web Audio plays the bytes fetched by the background script, so sites with strict
// security rules (which block <audio> from other domains) still work.
async function playBytes(url) {
  const r = await send({ type: "audio", url });
  if (!r || !r.b64) throw new Error((r && r.error) || "no audio");
  const bin = atob(r.b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const buf = await new Promise((res, rej) => {
    const p = actx.decodeAudioData(u8.buffer, res, rej);
    if (p && p.then) p.then(res, rej);
  });
  bufCache.set(url, buf);
  return buf;
}
function playBtn(kind, v, small) {
  const b = el("button", "play" + (small ? " sm" : ""));
  b.type = "button"; b.innerHTML = PLAY; b.setAttribute("aria-label", "\u64ad\u653e");
  b.addEventListener("click", async e => {
    e.stopPropagation();
    stopAudio();
    const url = audioURL(kind, v);
    root.querySelectorAll(".play.on").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    const off = () => b.classList.remove("on");
    const fail = () => { off(); b.classList.add("fail"); setTimeout(() => b.classList.remove("fail"), 900); };
    // create/resume the audio context inside the click so Safari allows sound
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback"; // iPhone: play even in silent mode
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!actx && AC) actx = new AC();
      if (actx && actx.state !== "running") actx.resume();
    } catch (err) {}
    try {
      if (!actx) throw new Error("no AudioContext");
      const buf = bufCache.get(url) || await playBytes(url);
      if (!b.classList.contains("on")) return; // another button was pressed meanwhile
      const node = actx.createBufferSource();
      if (!gain) { gain = actx.createGain(); gain.connect(actx.destination); }
      gain.gain.value = vol();
      node.buffer = buf; node.connect(gain);
      node.onended = () => { if (srcNode === node) srcNode = null; off(); };
      srcNode = node; node.start();
    } catch (err) {
      // fallback: plain <audio>
      player = new Audio(url);
      player.volume = vol();
      player.onended = off;
      player.onerror = fail;
      player.play().catch(fail);
    }
  });
  return b;
}
function starBtn(k, i) {
  const b = el("button", "star" + (i == null ? "" : " dstar"));
  b.type = "button"; b.innerHTML = STAR;
  b.dataset.k = k; if (i != null) b.dataset.i = i;
  b.addEventListener("click", async e => {
    e.stopPropagation();
    const r = await send(i == null ? { type: "toggleWord", k } : { type: "toggleDef", k, i });
    if (r && r.saved) { saved = r.saved; syncStars(); }
  });
  syncStar(b);
  return b;
}
function syncStar(b) {
  const k = b.dataset.k;
  if (b.dataset.i != null) b.setAttribute("aria-pressed", String(defOn(k, +b.dataset.i)));
  else { const s = wordState(k); b.setAttribute("aria-pressed", s === "all" ? "true" : s === "some" ? "mixed" : "false"); }
  b.title = b.getAttribute("aria-pressed") === "true" ? "\u53d6\u6d88\u6536\u85cf" : "\u6536\u85cf";
}
function syncStars() { root.querySelectorAll(".star").forEach(syncStar); }

function renderPopup(entries) {
  pop.textContent = "";
  entries.forEach(e => pop.append(entryCard(e, false)));     // every result starts short; 顯示例句 opens it
}
// a reading with the guessed syllables in red
function pieces(cls, ps, plain) {
  const s = el("span", cls);
  if (!Array.isArray(ps) || !ps.length) { s.textContent = plain || ""; return s; }
  for (const [t, g] of ps) {
    if (g) s.append(el("span", "guess", t)); else s.append(document.createTextNode(t));
  }
  return s;
}
function entryCard(e, open) {
  const card = el("section", "ent" + (open ? " open" : ""));
  const top = el("div", "top");
  top.append(el("span", "h", e.h), pieces("rom", e.romP, e.rom), pieces("zy", e.zyP, e.zy));
  if (e.reg) top.append(el("span", "reg reg-" + (e.reg === "\u767d" ? "b" : e.reg === "\u6587" ? "m" : "s"), e.reg));
  if (e.sub) { const s = el("span", "reg reg-s", "\u66ff"); s.title = "\u66ff\u4ee3\u5b57\uff1a\u501f\u7528\u4f86\u5beb\u9019\u500b\u8a5e\u7684\u5b57"; top.append(s); }
  if (e.type) top.append(el("span", "reg reg-t", e.type));
  if (e.dialect) top.append(el("span", "reg reg-d", e.dialect.replace(/(\u504f\u6cc9\u8154|\u504f\u6f33\u8154|\u6df7\u5408\u8154)$/, "")));
  if (e.guess) { const g = el("span", "reg reg-t", "\u63a8\u6e2c"); g.title = "\u7d05\u8272\u7684\u8b80\u97f3\u662f\u4f9d\u898f\u5247\u63a8\u7b97\u7684\uff0c\u4e0d\u662f\u6559\u80b2\u90e8\u8fad\u5178\u7684\u8cc7\u6599"; top.append(g); }
  if (e.own) top.append(el("span", "reg reg-own", "\u81ea\u88dc"));
  const tools = el("span", "tools");
  if (e.au != null) tools.append(playBtn("word", e.au));
  tools.append(starBtn(e.k));
  top.append(tools);
  card.append(top);
  if (e.variantOf) card.append(el("div", "note", "\u300c" + e.h + "\u300d\u7684\u7570\u7528\u5b57"));
  if (e.others.length) {
    const o = el("div", "oth");
    for (const x of e.others) {
      const it = el("span", "othi");
      it.append(el("span", "othl", x.label || "\u53c8"), el("span", "rom sm", x.rom), el("span", "zy sm", x.zy));
      o.append(it);
    }
    card.append(o);
  }
  if (!e.defs.length) {
    card.append(el("div", "none", e.type === "\u81fa\u83ef\u5171\u540c" ? "\u81fa\u83ef\u5171\u540c\u8a5e\uff1a\u610f\u601d\u8ddf\u83ef\u8a9e\u4e00\u6a23\u3002" : "\u8fad\u5178\u6c92\u6709\u9019\u500b\u8b80\u97f3\u7684\u91cb\u7fa9\u3002"));
    links(card, e.syn, e.ant);
    return card;
  }
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
        const r = el("div", "exi");
        r.append(playBtn("ex", x.name, true));
        const t = el("div", "ext");
        t.append(el("div", "exh", x.h), el("div", "exr", x.r), el("div", "exm", x.zh));
        r.append(t); exs.append(r);
      }
      body.append(exs);
    }
    links(body, d.syn, d.ant);
    row.append(body, starBtn(e.k, i));
    list.append(row);
  });
  card.append(list);
  links(card, e.syn, e.ant);
  // 顯示例句 ↔ 收起 (open / close the example sentences)
  if (e.defs.some(d => d.ex.length)) {
    const more = el("button", "more", open ? "\u6536\u8d77" : "\u986f\u793a\u4f8b\u53e5");
    more.type = "button";
    const set = now => {
      card.classList.toggle("open", now);
      more.textContent = now ? "\u6536\u8d77" : "\u986f\u793a\u4f8b\u53e5";
    };
    more.addEventListener("click", ev => { ev.stopPropagation(); set(!card.classList.contains("open")); });
    card.append(more);
    // also a 收起 at the top while the examples are open, so you don't have to scroll down to close them
    const shut = el("button", "shut", "\u6536\u8d77");
    shut.type = "button";
    shut.addEventListener("click", ev => { ev.stopPropagation(); set(false); card.scrollIntoView({ block: "nearest" }); });
    tools.prepend(shut);
  }
  return card;
}

// \u8fd1\u7fa9 / \u53cd\u7fa9 words
function links(box, syn, ant) {
  for (const [name, list] of [["\u8fd1", syn], ["\u53cd", ant]]) {
    if (!list || !list.length) continue;
    const row = el("div", "lnk");
    row.append(el("span", "lnkl", name));
    list.slice(0, 8).forEach((x, i) => {
      if (i) row.append("\u3001");
      const w = el("span", "lnkw", x.h);
      if (x.rom) w.title = x.rom;
      row.append(w);
      if (x.rom) row.append(el("span", "rom xs", x.rom));
    });
    box.append(row);
  }
}

function STYLES() {
  return `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.pop {
  --bg:#1c1c1e; --key:#4a4a4c; --key-edge:#6d6d70; --fn:#2b2b2d; --fn-edge:#4b4b4e; --glyph:#f2f2f2; --muted:#a3a3a8;
  --blue:#34405e; --blue-edge:#3d4f9c; --blue-ink:#c8cfff; --green:#44503a; --green-edge:#4f6c32; --green-ink:#d4efc0;
  --purple:#4c3a5b; --purple-edge:#7b3c9b; --purple-ink:#e3c6f7; --olive:#5a5238; --olive-edge:#8c7a38; --olive-ink:#f1e3ae;
  --rust:#5b4136; --rust-edge:#8b4a2d; --rust-ink:#f3c9b2;
  --han: "PingFang TC","Heiti TC","Noto Sans TC","Microsoft JhengHei",sans-serif;
  --lat: "Fangfang Haolo","DejaVu Sans",system-ui,-apple-system,sans-serif;
  position: fixed; overflow-y: auto; overscroll-behavior: contain;
  background: var(--fn); color: var(--glyph); border: 2px solid var(--fn-edge); border-radius: 18px;
  box-shadow: 0 14px 36px rgba(0,0,0,.5); padding: 6px; font: 14px/1.5 var(--han);
  display: flex; flex-direction: column; gap: 6px; -webkit-text-size-adjust: 100%;
}
.ent { background: var(--key); border: 2px solid var(--key-edge); border-radius: 14px; padding: 8px 10px; }
.ent + .ent { background: transparent; border-color: var(--fn-edge); }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; }
.h { font: 500 1.45rem/1.3 var(--han); color: var(--blue-ink); }
.rom { font: 1.08rem/1.3 var(--lat); color: var(--green-ink); }
.zy { font: .95rem/1.3 var(--han); color: var(--purple-ink); }
.tools { display: inline-flex; gap: 6px; margin-left: auto; }
.reg { font: 700 .68rem/1 var(--han); padding: 3px 5px; border-radius: 6px; }
.reg-b { background: var(--green); color: var(--green-ink); border: 1px solid var(--green-edge); }
.reg-m { background: var(--blue); color: var(--blue-ink); border: 1px solid var(--blue-edge); }
.reg-s { background: var(--rust); color: var(--rust-ink); border: 1px solid var(--rust-edge); }
.reg-own { background: var(--olive); color: var(--olive-ink); border: 1px solid var(--olive-edge); }
.reg-t { background: var(--fn); color: var(--muted); border: 1px solid var(--fn-edge); }
.reg-d { background: var(--purple); color: var(--purple-ink); border: 1px solid var(--purple-edge); }
.guess { color: #ff7a6e; }
.oth { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; }
.othi { display: inline-flex; align-items: baseline; gap: 6px; }
.othl { font: 700 .66rem/1 var(--han); color: var(--olive-ink); background: var(--fn); border: 1px solid var(--olive-edge); border-radius: 5px; padding: 2px 4px; }
.rom.sm { font-size: .9rem; } .zy.sm { font-size: .8rem; } .rom.xs { font-size: .78rem; margin-left: 4px; }
.lnk { margin-top: 4px; font-size: .82rem; color: var(--muted); }
.lnkl { font: 700 .66rem/1 var(--han); color: var(--blue-ink); background: var(--blue); border: 1px solid var(--blue-edge); border-radius: 5px; padding: 2px 4px; margin-right: 6px; }
.lnkw { color: var(--glyph); }
.note { font-size: .78rem; color: var(--muted); margin-top: 4px; }
.defs { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 2px solid rgba(255,255,255,.08); }
.def { display: flex; gap: 8px; align-items: flex-start; }
.dn, .pos { flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: var(--fn); border: 1px solid var(--key-edge); color: var(--olive-ink); font: 700 .7rem/1.2 system-ui, sans-serif; }
.dn { min-width: 1.4em; height: 1.4em; margin-top: .15em; }
.pos { font-family: var(--han); padding: 2px 5px; margin-right: 6px; vertical-align: .1em; display: inline-block; }
.dt { flex: 1; min-width: 0; }
.exs { display: none; flex-direction: column; gap: 6px; margin: 6px 0 2px; }
.ent.open .exs { display: flex; }
.shut { display: none; background: none; border: 2px solid var(--fn-edge); border-radius: 10px; color: var(--muted); font: 700 .75rem var(--han); padding: 1px 8px; cursor: pointer; }
.ent.open .shut { display: inline-block; }
.exi { display: flex; gap: 8px; align-items: flex-start; }
.ext { display: flex; flex-direction: column; min-width: 0; }
.exh { color: var(--blue-ink); font-size: .9rem; }
.exr { color: var(--green-ink); font: .82rem/1.45 var(--lat); overflow-wrap: anywhere; }
.exm { color: var(--muted); font-size: .8rem; }
.none { color: var(--muted); font-size: .85rem; margin-top: 4px; }
.more { margin-top: 6px; background: none; border: 2px solid var(--fn-edge); border-radius: 10px; color: var(--muted); font: 700 .8rem var(--han); padding: 2px 10px; cursor: pointer; }
button { cursor: pointer; font: inherit; }
.play, .star { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; }
.play { background: rgba(79,108,50,.28); border: 2px solid var(--green-edge); color: var(--glyph); }
.play svg { width: 14px; height: 14px; }
.play.on { background: var(--green-edge); }
.play.fail { border-color: var(--rust-edge); background: var(--rust); }
.play.sm, .star.dstar { width: 22px; height: 22px; }
.play.sm svg, .star.dstar svg { width: 11px; height: 11px; }
.star { background: rgba(140,122,56,.18); border: 2px solid var(--olive-edge); }
.star svg { width: 15px; height: 15px; }
.star .sf { fill: none; stroke: var(--olive-ink); stroke-width: 1.4; stroke-linejoin: round; }
.star .sh { fill: none; }
.star[aria-pressed="true"] { background: rgba(140,122,56,.4); }
.star[aria-pressed="true"] .sf, .star[aria-pressed="mixed"] .sh { fill: var(--olive-ink); }
.notice { padding: 12px 14px; font-size: 14px; color: var(--muted, #aaa); word-break: break-word; }
.puck {
  position: fixed; width: 50px; height: 50px; border-radius: 50%; touch-action: none; user-select: none; -webkit-user-select: none;
  background: rgba(68,80,58,.92); border: 2px solid #4f6c32; color: #f2f2f2; box-shadow: 0 6px 18px rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center; font: 700 22px/1 "PingFang TC", sans-serif;
}
.puck::before { pointer-events: none; content: ""; position: absolute; top: -16px; left: 50%; width: 2px; height: 12px; margin-left: -1px; background: #d4efc0; border-radius: 1px; }
.puck.off { opacity: .45; background: rgba(43,43,45,.9); border-color: #4b4b4e; }
.puck.off::before { display: none; }
.pop.docked { width: auto; }
`;
}
})();
