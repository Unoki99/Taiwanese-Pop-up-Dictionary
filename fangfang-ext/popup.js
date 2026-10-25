const api = globalThis.browser || globalThis.chrome;
const send = msg => new Promise(res => {
  if (globalThis.browser) globalThis.browser.runtime.sendMessage(msg).then(res, () => res(null));
  else api.runtime.sendMessage(msg, res);
});
const $ = id => document.getElementById(id);
function paint(s) {
  $("enabled").setAttribute("aria-checked", String(!!s.settings.enabled));
  $("on-label").textContent = s.settings.enabled ? "查詞已開啟" : "查詞已關閉";
  document.querySelectorAll("#rom button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.rom === s.settings.rom)));
  $("count").textContent = new Set(s.saved.map(k => k.split("\t").slice(0, 2).join("\t"))).size;
  $("audio-base").value = s.settings.audioBase;
  const v = Math.round((s.settings.volume ?? 0.4) * 100);
  $("volume").value = v; $("vol-n").textContent = v + "%";
}
async function refresh() { const s = await send({ type: "state" }); if (s) paint(s); }
$("enabled").addEventListener("click", async () => {
  const on = $("enabled").getAttribute("aria-checked") !== "true";
  await send({ type: "settings", settings: { enabled: on } }); refresh();
});
$("rom").addEventListener("click", async e => {
  const b = e.target.closest("button[data-rom]"); if (!b) return;
  await send({ type: "settings", settings: { rom: b.dataset.rom } }); refresh();
});
$("volume").addEventListener("input", () => {
  const v = +$("volume").value;
  $("vol-n").textContent = v + "%";
  send({ type: "settings", settings: { volume: v / 100 } });
});
$("audio-base").addEventListener("change", async () => {
  let v = $("audio-base").value.trim(); if (v && !v.endsWith("/")) v += "/";
  await send({ type: "settings", settings: { audioBase: v } }); refresh();
});
$("open-saved").addEventListener("click", () => {
  api.tabs.create({ url: api.runtime.getURL("saved.html") });
  window.close();
});
refresh();
