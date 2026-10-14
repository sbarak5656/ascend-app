"use strict";
const APP_SCHEMA = 2;                       // highest content schema this build understands
const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const KEY = "climbprog.v1";
const CONTENT_KEY = "climbprog.content";

/* ---------------- content: bundled, or a newer cached live update ---------------- */
const BUNDLED = window.PROGRAM;
let P = BUNDLED;
try {
  const c = JSON.parse(localStorage.getItem(CONTENT_KEY) || "null");
  if (c && c.weeks && c.schema <= APP_SCHEMA && c.version > BUNDLED.version) P = c;
} catch (e) {}

/* ---------------- state ---------------- */
const blankState = () => ({ schema:2, start:"", checks:{}, sets:{}, kit:null, equip:{}, done:{}, grades:{}, weights:[], notes:{}, swaps:{},
                            tests:[], focus:[], contentUrl:"", lastCheck:"" });
let S = blankState();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  Object.assign(S, saved);
  if (!saved.schema) S.schema = 1;          // data saved by the first version has no schema field
} catch (e) {}
/* Native (Capacitor) plugins are optional: in a browser or an older APK every helper quietly falls back. */
function plug(name){
  const C = window.Capacitor;
  try { return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins[name]) || null; } catch (e) { return null; }
}
let mirrorTimer = null;
function mirrorState(){
  const Pref = plug("Preferences");
  if (!Pref) return;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => { try { Pref.set({ key:"state", value:JSON.stringify(S) }); } catch (e) {} }, 400);
}
function save(){
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  mirrorState();     // second copy in native storage: survives the WebView's storage being cleared
}

/* v1 saved progress by item position; v2 uses stable item ids so content updates can't misalign it */
(function migrate(){
  if (S.schema >= 2) return;
  for (const bag of ["checks","swaps"]){
    const out = {};
    for (const [k,v] of Object.entries(S[bag] || {})){
      const m = k.match(/^(\d+)-(\d+)-(\d+)$/);
      const it = m && BUNDLED.weeks[m[1]-1] && BUNDLED.weeks[m[1]-1].days[m[2]].items[m[3]];
      out[it && it.id ? `${m[1]}-${m[2]}-${it.id}` : k] = v;
    }
    S[bag] = out;
  }
  S.schema = 2; save();
})();

/* ---------------- live content updates ---------------- */
const contentUrl = () => S.contentUrl || (window.APP_CONFIG || {}).contentUrl || "";
function toast(msg, ms = 4500, action){
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.querySelectorAll("button").forEach(b => b.remove());
  if (action){
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { t.classList.remove("show"); action.run(); };
    t.append(b);
  }
  t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), ms);
}
async function checkUpdates(){
  const url = contentUrl();
  if (!url) return { status:"nourl" };
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache:"no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const c = await r.json();
    if (!c || !c.weeks || !c.version) return { status:"bad" };
    S.lastCheck = new Date().toISOString(); save();
    if (c.schema > APP_SCHEMA) return { status:"appold", version:c.version };
    if (c.version > P.version){
      P = c;
      try { localStorage.setItem(CONTENT_KEY, JSON.stringify(c)); } catch (e) {}
      applyPlan();
      route();
      toast(`Program updated to version ${c.version}: ${((c.changelog || [])[0] || {notes:[]}).notes.join("; ")}`, 8000);
      return { status:"updated", version:c.version };
    }
    return { status:"current", version:P.version };
  } catch (e) {
    return { status:"error", error:String(e && e.message || e) };
  }
}

/* ---------------- over-the-air UI updates (signed bundles, verified by the boot loader) ---------------- */
const uiUrl = () => S.uiUrl || (window.APP_CONFIG || {}).uiUrl || "";
async function checkUiUpdate(){
  const url = uiUrl();
  if (!url) return { status:"nourl" };
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache:"no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const b = await r.json();
    if (!b || !b.js || !b.css || !b.version || !b.sig) return { status:"bad" };
    const running = window.UI_RUNNING_VERSION || 0;
    let bad = 0; try { bad = +localStorage.getItem("climbprog.ui.bad") || 0; } catch (e) {}
    if (b.version <= running || b.version <= bad) return { status:"current", version:running };
    if (!window.__uiVerify || !(await window.__uiVerify(b))) return { status:"unsigned" };
    try { localStorage.setItem("climbprog.ui", JSON.stringify(b)); } catch (e) { return { status:"error", error:"storage full" }; }
    toast(`New look ready (UI v${b.version})`, 12000, { label:"Restart", run:() => location.reload() });
    return { status:"updated", version:b.version };
  } catch (e) {
    return { status:"error", error:String(e && e.message || e) };
  }
}

/* ---------------- helpers ---------------- */
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs || {})){
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  (function add(list){
    for (const c of list){
      if (c == null || c === false) continue;
      if (Array.isArray(c)) add(c);
      else el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  })(kids);
  return el;
}
const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
const secs = t => { const [m,s] = t.split(":").map(Number); return m*60 + s; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parseYmd = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
const phaseOf = n => P.phases.find(p => n >= p.from && n <= p.to);
const dayKey = (w,d) => `${w}-${d}`;
/* focus add-ons: library exercises pinned from the test report, shown on the matching strength day */
function focusItem(k){
  const e = P.library[k], rest = (e.rx.match(/rest (\d+)s/) || [])[1];
  return { id:"focus-" + k, key:k, name:e.name, rx:e.rx, cue:e.cue, note:"", detail:e.rx + ". " + e.cue, text:e.name + " — " + e.rx,
           alts:e.alts, needs:e.needs || [], group:e.group || "", block:"Focus add-on · from your tests", focus:true, rest: rest ? +rest : undefined };
}
/* ---------------- equipment-aware tailoring ---------------- */
const eqList = () => P.equipment || [];
const eqName = id => (eqList().find(e => e.id === id) || { name:id }).name;
const kitDefault = () => Array.isArray(S.kit) ? S.kit : (P.equipment_default || []);
const kitFor = (w, d) => (S.equip && Array.isArray(S.equip[dayKey(w, d)])) ? S.equip[dayKey(w, d)] : kitDefault();
const hasAll = (needs, E) => (needs || []).every(n => E.has(n));
const missingOf = (needs, E) => (needs || []).filter(n => !E.has(n));
function adaptRx(itemRx, candRx){
  const a = (itemRx || "").match(/^(\d+)×/), b = (candRx || "").match(/^(\d+)×(.*)$/);
  return a && b ? `${a[1]}×${b[2]}` : (candRx || itemRx || "");     // keep the set count, take the substitute's reps/rest
}

/* the session's exercises before any equipment tailoring (day items + pinned focus add-ons) */
function rawDayItems(w, d){
  const day = P.weeks[w-1].days[d];
  const areas = day.areas && day.areas.length ? day.areas : null;
  const extra = (S.focus || []).filter(k => {
    const e = P.library && P.library[k];
    if (!e) return false;
    const area = e.area || (e.day === "Thursday" ? "upper" : "lower");
    return areas ? areas.includes(area) : e.day === day.day;
  }).map(focusItem);
  return day.items.concat(extra);
}

/* Replace what can't be done with what's available:
   1) one of the exercise's own swap options that fits the kit, 2) another exercise from the same movement family
   (then fallback families), 3) otherwise skip it and say why. Sets/reps/rest follow the original prescription. */
function tailorItems(items, kit){
  const E = new Set(kit);
  const lib = P.library || {};
  const fallback = P.group_fallback || {};
  const rank = { swap:0, easier:1, harder:2 };
  const taken = new Set(items.map(i => i.key).filter(Boolean));
  const usedNames = new Set(items.map(i => i.name).filter(Boolean));    // never use the same exercise twice in a workout
  const out = [], skipped = [];
  let adapted = 0;
  items.forEach(it => {
    const needs = it.needs || [];
    if (!needs.length || hasAll(needs, E)){ out.push(it); return; }
    const missing = missingOf(needs, E);
    const own = (it.alts || []).map((a, i) => ({ a, i })).filter(x => hasAll(x.a.needs, E) && !usedNames.has(x.a.name))
      .sort((p, q) => (rank[p.a.kind] - rank[q.a.kind]) || ((p.a.needs || []).length - (q.a.needs || []).length));
    if (own.length){
      usedNames.add(it.alts[own[0].i].name);
      out.push(Object.assign({}, it, { auto:{ altIndex:own[0].i, missing } }));
      adapted++;
      return;
    }
    const area = (lib[it.key] || {}).area;
    const families = [it.group, ...(fallback[it.group] || [])].filter(Boolean);
    for (const g of families){
      const cands = Object.entries(lib).filter(([k, e]) => e.group === g && !taken.has(k) && !usedNames.has(e.name) && hasAll(e.needs, E) &&
        (g !== it.group || !area || e.area === area));
      if (!cands.length) continue;
      cands.sort((p, q) => (p[1].needs || []).length - (q[1].needs || []).length);
      const [k, e] = cands[0];
      taken.add(k);
      usedNames.add(e.name);
      const alts = (it.alts || []).concat([{ kind:"swap", name:e.name, detail:e.cue, needs:e.needs || [], rx:adaptRx(it.rx, e.rx) }]);
      out.push(Object.assign({}, it, { alts, auto:{ altIndex:alts.length - 1, missing } }));
      adapted++;
      return;
    }
    // nothing fits: say what would bring it back (cheapest kits first)
    const opts = [];
    const addOpt = n => { if (n && n.length && !opts.some(o => o.join() === n.join())) opts.push(n); };
    (it.alts || []).forEach(a => addOpt(a.needs));
    families.forEach(g => Object.values(lib).filter(x => x.group === g).forEach(x => addOpt(x.needs)));
    opts.sort((a, b) => a.length - b.length);
    skipped.push({ item:it, missing, options:opts.filter(o => !o.some(n => missing.includes(n))).slice(0, 3) });
  });
  return { items:out, skipped, adapted };
}
function tailoredDay(w, d){
  const day = P.weeks[w-1].days[d];
  const kit = kitFor(w, d);
  const base = rawDayItems(w, d);
  if (day.rest) return { items:base, skipped:[], adapted:0, kit, base };
  return Object.assign(tailorItems(base, kit), { kit, base });
}
function dayItems(w, d){ return tailoredDay(w, d).items; }
const ik = (w, d, it) => `${w}-${d}-${it.id}`;
function progress(w, d){
  const items = dayItems(w, d);
  const n = items.length;
  const c = items.filter(it => S.checks[ik(w,d,it)]).length;
  return { n, c, pct: n ? Math.round(100*c/n) : 0, done: !!S.done[dayKey(w,d)] };
}
function weekProgress(w){
  let done = 0, total = 0;
  P.weeks[w-1].days.forEach((day, d) => {
    if (day.rest) return;
    total++;
    if (S.done[dayKey(w, d)]) done++;
  });
  return { done, total };
}
/* where is "today" in the program? */
function position(){
  if (!S.start) return null;
  const s = parseYmd(S.start);
  const startMon = new Date(s); startMon.setDate(s.getDate() - (s.getDay()+6)%7);
  const now = new Date(); now.setHours(0,0,0,0);
  const days = Math.round((now - startMon) / 864e5);
  const dow = (now.getDay()+6)%7;
  const week = Math.floor(days/7) + 1;
  return { week, dow, before: week < 1, after: week > 12 };
}
const youtube = q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q + " exercise form");

/* ---------------- icons + small UI helpers ---------------- */
const ICONS = {
  today:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4"/>',
  program:'<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  mobility:'<circle cx="12" cy="5" r="2"/><path d="M12 8v5M6 11l6 2 6-2M9 21l3-8 3 8"/>',
  tests:'<path d="M5 20v-6M12 20V5M19 20v-10"/>',
  log:'<path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2V3z"/><path d="M9 8h7M9 12h7"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  climb:'<path d="M3 20l6-11 4 6 3-4 5 9H3z"/>',
  strength:'<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>',
  cardio:'<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  rest:'<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l8-8"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  timer:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/>',
  swap:'<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  play:'<path d="M8 5l11 7-11 7z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
};
function icon(name, size){
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  if (size){ s.setAttribute("width", size); s.setAttribute("height", size); }
  s.innerHTML = ICONS[name] || "";
  return s;
}
function ring(pct){
  const R = 26, C = 2 * Math.PI * R, ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  const mk = cls => { const c = document.createElementNS(ns, "circle"); c.setAttribute("class", cls); c.setAttribute("cx", 32); c.setAttribute("cy", 32); c.setAttribute("r", R); c.setAttribute("fill", "none"); c.setAttribute("stroke-width", 6); c.setAttribute("stroke-linecap", "round"); return c; };
  const tr = mk("tr"), fg = mk("fg");
  fg.style.strokeDasharray = C;
  svg.append(tr, fg);
  const lab = h("b", {});
  const el = h("div", {class:"ring", role:"img"}, svg, lab);
  el.set = p => { fg.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(100, p)) / 100); lab.textContent = Math.round(p) + "%"; el.classList.toggle("full", p >= 100); el.setAttribute("aria-label", Math.round(p) + " percent complete"); };
  el.set(pct);
  return el;
}
const buzz = pattern => {
  try {
    const H = plug("Haptics");
    const ms = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
    if (H) H.vibrate({ duration: Math.min(500, ms || 30) });
    else if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {}
};
let wakeLock = null;
async function setAwake(on){
  try {
    if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    else if (wakeLock){ await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.keepAwake) setAwake(true); });
function dayKind(day){
  const a = day.areas;
  if (Array.isArray(a) && (a.length || day.rest)){
    if (a.includes("climb")) return "climb";
    if (a.some(x => STRENGTH_AREAS.includes(x))) return "strength";
    if (a.includes("cardio")) return "cardio";
    return "rest";
  }
  const t = (day.title + " " + day.day).toLowerCase();       // content without modules
  if (/climb/.test(t)) return "climb";
  if (/strength|core|upper|lower|antagonist|posterior/.test(t)) return "strength";
  if (/cardio|zone|interval|circuit|conditioning|wind/.test(t)) return "cardio";
  return "rest";
}
const DAY_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function dayStatus(w, d){
  const p = progress(w, d);
  return p.done ? "done" : (p.c > 0 ? "part" : "");
}
function celebrate(){
  try {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#f39a47", "#d9481b", "#2f7be0", "#1f9d55", "#f2c14e", "#9b6bff"];
    const box = h("div", {class:"confetti", "aria-hidden":"true"});
    for (let i = 0; i < 30; i++){
      box.append(h("i", {style:`left:${Math.random()*100}%;background:${colors[i % colors.length]};animation-delay:${(Math.random()*.3).toFixed(2)}s;--dx:${Math.round((Math.random()*2-1)*110)}px;--r:${Math.round(Math.random()*720)}deg`}));
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 2400);
  } catch (e) {}
}
function programProgress(){
  let done = 0, total = 0;
  P.weeks.forEach(w => { const wp = weekProgress(w.n); done += wp.done; total += wp.total; });
  return { done, total, pct: total ? Math.round(100 * done / total) : 0 };
}

/* ---------------- weekly plan: which days train which body areas ---------------- */
const AREA_ORDER = ["climb", "lower", "upper", "core", "cardio", "recovery"];
const STRENGTH_AREAS = ["lower", "upper", "core"];
const areaName = a => (P.areas || {})[a] || ({lower:"Lower body", upper:"Upper body", core:"Core", climb:"Climbing", cardio:"Cardio", recovery:"Recovery"})[a] || a;
const defaultPlan = () => (P.plan_default || [["lower","core"],["cardio"],["climb"],["upper"],["climb"],["recovery"],["climb"]]).map(a => a.slice());
function currentPlan(){
  const d = S.plan && S.plan.days;
  return (Array.isArray(d) && d.length === 7) ? d : defaultPlan();
}
const isWorkoutDay = tags => tags.some(t => t !== "recovery");
const trainingDays = () => currentPlan().map((t, i) => isWorkoutDay(t) ? i : -1).filter(i => i >= 0);
function mobilityFor(areas, when, first){
  const mf = P.mobility_for || {};
  const out = [];
  (first || "").split(" or ").forEach(v => { if (v && P.mobility[when][v] && !out.includes(v)) out.push(v); });
  areas.forEach(a => ((mf[a] || {})[when] || []).forEach(v => { if (P.mobility[when][v] && !out.includes(v)) out.push(v); }));
  return out.slice(0, 3);
}
function resolveDay(week, d){
  const dayName = DAY_NAMES[d];
  const mods = week.modules;
  if (!mods){                                   // content from before flexible plans: the fixed schedule
    const base = (week.days0 || week.days)[d];
    return Object.assign({}, base, { areas: [] });
  }
  const tags = currentPlan()[d] || [];
  const areas = AREA_ORDER.filter(a => tags.includes(a));
  if (!areas.length || (areas.length === 1 && areas[0] === "recovery" && false)){
    return { day:dayName, title:"Rest day", items:[], note:"", areas:[], rest:true, pre:null,
             post:mobilityFor(["recovery"], "post").join(" or ") || null };
  }
  const plan = currentPlan();
  const climbBefore = plan.slice(0, d).filter(t => t.includes("climb")).length;
  const parts = areas.map(a => {
    if (a === "climb"){
      const m = mods.climb[climbBefore % mods.climb.length];
      return { area:a, title:m.title, items:m.items, note:"", pre:m.pre, post:m.post };
    }
    const m = mods[a];
    return { area:a, title:m.title, items:m.items, note:m.note || "" };
  });
  const combined = parts.length > 1;
  const items = [];
  const used = {};
  parts.forEach(pt => pt.items.forEach(it => {
    const c = Object.assign({}, it);
    if (combined && !c.block) c.block = areaName(pt.area);
    let id = c.id || "item"; const n = used[id] = (used[id] || 0) + 1;
    if (n > 1) c.id = id + "-" + n;
    items.push(c);
  }));
  const strength = parts.filter(pt => STRENGTH_AREAS.includes(pt.area));
  let title;
  if (parts.length === 1) title = parts[0].title + (STRENGTH_AREAS.includes(parts[0].area) && mods.label ? " · " + mods.label : "");
  else title = areas.map(areaName).join(" + ") + (strength.length && mods.label ? " · " + mods.label : "");
  const climbPart = parts.find(pt => pt.area === "climb");
  return {
    day:dayName, title, items, areas,
    note: (strength.find(pt => pt.note) || {}).note || "",
    pre: mobilityFor(areas, "pre", climbPart && climbPart.pre).join(" or ") || null,
    post: mobilityFor(areas, "post", climbPart && climbPart.post).join(" or ") || null
  };
}
function applyPlan(){
  P.weeks.forEach(w => {
    if (!w.days0) w.days0 = w.days;
    w.days = DAY_NAMES.map((_, d) => resolveDay(w, d));
  });
}
function areaScheduled(area){ return currentPlan().some(t => t.includes(area)); }
function savePlan(days){
  S.plan = { days: days.map(t => AREA_ORDER.filter(a => t.includes(a))) };
  save(); applyPlan();
  if (S.reminders && S.reminders.on){ S.reminders.days = trainingDays(); save(); applyReminders(); }
}

function weekStrip(w, cur){
  const pos = position();
  return h("nav", {class:"strip", "aria-label":"Days of the week"}, P.weeks[w-1].days.map((day, i) => {
    const st = dayStatus(w, i);
    const now = pos && pos.week === w && pos.dow === i;
    return h("a", {href:`#day/${w}/${i}`, class:[st, now ? "now" : "", i === cur ? "cur" : ""].join(" ").trim(), "aria-label":`${day.day}: ${day.title}`},
      h("span", {}, DAY_SHORT[i]),
      h("span", {class:"dot"}, icon(st === "done" ? "check" : dayKind(day))));
  }));
}

/* ---------------- audio + rest timer ---------------- */
let audio;
function beep(n=2){
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    for (let i=0;i<n;i++){
      const o = audio.createOscillator(), g = audio.createGain();
      o.connect(g); g.connect(audio.destination); o.frequency.value = 880;
      const t = audio.currentTime + i*0.25;
      g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t+0.2);
      o.start(t); o.stop(t+0.22);
    }
  } catch (e) {}
}
let restTimer = null, restEnd = 0, restTotal = 0;
const restEl = () => document.getElementById("rest");
function restPaint(){
  const left = Math.max(0, Math.ceil((restEnd - Date.now()) / 1000));
  document.getElementById("restTime").textContent = fmt(left);
  document.getElementById("restBar").style.width = (restTotal ? Math.min(100, 100 * left / restTotal) : 0) + "%";
  if (left <= 0){
    clearInterval(restTimer);
    restEl().classList.add("done");
    beep(3); buzz([160, 80, 160]);
    setTimeout(() => restEl().classList.remove("show", "done"), 2500);
  }
}
function startRest(sec, label){
  clearInterval(restTimer);
  restTotal = sec; restEnd = Date.now() + sec * 1000;
  document.getElementById("restLabel").textContent = label || "Rest";
  restEl().classList.remove("done"); restEl().classList.add("show");
  restPaint(); restTimer = setInterval(restPaint, 250);
}
document.getElementById("restStop").onclick = () => { clearInterval(restTimer); restEl().classList.remove("show", "done"); };
document.getElementById("restMinus").onclick = () => { restEnd -= 15000; restPaint(); };
document.getElementById("restPlus").onclick = () => { restEnd += 15000; restTotal += 15; restPaint(); };

/* ---------------- mobility modal ---------------- */
let mobTimer = null;
function closeModal(){ clearInterval(mobTimer); document.getElementById("modal").style.display = "none"; }
document.getElementById("modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

function openMobility(kind, variants){
  const sugg = variants.split(" or ");
  const all = [...sugg, ...Object.keys(P.mobility[kind]).filter(v => !sugg.includes(v))];
  let cur = sugg[0];
  const sheet = document.getElementById("sheet");
  const render = () => {
    clearInterval(mobTimer);
    const r = P.mobility[kind][cur];
    const total = secs(r.steps[r.steps.length-1].to);
    let elapsed = 0, running = false, lastStep = -1;
    const stepEls = r.steps.map(s => h("div", {class:"step"},
      h("div", {class:"time"}, `${s.from}–${s.to}`),
      h("div", {}, h("b", {}, s.title), s.detail ? h("div", {class:"small"}, s.detail) : null)));
    const clock = h("b", {style:"font-size:22px;font-variant-numeric:tabular-nums"}, `0:00 / ${fmt(total)}`);
    const go = h("button", {class:"btn sm"}, "Start guided timer");
    const paint = () => {
      clock.textContent = `${fmt(elapsed)} / ${fmt(total)}`;
      const idx = r.steps.findIndex(s => elapsed >= secs(s.from) && elapsed < secs(s.to));
      stepEls.forEach((el,i) => el.classList.toggle("now", i === idx));
      if (running && idx !== lastStep && idx >= 0){ if (lastStep !== -1) beep(1); stepEls[idx].scrollIntoView({block:"nearest"}); }
      lastStep = idx;
    };
    go.onclick = () => {
      running = !running;
      go.textContent = running ? "Pause" : "Resume";
      clearInterval(mobTimer);
      if (running) mobTimer = setInterval(() => { elapsed++; if (elapsed >= total){ clearInterval(mobTimer); running = false; go.textContent = "Done ✓"; beep(3);} paint(); }, 1000);
    };
    sheet.replaceChildren(
      h("div", {class:"row spread"},
        h("h2", {}, `${kind === "pre" ? "Pre-climb" : "Post-workout"} mobility`),
        h("button", {class:"iconbtn", onclick:closeModal}, "✕")),
      h("div", {class:"tabsmini"},
        all.map(v => h("button", {class: v === cur ? "on" : "", title:P.mobility[kind][v].name, onclick:() => { cur = v; render(); }}, (sugg.includes(v) ? "★ " : "") + v)),
        h("button", {onclick:() => { const others = all.filter(v => v !== cur); cur = others[Math.floor(Math.random()*others.length)]; render(); }}, "🎲 Surprise me")),
      h("p", {class:"muted small", style:"margin:0 0 4px"}, h("b", {}, `Variant ${cur} — ${r.name}. `), r.use, sugg.includes(cur) ? "" : " (Not today's suggestion — a fun alternative.)"),
      r.tags ? h("div", {class:"chips", style:"margin:0 0 6px"}, r.tags.map(t => h("span", {class:"chip"}, t))) : null,
      h("div", {class:"row spread", style:"margin:8px 0"}, clock, go),
      ...stepEls);
    paint();
  };
  render();
  document.getElementById("modal").style.display = "flex";
}

/* ---------------- views ---------------- */
const app = document.getElementById("app");
const views = {};

function crumbs(...parts){
  return h("div", {class:"crumbs muted"}, parts.map((p,i) => [i ? " › " : "", p.href ? h("a", {href:p.href}, p.t) : p.t]));
}
function phasePill(w){ const p = phaseOf(w); return h("span", {class:`pill p${p.n}`}, `Phase ${p.n} · ${p.name}`); }

function sessionCard(w, d){
  const week = P.weeks[w-1], day = week.days[d];
  const key = dayKey(w, d), phase = phaseOf(w);
  const td = tailoredDay(w, d);
  const all = td.items;
  const ringEl = ring(0), count = h("span", {class:"glass num"});
  const sbar = h("i", {}), stext = h("b", {});
  const doneBtn = h("button", {class:"btn block"});
  let wasComplete = null;
  const repaint = () => {
    const p = progress(w, d);
    ringEl.set(p.done ? 100 : p.pct);
    count.textContent = `${p.c}/${p.n} steps`;
    sbar.style.width = (p.done ? 100 : p.pct) + "%";
    stext.textContent = `${p.c}/${p.n}`;
    const complete = p.n > 0 && p.c === p.n;
    if (wasComplete === false && complete){ celebrate(); buzz([40, 60, 40]); toast("Every step done — mark the session complete 💪"); }
    wasComplete = complete;
    doneBtn.textContent = p.done ? "✓ Session done — tap to undo" : "Mark session done";
    doneBtn.className = "btn block" + (p.done ? " ghost" : "");
  };
  doneBtn.onclick = () => {
    if (S.done[key]) delete S.done[key];
    else { S.done[key] = 1; buzz(40); celebrate(); toast("Session logged — nice work 💪"); }
    save(); repaint();
  };

  const KIND = {easier:"Easier", harder:"Harder", swap:"Swap"};
  const renderItem = i => {
    const it = all[i];
    const ck = ik(w, d, it);
    const manual = S.swaps[ck];                       // undefined = follow the equipment tailoring, -1 = original on purpose
    const alt = manual === -1 ? null
      : (manual != null && it.alts ? it.alts[manual]
        : (it.auto && it.alts ? it.alts[it.auto.altIndex] : null));
    const adaptedFor = manual == null && it.auto ? it.auto.missing : null;
    const baseRx = it.rx || "";
    const rx = alt ? (alt.rx !== undefined ? alt.rx : baseRx) : baseRx;
    const name = alt ? alt.name : it.name;
    const restSec = alt ? (((rx.match(/rest (\d+)s/) || [])[1] | 0) || it.rest) : it.rest;
    const sets = rx.split(/,\s*/).filter(x => x && !/^rest\b/.test(x)).join(" · ");
    const cue = alt ? alt.detail : (it.cue != null ? it.cue : (it.rx ? it.detail.slice(it.rx.length).replace(/^\.\s*/, "") : ""));
    const note = alt ? "" : (it.note || "");
    const plain = !alt && it.name && !it.rx ? it.detail : "";
    const label = name || it.text.slice(0, 40);

    const nSets = (() => { const m = rx.match(/^(\d{1,2})\s*[×x]/); return m && +m[1] >= 2 && +m[1] <= 8 ? +m[1] : 0; })();
    S.sets = S.sets || {};
    let paintSets = () => {};
    const li = h("li", {class:"item" + (S.checks[ck] ? " done" : "")});
    const box = h("input", {type:"checkbox", class:"check", checked:S.checks[ck], "aria-label":"Done: " + label, onchange:() => {
      if (box.checked){ S.checks[ck] = 1; if (nSets) S.sets[ck] = nSets; }
      else { delete S.checks[ck]; delete S.sets[ck]; }
      li.classList.toggle("done", box.checked); paintSets(); save(); repaint();
      if (box.checked){ buzz(15); if (restSec && !nSets) startRest(restSec, "Rest · " + label); }
    }});
    let setsEl = null;
    if (nSets){
      const dots = [];
      paintSets = () => {
        const n = S.sets[ck] || (S.checks[ck] ? nSets : 0);
        dots.forEach((b, i) => { b.classList.toggle("on", i < n); b.setAttribute("aria-pressed", i < n ? "true" : "false"); });
      };
      for (let i = 0; i < nSets; i++){
        dots.push(h("button", {class:"setdot", "aria-label":`Set ${i + 1} of ${nSets}`, onclick:() => {
          const cur = S.sets[ck] || (S.checks[ck] ? nSets : 0);
          const next = (i + 1 === cur) ? i : i + 1;            // tap the last filled set again to undo it
          S.sets[ck] = next;
          const all = next >= nSets;
          if (all) S.checks[ck] = 1; else delete S.checks[ck];
          box.checked = all; li.classList.toggle("done", all);
          save(); paintSets(); repaint();
          if (next > cur){
            buzz(15);
            if (!all && restSec) startRest(restSec, `Rest · set ${next} of ${nSets} · ${label}`);
          }
        }}, String(i + 1)));
      }
      setsEl = h("div", {class:"setrow"}, h("span", {class:"muted small"}, "Sets"), dots);
      paintSets();
    }

    const meta = [];
    if (sets) meta.push(h("span", {class:"chip rx"}, sets));
    if (restSec) meta.push(h("button", {class:"chip go", onclick:() => startRest(restSec, "Rest · " + label)}, icon("timer"), `${restSec}s rest`));

    const tools = [];
    if (adaptedFor) tools.push(h("span", {class:"chip adapt"}, icon("swap"), "Adapted · no " + adaptedFor.map(eqName).join(", ").toLowerCase()));
    let panel = null;
    if (it.alts && it.alts.length){
      const kitSet = new Set(td.kit);
      const effIdx = manual != null ? manual : (it.auto ? it.auto.altIndex : null);
      const choose = idx => {
        if (idx == null){ if (it.auto) S.swaps[ck] = -1; else delete S.swaps[ck]; }
        else S.swaps[ck] = idx;
        save(); li.replaceWith(renderItem(i));
      };
      const opt = (idx, kind, nm, cueText, needs) => {
        const lacking = missingOf(needs, kitSet);
        const on = idx == null ? (effIdx == null || effIdx === -1) : effIdx === idx;
        return h("button", {class:"opt" + (on ? " on" : "") + (lacking.length ? " unavail" : ""), onclick:() => choose(idx)},
          h("span", {class:"kind " + (kind || "")}, kind ? KIND[kind] : "Original"), h("b", {}, nm),
          lacking.length ? h("span", {class:"need small"}, "Needs " + lacking.map(eqName).join(", ")) : null,
          cueText ? h("span", {class:"muted small"}, cueText) : null);
      };
      panel = h("div", {class:"swaps", hidden:true}, opt(null, null, it.name || it.text.slice(0, 40), "", it.needs),
        it.alts.map((a, idx) => opt(idx, a.kind, a.name, a.detail, a.needs)));
      tools.push(h("button", {class:"chip go", onclick:() => { panel.hidden = !panel.hidden; }}, icon("swap"), alt ? "Swapped" : `Swap (${it.alts.length})`));
    }
    if (alt) tools.push(h("a", {class:"chip", href:youtube(alt.name), target:"_blank", rel:"noopener"}, icon("play"), "Form"));
    else if (it.ref) tools.push(h("a", {class:"chip", href:youtube(it.ref), target:"_blank", rel:"noopener"}, icon("play"), "New · see form"));
    if (it.focus) tools.push(h("button", {class:"chip", onclick:() => { S.focus = S.focus.filter(k => k !== it.key); save(); route(true); }}, "✕ Remove focus"));

    li.append(box, h("div", {class:"body"},
      name ? h("div", {class:"name"}, name) : h("div", {class:"txt"}, it.text),
      meta.length ? h("div", {class:"chips"}, meta) : null,
      setsEl,
      plain ? h("div", {class:"txt muted"}, plain) : null,
      note ? h("div", {class:"note"}, note) : null,
      alt ? h("div", {class:"swapnote"}, (adaptedFor ? "Adapted from: " : "Swapped from: ") + (it.name || it.text.slice(0, 40))) : null,
      cue ? h("details", {}, h("summary", {}, "How to do it"), h("p", {}, cue)) : null,
      tools.length ? h("div", {class:"chips"}, tools) : null,
      panel));
    return li;
  };
  const items = [];
  all.forEach((it, i) => {
    if (it.block && it.block !== (all[i-1] || {}).block) items.push(h("li", {class:"blockhead"}, it.block));
    items.push(renderItem(i));
  });

  const hasEquipmentModel = day.items.some(x => x.needs !== undefined);
  const eqCard = () => {
    if (!hasEquipmentModel || day.rest) return null;
    const overridden = Array.isArray(S.equip && S.equip[key]);
    const names = td.kit.map(eqName);
    const summary = names.length ? names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : "") : "Bodyweight only";
    const note = (td.adapted || td.skipped.length)
      ? `Tailored to your equipment: ${td.adapted} swapped${td.skipped.length ? ` · ${td.skipped.length} skipped` : ""}.` : "Nothing needs changing: everything in this workout fits your equipment.";
    return h("div", {class:"card eqcard"},
      h("div", {class:"row spread"},
        h("div", {}, h("b", {}, "Equipment"), h("div", {class:"muted small"}, summary + (overridden ? " · this workout" : " · your default"))),
        h("button", {class:"btn sm ghost", onclick:() => openEquipment(w, d)}, "Change")),
      h("p", {class:"eqnote small"}, note),
      td.skipped.length ? h("details", {}, h("summary", {class:"small"}, `Skipped — needs equipment you don't have (${td.skipped.length})`),
        h("ul", {class:"skiplist"}, td.skipped.map(x => h("li", {}, h("b", {}, x.item.name || x.item.text.slice(0, 40)),
          h("div", {class:"muted small"}, "Needs " + x.missing.map(eqName).join(", ") +
            (x.options && x.options.length ? ". Or do an equivalent with: " + x.options.map(o => o.map(eqName).join(" + ")).join("  /  ") : "")))))) : null);
  };

  const minsOf = (kind, v) => { const st = P.mobility[kind][v].steps; return Math.round(secs(st[st.length-1].to) / 60); };
  const mobCard = () => {
    if (!day.pre && !day.post) return null;
    const row = (kind, v) => {
      if (!v) return null;
      const list = v.split(" or ").filter(x => P.mobility[kind][x]);
      return h("div", {class:"mobrow"},
        h("span", {class:"mobwhen"}, kind === "pre" ? "Before" : "After"),
        h("div", {class:"chips", style:"margin:0"}, list.map(l =>
          h("button", {class:"chip go", onclick:() => openMobility(kind, [l, ...list.filter(x => x !== l)].join(" or "))},
            icon("mobility"), `${l} · ${P.mobility[kind][l].name} · ${minsOf(kind, l)} min`))));
    };
    return h("div", {class:"card mobcard"},
      h("div", {class:"row spread", style:"margin-bottom:6px"}, h("h2", {style:"margin:0;font-size:16px"}, "Mobility for this workout"),
        h("a", {class:"small", href:"#mobility"}, "All routines")),
      day.areas.length ? h("p", {class:"muted small", style:"margin:0 0 10px"}, `Matched to: ${day.areas.map(areaName).join(" + ")}. Done separately from the strength work.`) : null,
      row("pre", day.pre), row("post", day.post));
  };

  const awakeBtn = navigator.wakeLock ? h("button", {class:"glass" + (S.keepAwake ? " on" : ""), onclick:e => {
    S.keepAwake = !S.keepAwake; save(); setAwake(S.keepAwake);
    e.currentTarget.classList.toggle("on", S.keepAwake);
    toast(S.keepAwake ? "Screen will stay on while the app is open" : "Screen can sleep again");
  }}, icon("sun", 15), "Keep screen on") : null;
  if (S.keepAwake) setAwake(true);

  if (day.rest){
    return h("div", {},
      h("section", {class:`hero p${phase.n}`},
        h("div", {class:"kicker"}, `Week ${w} · ${phase.name}`),
        h("h1", {style:"padding-right:0"}, "Rest day"),
        h("div", {class:"sub"}, `${day.day} · recovery is where the training sticks`),
        h("div", {class:"heroacts"}, h("a", {class:"glass", href:"#plan"}, "Change my plan"))),
      h("div", {class:"callout info"}, "Nothing scheduled. Sleep, eat well and keep moving gently. A slow mobility flow is optional."),
      mobCard(),
      week.notes.map(n => h("div", {class:"callout warn"}, h("b", {}, "Note: "), n)));
  }

  const card = h("div", {},
    h("section", {class:`hero p${phase.n}`},
      h("div", {class:"kicker"}, `Week ${w} · ${phase.name}`),
      h("h1", {}, day.title),
      h("div", {class:"sub"}, `${day.day} · ${week.name}`),
      ringEl,
      h("div", {class:"heroacts"}, count, awakeBtn)),
    h("div", {class:"stickybar", "aria-hidden":"true"}, h("div", {class:"bar"}, sbar), stext),
    week.intro.length ? h("div", {class:"callout info"}, week.intro) : null,
    day.note ? h("div", {class:"callout info small"}, h("b", {}, "Strength focus: "), day.note) : null,
    mobCard(),
    eqCard(),
    h("ul", {class:"items", style:"margin:8px 0 14px"}, items),
    h("div", {style:"margin:14px 0"}, doneBtn),
    h("details", {class:"callout danger"}, h("summary", {}, "Pain rule — read if anything hurts"), h("p", {}, P.injury_stop_rule)),
    week.notes.map(n => h("div", {class:"callout warn"}, h("b", {}, "Note: "), n)));
  repaint();
  return card;
}

function statTile(k, v, u){
  return h("div", {class:"stat"}, h("span", {class:"k"}, k), h("b", {class:"v"}, v), h("span", {class:"u"}, u));
}
function todayHead(pos){
  const hr = new Date().getHours();
  const hello = hr < 5 ? "Burning the midnight oil" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const when = new Date().toLocaleDateString(undefined, { weekday:"long", day:"numeric", month:"long" });
  const wp = weekProgress(pos.week);
  return h("section", {class:"todayhead"},
    h("div", {class:"greet"}, h("div", {class:"muted"}, hello), h("h1", {}, when)),
    h("div", {class:"stats"},
      statTile("Week", String(pos.week), "of 12"),
      statTile("This week", `${wp.done}/${wp.total}`, "workouts"),
      statTile("Logged", String(Object.keys(S.done).length), "sessions")));
}
function comingUp(pos){
  const out = [];
  let w = pos.week, d = pos.dow;
  for (let k = 0; k < 14 && out.length < 3; k++){
    d++; if (d > 6){ d = 0; w++; }
    if (w > 12) break;
    const day = P.weeks[w - 1].days[d];
    if (!day.rest) out.push({ w, d, day });
  }
  if (!out.length) return null;
  return h("div", {class:"card"}, h("h2", {}, "Coming up"),
    h("div", {class:"stack"}, out.map(x => h("a", {class:"planprev", href:`#day/${x.w}/${x.d}`},
      h("span", {class:"d"}, DAY_SHORT[x.d]), h("span", {}, x.day.title), icon(dayKind(x.day), 18)))));
}

views.today = () => {
  const pos = position();
  const startRow = h("div", {class:"card"},
    h("div", {class:"row spread"},
      h("div", {}, h("b", {}, "Program start date"), h("div", {class:"muted small"}, "Days follow the real calendar, so any start date works.")),
      h("input", {id:"start", class:"f", type:"date", style:"width:auto", value:S.start, "aria-label":"Program start date", onchange:e => { S.start = e.target.value; save(); route(); }})));
  if (!pos) return [
    h("section", {class:"hero"}, h("div", {class:"kicker"}, "Your program"), h("h1", {style:"padding-right:0"}, "Let's get moving"),
      h("div", {class:"sub"}, "Pick the day you start (or started) below to see today's session.")),
    startRow,
    h("a", {class:"btn ghost block", href:"#program"}, "Browse the whole program")];
  if (pos.before) return [
    h("section", {class:"hero"}, h("div", {class:"kicker"}, "Starts " + S.start), h("h1", {style:"padding-right:0"}, "Not started yet"),
      h("div", {class:"sub"}, "Browse the plan under Program while you wait.")), startRow];
  if (pos.after) return [
    h("section", {class:"hero p3"}, h("div", {class:"kicker"}, "12 weeks done"), h("h1", {style:"padding-right:0"}, "Program complete 🎉"),
      h("div", {class:"sub"}, "Compare your final tests to the baseline and plan the next block.")),
    h("div", {class:"row"}, h("a", {class:"btn", href:"#tests/report"}, "See my report"), h("a", {class:"btn ghost", href:"#log"}, "Open log")), startRow];
  const due = testDue();
  return [
    todayHead(pos),
    weekStrip(pos.week, pos.dow),
    due ? h("div", {class:"callout warn"}, h("b", {}, `Performance test due — week ${due.week} (${due.label}). `), h("a", {href:"#tests/new"}, "Run it this week")) : null,
    sessionCard(pos.week, pos.dow),
    comingUp(pos),
    h("div", {class:"row spread", style:"margin:4px 0 14px"},
      h("a", {class:"btn ghost sm", href:`#week/${pos.week}`}, "Whole week"),
      h("a", {class:"btn ghost sm", href:"#program"}, "Full program")),
    startRow];
};

views.program = () => {
  const pos = position();
  const plan = currentPlan();
  const pp = programProgress();
  return [h("h1", {class:"page-title"}, "Program"),
    h("div", {class:"card overall"},
      h("div", {class:"row spread"}, h("span", {class:"muted small"}, "Overall progress"), h("b", {}, pp.pct + "%")),
      h("div", {class:"bar"}, h("i", {style:`width:${pp.pct}%`})),
      h("span", {class:"muted small"}, `${pp.done} of ${pp.total} workouts completed${pos ? " · week " + Math.min(12, Math.max(1, pos.week)) + " of 12" : ""}`)),
    h("div", {class:"card"},
      h("div", {class:"row spread", style:"margin-bottom:10px"}, h("h2", {style:"margin:0"}, "Your weekly plan"), h("a", {class:"btn sm", href:"#plan"}, "Edit plan")),
      h("div", {class:"planmini"}, plan.map((t, d) => h("div", {class:"pm" + (t.length ? "" : " off")},
        h("b", {}, DAY_SHORT[d]),
        h("span", {}, t.length ? t.map(areaName).join(" + ") : "Rest"))))),
    P.phases.map(ph => h("section", {style:"margin-bottom:22px"},
      h("div", {class:"phasehead"}, h("span", {class:`pill p${ph.n}`}, `Phase ${ph.n}`), h("h2", {style:"margin:0"}, `${ph.name} · Weeks ${ph.from}–${ph.to}`)),
      h("details", {class:"phaseintro"}, h("summary", {class:"small muted"}, "About this phase"), h("p", {class:"muted small", style:"margin:8px 0 0"}, ph.intro.join(" "))),
      h("div", {class:"weeks"}, P.weeks.filter(w => w.phase === ph.n).map(w => {
        const now = pos && pos.week === w.n;
        return h("a", {class:`weekcard p${ph.n}` + (now ? " now" : ""), href:`#week/${w.n}`},
          now ? h("span", {class:"now-tag"}, "NOW") : null,
          h("div", {class:"n"}, `Week ${w.n} · ${w.name}`),
          h("div", {class:"tag"}, w.tag),
          h("div", {class:"dots"}, w.days.map((dd, i) => h("i", {class:dd.rest ? "off" : (S.done[dayKey(w.n, i)] ? "on" : "")}))),
          h("div", {class:"small muted", style:"margin-top:6px"}, (wp => `${wp.done}/${wp.total} workouts done`)(weekProgress(w.n))));
      })))) ];
};

views.week = n => {
  n = Math.min(12, Math.max(1, +n || 1));
  const w = P.weeks[n-1], pos = position();
  return [
    crumbs({t:"Program", href:"#program"}, {t:`Week ${n}`}),
    h("div", {class:"row spread", style:"margin-bottom:8px"},
      h("h1", {}, `Week ${n} · ${w.name}`),
      h("div", {class:"row"},
        n > 1 ? h("a", {class:"btn ghost sm", href:`#week/${n-1}`}, "← Prev") : null,
        n < 12 ? h("a", {class:"btn ghost sm", href:`#week/${n+1}`}, "Next →") : null)),
    h("div", {class:"row", style:"margin-bottom:14px"}, phasePill(n), h("span", {class:"muted small"}, w.tag)),
    w.intro.length ? h("div", {class:"callout info"}, w.intro) : null,
    h("div", {class:"days"}, w.days.map((d, i) => {
      const p = progress(n, i);
      return h("a", {class:"daycard" + (pos && pos.week === n && pos.dow === i ? " today" : ""), href:`#day/${n}/${i}`},
        h("div", {class:"d"}, icon(p.done ? "check" : dayKind(d)), d.day),
        h("div", {class:"t"}, d.title),
        h("div", {class:"bar"}, h("i", {style:`width:${p.done ? 100 : p.pct}%`})),
        h("div", {class:"small muted", style:"margin-top:6px"}, p.done ? "Done" : `${p.c}/${p.n} steps`));
    })),
    w.notes.map(t => h("div", {class:"callout warn", style:"margin-top:14px"}, h("b", {}, "Note: "), t))];
};

views.day = (w, d) => {
  w = +w; d = +d;
  const prev = d > 0 ? [w, d-1] : w > 1 ? [w-1, 6] : null;
  const next = d < 6 ? [w, d+1] : w < 12 ? [w+1, 0] : null;
  return [
    crumbs({t:"Program", href:"#program"}, {t:`Week ${w}`, href:`#week/${w}`}, {t:P.weeks[w-1].days[d].day}),
    weekStrip(w, d),
    sessionCard(w, d),
    h("div", {class:"row spread"},
      prev ? h("a", {class:"btn ghost sm", href:`#day/${prev[0]}/${prev[1]}`}, "← Previous day") : h("span"),
      next ? h("a", {class:"btn ghost sm", href:`#day/${next[0]}/${next[1]}`}, "Next day →") : null)];
};

views.mobility = () => {
  const mins = r => Math.round(secs(r.steps[r.steps.length-1].to) / 60);
  const mf = P.mobility_for || {};
  const plan = currentPlan();
  const usedFor = (kind, v) => AREA_ORDER.filter(a => ((mf[a] || {})[kind] || []).includes(v));
  const openFirst = (kind, v, list) => openMobility(kind, [v, ...list.filter(x => x !== v)].join(" or "));

  /* one row per kind of workout in the user's plan, with its days and the routines that go with it */
  const present = AREA_ORDER.filter(a => plan.some(t => t.includes(a)) && a !== "recovery");
  const matched = h("div", {class:"card"},
    h("div", {class:"row spread", style:"margin-bottom:6px"}, h("h2", {style:"margin:0"}, "Matched to your workouts"), h("a", {class:"small", href:"#plan"}, "Edit plan")),
    h("p", {class:"muted small", style:"margin:0 0 10px"}, "Strength sessions contain no mobility. These routines are linked to the body area you train and are suggested before and after each workout."),
    present.map(a => {
      const days = plan.map((t, d) => t.includes(a) ? DAY_SHORT[d] : null).filter(Boolean).join(" · ");
      const chipsFor = kind => (mf[a] || {})[kind] ? h("div", {class:"mobrow"}, h("span", {class:"mobwhen"}, kind === "pre" ? "Before" : "After"),
        h("div", {class:"chips", style:"margin:0"}, mf[a][kind].filter(v => P.mobility[kind][v]).map(v =>
          h("button", {class:"chip go", onclick:() => openFirst(kind, v, mf[a][kind])}, `${v} · ${P.mobility[kind][v].name}`)))) : null;
      return h("div", {class:"matchrow"}, h("div", {class:"row spread"}, h("b", {}, areaName(a)), h("span", {class:"muted small"}, days)),
        chipsFor("pre"), chipsFor("post"));
    }),
    plan.some(t => t.includes("recovery")) ? h("div", {class:"matchrow"}, h("div", {class:"row spread"}, h("b", {}, "Recovery / rest days"),
      h("span", {class:"muted small"}, plan.map((t, d) => t.includes("recovery") || !t.length ? DAY_SHORT[d] : null).filter(Boolean).join(" · "))),
      h("div", {class:"mobrow"}, h("span", {class:"mobwhen"}, "Any time"),
        h("div", {class:"chips", style:"margin:0"}, ((mf.recovery || {}).post || []).map(v => h("button", {class:"chip go", onclick:() => openFirst("post", v, mf.recovery.post)}, `${v} · ${P.mobility.post[v].name}`))))) : null);

  const block = (kind, title) => h("div", {class:"card"},
    h("div", {class:"row spread", style:"margin-bottom:6px"}, h("h2", {style:"margin:0"}, title),
      h("button", {class:"btn ghost sm", onclick:() => { const ks = Object.keys(P.mobility[kind]); openMobility(kind, ks[Math.floor(Math.random()*ks.length)]); }}, "🎲 Surprise me")),
    Object.entries(P.mobility[kind]).map(([v, r]) => h("div", {class:"mob"},
      h("span", {class:"mobic"}, icon("mobility")),
      h("div", {class:"grow"}, h("b", {}, `${v} · ${r.name}`), h("div", {class:"small muted"}, `${mins(r)} min · ${r.use}`),
        h("div", {class:"chips"},
          usedFor(kind, v).map(a => h("span", {class:"chip go"}, areaName(a))),
          (r.tags || []).map(t => h("span", {class:"chip"}, t)))),
      h("button", {class:"btn sm", onclick:() => openMobility(kind, v)}, "Open"))));
  return [h("h1", {class:"page-title"}, "Mobility"),
    h("p", {class:"muted"}, "Every workout is paired with routines for the area it trains. All routines are always available, or tap 🎲 to be surprised. Each has a guided timer."),
    matched, block("pre", "Before a workout"), block("post", "After a workout")];
};

/* ---------------- equipment picker ---------------- */
function openEquipment(w, d){
  const scoped = w != null;
  const key = scoped ? dayKey(w, d) : null;
  let sel = new Set(scoped ? kitFor(w, d) : kitDefault());
  const base = scoped ? rawDayItems(w, d) : null;
  const sheet = document.getElementById("sheet");
  const render = () => {
    const groups = [...new Set(eqList().map(e => e.group))];
    const preview = scoped ? tailorItems(base, [...sel]) : null;
    sheet.replaceChildren(
      h("div", {class:"row spread"},
        h("h2", {}, scoped ? "Equipment for this workout" : "My default equipment"),
        h("button", {class:"iconbtn", onclick:closeModal, "aria-label":"Close"}, "✕")),
      h("p", {class:"muted small", style:"margin:0 0 8px"}, scoped
        ? "Tick what you have available right now. The workout is rebuilt around it: unavailable exercises are swapped for equivalents, or skipped."
        : "What you usually have. New workouts start from this, and you can change it for any single workout."),
      h("div", {class:"chips", style:"margin:0 0 6px"}, (P.equipment_presets || []).map(pr =>
        h("button", {class:"chip go", onclick:() => { sel = new Set(pr.items); render(); }}, pr.name))),
      ...groups.map(g => h("div", {},
        h("div", {class:"eqgroup"}, g),
        h("div", {class:"eqgrid"}, eqList().filter(e => e.group === g).map(e =>
          h("button", {class:"eqtile" + (sel.has(e.id) ? " on" : ""), "aria-pressed":sel.has(e.id) ? "true" : "false",
            onclick:() => { sel.has(e.id) ? sel.delete(e.id) : sel.add(e.id); render(); }},
            h("span", {class:"eqcheck"}, sel.has(e.id) ? icon("check", 14) : null), e.name))))),
      preview ? h("div", {class:"callout info small", style:"margin:12px 0 0"},
        preview.adapted || preview.skipped.length
          ? `With this kit: ${preview.adapted} exercise${preview.adapted === 1 ? "" : "s"} swapped${preview.skipped.length ? `, ${preview.skipped.length} skipped` : ""}.`
          : "With this kit nothing in the workout needs changing.") : null,
      h("div", {class:"row", style:"margin-top:14px"},
        scoped ? h("button", {class:"btn", onclick:() => { S.equip = S.equip || {}; S.equip[key] = [...sel]; save(); closeModal(); route(true); }}, "Use for this workout") : null,
        h("button", {class:scoped ? "btn ghost" : "btn", onclick:() => {
          S.kit = [...sel];
          if (scoped && S.equip) delete S.equip[key];
          save(); closeModal(); route(true); toast("Default equipment saved");
        }}, scoped ? "Make this my default" : "Save default"),
        scoped && S.equip && Array.isArray(S.equip[key]) ? h("button", {class:"chip", onclick:() => { delete S.equip[key]; save(); closeModal(); route(true); }}, "Reset to default") : null));
  };
  render();
  document.getElementById("modal").style.display = "flex";
}
function equipmentCard(){
  const names = kitDefault().map(eqName);
  return h("div", {class:"card"},
    h("div", {class:"row spread"}, h("h2", {style:"margin:0"}, "My equipment"), h("button", {class:"btn sm", onclick:() => openEquipment()}, "Edit")),
    h("p", {class:"muted small", style:"margin:8px 0 0"}, names.length ? names.join(" · ") : "Bodyweight only"),
    h("p", {class:"muted small", style:"margin:6px 0 0"}, "Workouts are tailored to this kit. You can also change it for a single workout from the session page."));
}

/* ---------------- backup + restore ---------------- */
const backupJson = () => JSON.stringify({ app:"ascend", exported:new Date().toISOString(), state:S }, null, 1);
async function exportBackup(){
  const name = `ascend-backup-${ymd(new Date())}.json`;
  const FS = plug("Filesystem"), Share = plug("Share");
  try {
    if (FS && Share){                                   // Android app: write a file and open the share sheet
      const r = await FS.writeFile({ path:name, data:backupJson(), directory:"CACHE", encoding:"utf8" });
      await Share.share({ title:"Ascend backup", text:"Ascend backup file", url:r.uri, dialogTitle:"Save or send your backup" });
      return;
    }
    const a = h("a", {href:URL.createObjectURL(new Blob([backupJson()], {type:"application/json"})), download:name});
    document.body.append(a); a.click(); a.remove();     // browser download
    toast("Backup downloaded");
  } catch (e) {
    backupText("show");                                 // always have a way out: the text itself
  }
}
function restoreFromText(text){
  let o;
  try { o = JSON.parse(text); } catch (e) { toast("That isn't valid backup text."); return false; }
  const st = o && o.state ? o.state : o;
  if (!st || typeof st !== "object" || !("checks" in st)){ toast("That doesn't look like an Ascend backup."); return false; }
  if (!confirm("Replace the data on this device with the backup?")) return false;
  S = Object.assign(blankState(), st);
  if (!S.schema || S.schema < 2) S.schema = 2;
  save(); closeModal(); route(); toast("Backup restored");
  return true;
}
function backupText(mode){
  const sheet = document.getElementById("sheet");
  const ta = h("textarea", {rows:10, style:"font:12px/1.4 ui-monospace,Consolas,monospace", spellcheck:"false",
    placeholder: mode === "paste" ? "Paste your backup text here" : ""});
  if (mode === "show") ta.value = backupJson();
  sheet.replaceChildren(
    h("div", {class:"row spread"}, h("h2", {}, mode === "show" ? "Backup text" : "Restore from text"), h("button", {class:"iconbtn", onclick:closeModal}, "✕")),
    h("p", {class:"muted small"}, mode === "show"
      ? "Copy this and keep it somewhere safe (notes, email to yourself). Paste it into Restore on any device."
      : "Paste the backup text you copied earlier, then restore."),
    ta,
    h("div", {class:"row", style:"margin-top:12px"},
      mode === "show"
        ? h("button", {class:"btn", onclick:async () => {
            try { await navigator.clipboard.writeText(ta.value); toast("Copied"); } catch (e) { ta.select(); document.execCommand && document.execCommand("copy"); toast("Copied"); }
          }}, "Copy to clipboard")
        : h("button", {class:"btn", onclick:() => restoreFromText(ta.value)}, "Restore")));
  document.getElementById("modal").style.display = "flex";
  setTimeout(() => ta.focus(), 50);
}

/* ---------------- training reminders (native notifications) ---------------- */
const REM_IDS = [101, 102, 103, 104, 105, 106, 107];
async function applyReminders(){
  const LN = plug("LocalNotifications");
  if (!LN) return { ok:false, why:"Reminders need the Android app." };
  const r = S.reminders || { on:false };
  try {
    await LN.cancel({ notifications: REM_IDS.map(id => ({ id })) });
    if (!r.on) return { ok:true, off:true };
    const perm = await LN.requestPermissions();
    if (perm.display !== "granted") return { ok:false, why:"Notifications are blocked — allow them in Android settings." };
    const [hh, mm] = (r.time || "17:30").split(":").map(Number);
    const notifications = (r.days || []).map(d => ({
      id: REM_IDS[d], title: "Time to train", body: "Open Ascend for today's session.",
      schedule: { on: { weekday: ((d + 1) % 7) + 1, hour: hh, minute: mm }, allowWhileIdle: true }   // 1 = Sunday
    }));
    if (notifications.length) await LN.schedule({ notifications });
    return { ok:true, count:notifications.length };
  } catch (e) {
    return { ok:false, why:"Couldn't schedule reminders: " + (e && e.message || e) };
  }
}
function remindersCard(){
  const r = S.reminders = S.reminders || { on:false, time:"17:30", days:trainingDays() };
  const native = !!plug("LocalNotifications");
  const status = h("p", {class:"small muted", style:"margin:8px 0 0"});
  const apply = async () => {
    save();
    const res = await applyReminders();
    status.textContent = res.ok ? (res.off ? "Reminders are off." : `Scheduled ${res.count} weekly reminder${res.count === 1 ? "" : "s"}.`) : res.why;
  };
  const on = h("input", {type:"checkbox", checked:r.on, disabled:!native, "aria-label":"Enable reminders", onchange:e => { r.on = e.target.checked; apply(); }});
  const time = h("input", {type:"time", class:"f", style:"width:auto", value:r.time, disabled:!native, onchange:e => { r.time = e.target.value; if (r.on) apply(); else save(); }});
  const days = DAY_SHORT.map((d, i) => h("button", {class:"chip" + (r.days.includes(i) ? " on" : ""), disabled:!native, onclick:e => {
    const k = r.days.indexOf(i); k >= 0 ? r.days.splice(k, 1) : r.days.push(i);
    e.currentTarget.classList.toggle("on", r.days.includes(i));
    if (r.on) apply(); else save();
  }}, d));
  return h("div", {class:"card"}, h("h2", {}, "Training reminders"),
    h("label", {class:"row", style:"gap:12px"}, on, h("span", {}, "Remind me to train")),
    h("div", {class:"row", style:"margin-top:10px"}, h("span", {class:"muted small"}, "at"), time),
    h("div", {class:"chips"}, days),
    h("div", {style:"margin-top:8px"}, h("button", {class:"chip go", onclick:() => { r.days = trainingDays(); save(); if (r.on) apply(); route(true); }}, "Use my workout days")),
    native ? null : h("p", {class:"small muted", style:"margin:8px 0 0"}, "Reminders work in the Android app."),
    status);
}

/* ---------------- performance tests ---------------- */
const LEVELS = ["Developing", "Solid", "Strong", "Elite"];
const ASYM = 0.15;                                   // left/right gap that gets flagged
const num = x => (x === "" || x == null || isNaN(+x)) ? null : +x;
const sessions = () => [...(S.tests || [])].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

/* continuous 0..4 score: 0-1 developing, 1-2 solid, 2-3 strong, 3+ elite */
function scoreHigher(a, b, c, v){
  const lo = a - (b - a);
  if (v < a) return Math.max(0, (v - lo) / (a - lo));
  if (v < b) return 1 + (v - a) / (b - a);
  if (v < c) return 2 + (v - b) / (c - b);
  return Math.min(4, 3 + (v - c) / (c - b));
}
function testScore(t, v){
  const [a,b,c] = t.levels;
  return t.better === "lower" ? scoreHigher(-a, -b, -c, -v) : scoreHigher(a, b, c, v);
}
const levelOf = s => Math.min(3, Math.floor(s));

function readResult(t, raw){
  if (raw == null || raw === "") return null;
  if (t.sided){
    if (typeof raw !== "object") return null;
    const l = num(raw.l), r = num(raw.r);
    const vals = [l, r].filter(v => v != null);
    if (!vals.length) return null;
    const worst = t.better === "lower" ? Math.max(...vals) : Math.min(...vals);
    let asym = 0, weak = null;
    if (l != null && r != null && Math.max(Math.abs(l), Math.abs(r)) > 0){
      asym = Math.abs(l - r) / Math.max(Math.abs(l), Math.abs(r));
      const leftWeaker = t.better === "lower" ? l > r : l < r;
      weak = l === r ? null : (leftWeaker ? "left" : "right");
    }
    return { l, r, value:worst, score:testScore(t, worst), asym, weak };
  }
  const v = num(raw);
  return v == null ? null : { value:v, score:testScore(t, v) };
}
function rowsFor(session){
  return P.tests.map(t => ({ t, r: readResult(t, session.results[t.id]) })).filter(x => x.r);
}
function areaScores(session){
  const by = {};
  for (const { t, r } of rowsFor(session)) (by[t.area] = by[t.area] || []).push(r.score);
  const out = {};
  for (const a in by) out[a] = by[a].reduce((x,y) => x + y, 0) / by[a].length;
  return out;
}
function weekOf(dateStr){
  if (!S.start) return null;
  const s = parseYmd(S.start), d = parseYmd(dateStr);
  const startMon = new Date(s); startMon.setDate(s.getDate() - (s.getDay()+6)%7);
  const w = Math.floor(Math.round((d - startMon) / 864e5) / 7) + 1;
  return w >= 1 && w <= 12 ? w : null;
}
function testDue(){
  const pos = position();
  if (!pos || pos.before || pos.after || !P.test_schedule) return null;
  const slot = P.test_schedule.find(s => s.weeks.includes(pos.week));
  if (!slot) return null;
  return (S.tests || []).some(t => t.week === pos.week) ? null : { ...slot, week:pos.week };
}
function fmtVal(t, v){ return (Math.round(v * 10) / 10) + " " + t.unit; }
function fmtResult(t, r){ return t.sided ? `L ${r.l ?? "–"} / R ${r.r ?? "–"} ${t.unit}` : fmtVal(t, r.value); }
function toggleFocus(k){
  const i = S.focus.indexOf(k);
  if (i >= 0) S.focus.splice(i, 1);
  else if (S.focus.length >= 4){ toast("Max 4 focus exercises at once — remove one first."); return false; }
  else {
    S.focus.push(k);
    const e = P.library[k], area = e && (e.area || (e.day === "Thursday" ? "upper" : "lower"));
    if (area && !areaScheduled(area)) toast(`Added. Schedule a ${areaName(area).toLowerCase()} day in your plan to see it.`, 6000);
  }
  save(); return true;
}

function stopwatchBtn(input){
  let t0 = null, iv = null;
  const b = h("button", {class:"btn ghost sm", type:"button"}, "⏱ Start");
  b.onclick = () => {
    if (t0 == null){
      t0 = Date.now(); b.textContent = "■ 0.0s";
      iv = setInterval(() => { b.textContent = "■ " + ((Date.now() - t0) / 1000).toFixed(1) + "s"; }, 100);
    } else {
      clearInterval(iv);
      input.value = ((Date.now() - t0) / 1000).toFixed(1); t0 = null; b.textContent = "⏱ Start";
      input.dispatchEvent(new Event("input"));
    }
  };
  return b;
}

function radar(axes, series){
  const W = 440, H = 330, cx = W/2, cy = H/2 + 6, R = 104, n = axes.length;
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, a, txt) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; };
  const ang = i => -Math.PI/2 + 2*Math.PI*i/n;
  const pt = (i, v, r0 = R) => { const r = r0 * Math.max(0, Math.min(4, v)) / 4; return [cx + r*Math.cos(ang(i)), cy + r*Math.sin(ang(i))]; };
  const svg = el("svg", {viewBox:`0 0 ${W} ${H}`, width:"100%", role:"img", "aria-label":"Performance profile by area"});
  for (let k = 1; k <= 4; k++)
    svg.append(el("polygon", {points:axes.map((_,i) => pt(i,k).join(",")).join(" "), fill:"none", stroke:"var(--line)"}));
  ["Solid","Strong","Elite"].forEach((nm,k) => svg.append(el("text", {x:cx+4, y:cy - R*(k+1)/4 - 2, fill:"var(--muted)", "font-size":9}, nm)));
  axes.forEach((a,i) => {
    const [x,y] = pt(i,4);
    svg.append(el("line", {x1:cx, y1:cy, x2:x, y2:y, stroke:"var(--line)"}));
    const c = Math.cos(ang(i));
    svg.append(el("text", {x:cx + (R+12)*c, y:cy + (R+12)*Math.sin(ang(i)) + 4, "text-anchor": c > 0.3 ? "start" : c < -0.3 ? "end" : "middle", fill:"var(--ink)", "font-size":12}, a));
  });
  series.forEach(s => {
    const pts = axes.map((a,i) => pt(i, s.values[a] ?? 0).join(",")).join(" ");
    svg.append(el("polygon", {points:pts, fill:s.color, "fill-opacity":.18, stroke:s.color, "stroke-width":2.5, "stroke-dasharray": s.dash || ""}));
    axes.forEach((a,i) => { if (s.values[a] != null){ const [x,y] = pt(i, s.values[a]); svg.append(el("circle", {cx:x, cy:y, r:3.5, fill:s.color})); } });
  });
  return svg;
}

const badge = s => h("span", {class:"badge lvl" + levelOf(s)}, LEVELS[levelOf(s)]);
function delta(t, cur, ref){
  if (!ref) return null;
  const d = cur.value - ref.value;
  if (Math.abs(d) < 1e-9) return h("span", {class:"muted small"}, "no change");
  const good = t.better === "lower" ? d < 0 : d > 0;
  return h("span", {class:"delta " + (good ? "up" : "down")}, (d > 0 ? "+" : "") + (Math.round(d*10)/10) + " " + t.unit);
}

/* ---- hub ---- */
function testsHub(){
  const ses = sessions(), due = testDue();
  const sched = (P.test_schedule || []).map(s => {
    const done = s.weeks.some(wk => (S.tests || []).some(t => t.week === wk));
    return h("li", {}, `Week ${s.weeks.join(", ")} — ${s.label}`, done ? h("span", {class:"badge lvl3", style:"margin-left:8px"}, "✓ done") : null);
  });
  return [
    h("h1", {style:"margin-bottom:12px"}, "Performance tests"),
    due ? h("div", {class:"callout warn"}, h("b", {}, `Test due this week (week ${due.week}): `), due.label + ". ", h("a", {href:"#tests/new"}, "Start now")) : null,
    h("div", {class:"card"},
      h("p", {style:"margin-top:0"}, "Test your mobility, strength, core, legs, grip and climbing grades. The report finds your weak links and left/right gaps, and pins fix exercises into your Monday and Thursday sessions. Retest as you progress and the program keeps pushing on what's weakest."),
      h("div", {class:"row"},
        h("a", {class:"btn", href:"#tests/new"}, "Start a test session"),
        ses.length ? h("a", {class:"btn ghost", href:"#tests/report"}, "Latest report") : null)),
    h("div", {class:"card"}, h("h2", {}, "Suggested schedule"), h("ul", {style:"margin:0;padding-left:20px"}, sched)),
    S.focus.length ? h("div", {class:"card"}, h("h2", {}, "Active focus exercises"),
      h("p", {class:"muted small", style:"margin-top:0"}, "These appear at the end of your Monday/Thursday sessions."),
      h("div", {class:"chips"}, S.focus.map(k => h("button", {class:"chip go", onclick:() => { toggleFocus(k); route(true); }}, "✕ " + (P.library[k] ? P.library[k].name : k))))) : null,
    ses.length ? h("div", {class:"card"}, h("h2", {}, "History"),
      h("div", {class:"scroll"}, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "Week"), h("th", {}, "Tests"), h("th", {}), h("th", {}))),
        h("tbody", {}, ses.slice().reverse().map(s => h("tr", {},
          h("td", {}, s.date), h("td", {}, s.week || "–"), h("td", {}, rowsFor(s).length),
          h("td", {}, h("a", {href:"#tests/report/" + s.id}, "Report")),
          h("td", {}, h("button", {class:"iconbtn", "aria-label":"Delete test session", onclick:() => {
            if (confirm("Delete the test session from " + s.date + "?")){ S.tests = S.tests.filter(x => x.id !== s.id); save(); route(true); } }}, "✕")))))))) : null,
    h("div", {class:"card"}, h("h2", {}, "How to test"), h("ul", {style:"margin:0;padding-left:20px"}, (P.test_guide || []).map(g => h("li", {style:"margin-bottom:4px"}, g))))];
}

/* ---- run a session ---- */
function testsNew(){
  const draft = {};
  const ses = sessions(), last = ses[ses.length - 1];
  const dateIn = h("input", {type:"date", class:"f", value:ymd(new Date()), style:"width:auto"});
  const sec = (t, key, label) => {
    const lastR = last && readResult(t, last.results[t.id]);
    const lastV = lastR ? (t.sided ? (key === "l" ? lastR.l : lastR.r) : lastR.value) : null;
    const input = h("input", {type:"number", step:"any", inputmode:"decimal", class:"f", style:"width:110px",
      placeholder: lastV != null ? "last " + lastV : t.unit, "aria-label": t.name + (label ? " " + label : ""),
      oninput:e => {
        const v = e.target.value;
        if (t.sided){ (draft[t.id] = draft[t.id] || {})[key] = v; } else draft[t.id] = v;
      }});
    return h("div", {class:"row", style:"gap:8px"}, label ? h("span", {class:"muted small", style:"width:16px"}, label) : null, input,
      t.timed ? stopwatchBtn(input) : null);
  };
  const cards = P.tests.map(t => h("div", {class:"card"},
    h("div", {class:"row spread"}, h("h2", {style:"margin:0;font-size:17px"}, t.name), h("span", {class:"chip"}, t.area)),
    h("details", {style:"margin:8px 0"}, h("summary", {class:"small"}, "How to do it"), h("p", {class:"small muted"}, t.how)),
    t.sided ? h("div", {style:"display:grid;gap:8px"}, sec(t, "l", "L"), sec(t, "r", "R")) : sec(t, "v", ""),
    h("div", {class:"small muted", style:"margin-top:6px"}, `Unit: ${t.unit}. Levels: Solid ${t.better === "lower" ? "≤" : "≥"} ${t.levels[0]}, Strong ${t.better === "lower" ? "≤" : "≥"} ${t.levels[1]}, Elite ${t.better === "lower" ? "≤" : "≥"} ${t.levels[2]}.`)));
  const noteIn = h("textarea", {rows:2, placeholder:"Optional note (sleep, soreness, what felt off…)"});
  const saveBtn = h("button", {class:"btn", onclick:() => {
    const results = {};
    for (const t of P.tests){
      const d = draft[t.id];
      if (d == null) continue;
      if (t.sided){ const l = num(d.l), r = num(d.r); if (l != null || r != null) results[t.id] = { l, r }; }
      else if (num(d) != null) results[t.id] = num(d);
    }
    if (!Object.keys(results).length){ toast("Enter at least one result first."); return; }
    const id = "t" + Date.now();
    S.tests.push({ id, date:dateIn.value, week:weekOf(dateIn.value), results, note:noteIn.value });
    save();
    location.hash = "#tests/report/" + id;
  }}, "Save & see report");
  return [
    crumbs({t:"Tests", href:"#tests"}, {t:"New session"}),
    h("h1", {style:"margin-bottom:8px"}, "New test session"),
    h("p", {class:"muted"}, "Warm up first (Pre-climb Variant A), rest 2–3 minutes between tests, and skip anything that's sore. Leave blanks for tests you don't do."),
    h("div", {class:"card"}, h("div", {class:"row"}, h("label", {class:"small muted"}, "Date"), dateIn)),
    cards,
    h("div", {class:"card"}, noteIn, h("div", {style:"margin-top:10px"}, saveBtn))];
}

/* ---- report ---- */
function testsReport(id){
  const ses = sessions();
  if (!ses.length) return [crumbs({t:"Tests", href:"#tests"}, {t:"Report"}), h("p", {}, "No test sessions yet."), h("a", {class:"btn", href:"#tests/new"}, "Start a test session")];
  const cur = ses.find(s => s.id === id) || ses[ses.length - 1];
  const idx = ses.indexOf(cur), prev = ses[idx - 1], base = ses[0] !== cur ? ses[0] : null;
  const rows = rowsFor(cur).map(x => ({ ...x,
    p: prev ? readResult(x.t, prev.results[x.t.id]) : null,
    b: base ? readResult(x.t, base.results[x.t.id]) : null }));
  const areas = areaScores(cur), baseAreas = base ? areaScores(base) : null;
  const axes = P.test_areas.filter(a => areas[a] != null);

  /* priorities: lowest score first, below "Strong" */
  const weak = [...rows].sort((a,b) => a.r.score - b.r.score).filter(x => x.r.score < 2.5).slice(0, 3);
  const asym = rows.filter(x => x.t.sided && x.r.asym >= ASYM);

  const fixChips = t => h("div", {class:"chips", style:"margin-top:8px"},
    t.fixes.map(k => { const on = S.focus.includes(k);
      return h("button", {class:"chip go" + (on ? " on" : ""), onclick:() => { if (toggleFocus(k)) route(true); }},
        (on ? "✓ In your sessions: " : "+ Add focus: ") + P.library[k].name); }),
    (t.mobility_fix || []).map(([kind, v]) => h("button", {class:"chip", onclick:() => openMobility(kind, v)},
      `🧘 ${kind === "pre" ? "Pre" : "Post"} mobility ${v}`)));

  const priorityCards = weak.length ? weak.map(({t, r}) => h("div", {class:"card"},
      h("div", {class:"row spread"}, h("h2", {style:"margin:0;font-size:17px"}, t.name), badge(r.score)),
      h("div", {class:"small muted"}, `${t.area} · ${fmtResult(t, r)}`),
      h("p", {style:"margin:8px 0 0"}, t.advice),
      r.asym >= ASYM ? h("p", {class:"callout warn small", style:"margin:8px 0 0"}, `${r.weak === "left" ? "Left" : "Right"} side is ${Math.round(r.asym*100)}% weaker — start each set on that side and add one extra set there.`) : null,
      t.fixes.length || (t.mobility_fix || []).length ? fixChips(t) : null))
    : [h("div", {class:"callout info"}, "No weak links: everything you tested is Strong or better. Keep progressing the loading in Phase 3 and retest next phase.")];

  const sessionPicker = h("select", {class:"f", style:"width:auto", onchange:e => { location.hash = "#tests/report/" + e.target.value; }},
    ses.slice().reverse().map(s => h("option", {value:s.id, selected:s.id === cur.id}, `${s.date}${s.week ? " · week " + s.week : ""}`)));

  const series = [{ label:"This test", color:"var(--accent)", values:areas }];
  if (baseAreas) series.unshift({ label:"Baseline", color:"var(--muted)", values:baseAreas, dash:"5 4" });

  return [
    crumbs({t:"Tests", href:"#tests"}, {t:"Report"}),
    h("div", {class:"row spread", style:"margin-bottom:10px"}, h("h1", {}, "Weak-area report"), sessionPicker),
    h("div", {class:"card"},
      axes.length >= 3 ? radar(axes, series) : h("p", {class:"muted"}, "Test at least three areas to see the profile chart."),
      baseAreas ? h("div", {class:"row small muted", style:"justify-content:center"}, h("span", {}, "▬ ▬ baseline"), h("span", {style:"color:var(--accent)"}, "━━ this test")) : null),
    h("h2", {style:"margin:6px 0 10px"}, weak.length ? "Where to focus" : "Where you stand"),
    priorityCards,
    asym.length ? h("div", {class:"card"}, h("h2", {}, "Left / right gaps"),
      asym.map(({t, r}) => h("p", {style:"margin:6px 0"}, h("b", {}, t.name + ": "),
        `${r.weak === "left" ? "left" : "right"} is ${Math.round(r.asym*100)}% weaker (L ${r.l} / R ${r.r} ${t.unit}). Train the weaker side first.`))) : null,
    h("div", {class:"card"}, h("h2", {}, "All results"),
      h("div", {class:"scroll"}, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Test"), h("th", {}, "Result"), h("th", {}, "Level"), prev ? h("th", {}, "vs last") : null, base ? h("th", {}, "vs baseline") : null)),
        h("tbody", {}, rows.map(({t, r, p, b}) => h("tr", {},
          h("td", {}, t.name), h("td", {}, fmtResult(t, r)), h("td", {}, badge(r.score)),
          prev ? h("td", {}, p ? delta(t, r, p) : "–") : null,
          base ? h("td", {}, b ? delta(t, r, b) : "–") : null)))))),
    ses.length > 1 ? h("div", {class:"card"}, h("h2", {}, "Area scores over time"),
      h("p", {class:"muted small", style:"margin-top:0"}, "0–1 developing · 1–2 solid · 2–3 strong · 3–4 elite"),
      h("div", {class:"scroll"}, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Area"), ses.map(s => h("th", {}, s.date.slice(5))))),
        h("tbody", {}, P.test_areas.map(a => h("tr", {}, h("td", {}, a),
          ses.map(s => { const v = areaScores(s)[a]; return h("td", {class:"c"}, v == null ? "–" : v.toFixed(1)); }))))))) : null,
    cur.note ? h("div", {class:"card"}, h("h2", {}, "Note"), h("p", {style:"margin:0"}, cur.note)) : null,
    h("div", {class:"row"}, h("a", {class:"btn", href:"#tests/new"}, "Test again"), h("a", {class:"btn ghost", href:"#tests"}, "Back to tests"))];
}

views.tests = (sub, id) => sub === "new" ? testsNew() : sub === "report" ? testsReport(id) : testsHub();

/* ---- weekly plan editor ---- */
views.plan = () => {
  const plan = currentPlan();
  const selectable = ["lower", "upper", "core", "climb", "cardio", "recovery"];
  const toggle = (d, a) => {
    const next = currentPlan().map(t => t.slice());
    const i = next[d].indexOf(a);
    if (i >= 0) next[d].splice(i, 1);
    else {
      if (a === "recovery") next[d] = [];                                   // recovery stands alone
      else next[d] = next[d].filter(x => x !== "recovery");
      next[d].push(a);
    }
    savePlan(next);
    route(true);
  };
  const rows = DAY_NAMES.map((name, d) => h("div", {class:"planrow"},
    h("div", {class:"pd"}, h("b", {}, name), plan[d].length ? null : h("span", {class:"muted small"}, "Rest")),
    h("div", {class:"chips", style:"margin:0"}, selectable.map(a =>
      h("button", {class:"chip" + (plan[d].includes(a) ? " on" : ""), "aria-pressed":plan[d].includes(a) ? "true" : "false", onclick:() => toggle(d, a)}, areaName(a))))));

  /* sanity hints */
  const tips = [];
  for (const a of STRENGTH_AREAS){
    for (let d = 0; d < 7; d++){
      const n = (d + 1) % 7;
      if (plan[d].includes(a) && plan[n].includes(a))
        tips.push(`${areaName(a)} is on ${DAY_NAMES[d]} and ${DAY_NAMES[n]}. Leave about 48 hours between sessions that hit the same area.`);
    }
  }
  const worked = plan.filter(isWorkoutDay).length;
  if (worked === 7) tips.push("Every day is a workout day. Make at least one a full rest day or recovery day.");
  if (worked === 0) tips.push("No workout days selected yet.");
  const strengthDays = plan.filter(t => t.some(a => STRENGTH_AREAS.includes(a))).length;
  if (worked && strengthDays === 0) tips.push("No strength sessions are scheduled. Pick lower, upper or core on at least two days.");

  const presets = P.plan_presets || [{ id:"original", name:"Original program", days:defaultPlan(), about:"" }];
  const sig = x => JSON.stringify(x.map(t => AREA_ORDER.filter(a => t.includes(a))));
  const week = (position() && position().week >= 1 && position().week <= 12) ? position().week : 1;
  const wk = P.weeks[week - 1];

  return [
    crumbs({t:"Program", href:"#program"}, {t:"Weekly plan"}),
    h("h1", {class:"page-title"}, "Your weekly plan"),
    h("p", {class:"muted"}, "Choose the days you train and what each day targets. Sessions are built from the week's program, so progression carries on whatever days you pick."),
    equipmentCard(),
    h("div", {class:"card"}, h("h2", {}, "Start from a template"),
      h("div", {class:"stack"}, presets.map(pr =>
        h("button", {class:"preset" + (sig(pr.days) === sig(plan) ? " on" : ""), onclick:() => { savePlan(pr.days.map(t => t.slice())); route(true); toast(`Plan set: ${pr.name}`); }},
          h("b", {}, pr.name), pr.about ? h("span", {class:"muted small"}, pr.about) : null)))),
    h("div", {class:"card"}, h("h2", {}, "Days and body areas"), rows,
      h("p", {class:"muted small", style:"margin:10px 0 0"}, "Tap to select more than one area on a day (for example lower + core). Leave a day empty for rest. Recovery is a light day.")),
    tips.length ? h("div", {class:"callout warn"}, tips.map(t => h("div", {}, t))) : null,
    h("div", {class:"card"}, h("h2", {}, `What this looks like (week ${week})`),
      h("div", {class:"stack"}, wk.days.map((day, d) =>
        h("a", {class:"planprev", href:`#day/${week}/${d}`},
          h("span", {class:"d"}, DAY_SHORT[d]), h("span", {}, day.rest ? "Rest day" : day.title),
          h("span", {class:"muted small"}, day.rest ? "" : `${day.items.length} ${day.items.length === 1 ? "item" : "items"}`))))),
    h("div", {class:"row"}, h("button", {class:"btn ghost sm", onclick:() => { S.plan = null; save(); applyPlan(); route(true); toast("Back to the original program schedule"); }}, "Reset to original"))];
};

/* ---- log ---- */
function weightChart(){
  const pts = S.weights.filter(x => x.date && x.kg).map(x => ({t:parseYmd(x.date).getTime(), kg:+x.kg})).sort((a,b) => a.t-b.t);
  if (pts.length < 2) return h("p", {class:"muted small"}, "Add two or more weigh-ins to see the trend.");
  const W=640, H=200, L=40, R=10, T=10, B=24;
  const lo = Math.min(78, ...pts.map(p => p.kg)) - 1, hi = Math.max(...pts.map(p => p.kg)) + 1;
  const t0 = pts[0].t, t1 = pts[pts.length-1].t || t0+1;
  const x = t => L + (W-L-R) * (t - t0) / ((t1 - t0) || 1), y = k => T + (H-T-B) * (1 - (k-lo)/(hi-lo));
  const ns = "http://www.w3.org/2000/svg";
  const el = (n, a, txt) => { const e = document.createElementNS(ns, n); for (const k in a) e.setAttribute(k, a[k]); if (txt) e.textContent = txt; return e; };
  const svg = el("svg", {viewBox:`0 0 ${W} ${H}`, width:"100%", role:"img", "aria-label":"Weight over time"});
  svg.append(el("rect", {x:L, y:y(85), width:W-L-R, height:y(80)-y(85), fill:"var(--ok)", opacity:".15"}));
  svg.append(el("text", {x:L+4, y:y(85)+12, fill:"var(--ok)", "font-size":11}, "Target 80–85 kg"));
  [lo, (lo+hi)/2, hi].forEach(k => { svg.append(el("line", {x1:L, x2:W-R, y1:y(k), y2:y(k), stroke:"var(--line)"})); svg.append(el("text", {x:L-6, y:y(k)+4, "text-anchor":"end", fill:"var(--muted)", "font-size":11}, k.toFixed(1))); });
  svg.append(el("polyline", {points:pts.map(p => `${x(p.t)},${y(p.kg)}`).join(" "), fill:"none", stroke:"var(--accent)", "stroke-width":2.5}));
  pts.forEach(p => svg.append(el("circle", {cx:x(p.t), cy:y(p.kg), r:4, fill:"var(--accent)"})));
  return svg;
}

views.log = () => {
  /* tracker */
  const tracker = h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "Wk"), DAY_NAMES.map(d => h("th", {class:"c"}, d.slice(0,3))), h("th", {}, "Notes"))),
    h("tbody", {}, P.weeks.map(w => h("tr", {},
      h("td", {}, h("a", {href:`#week/${w.n}`}, w.n)),
      DAY_NAMES.map((_,d) => { const b = h("button", {class:"cell" + (S.done[dayKey(w.n,d)] ? " on" : ""), "aria-label":`Week ${w.n} ${DAY_NAMES[d]}`, onclick:() => {
        S.done[dayKey(w.n,d)] ? delete S.done[dayKey(w.n,d)] : S.done[dayKey(w.n,d)] = 1; save(); b.classList.toggle("on"); b.textContent = b.classList.contains("on") ? "✓" : ""; }}, S.done[dayKey(w.n,d)] ? "✓" : "");
        return h("td", {class:"c"}, b); }),
      h("td", {}, h("input", {type:"text", value:S.notes[w.n] || "", "aria-label":`Week ${w.n} notes`, oninput:e => { S.notes[w.n] = e.target.value; save(); }}))))));

  /* grade + pain log */
  const cols = [["boulder","Boulder","text"],["lead","Lead grade","text"],["pullups","Pull-ups","text"],["back","Back 0-10","number"],["fingers","Fingers 0-10","number"],["energy","Energy 0-10","number"]];
  const labels = n => `W${n}` + ({4:" (test)", 11:" (peak)", 12:" (test)"}[n] || "");
  const grades = h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "Week"), cols.map(c => h("th", {}, c[1])))),
    h("tbody", {}, P.weeks.map(w => h("tr", {}, h("td", {}, labels(w.n)),
      cols.map(([k,,type]) => h("td", {}, h("input", {type, min:0, max:10, value:(S.grades[w.n] || {})[k] ?? "", "aria-label":`${labels(w.n)} ${k}`,
        oninput:e => { (S.grades[w.n] = S.grades[w.n] || {})[k] = e.target.value; save(); }})))))));

  /* weight log */
  const chart = h("div", {});
  const wbody = h("tbody", {});
  const drawW = () => {
    chart.replaceChildren(weightChart());
    wbody.replaceChildren(...S.weights.map((r,i) => h("tr", {},
      h("td", {}, h("input", {type:"date", value:r.date, oninput:e => { r.date = e.target.value; save(); chart.replaceChildren(weightChart()); }})),
      h("td", {}, h("input", {type:"number", step:"0.1", value:r.kg, oninput:e => { r.kg = e.target.value; save(); chart.replaceChildren(weightChart()); }})),
      h("td", {}, h("input", {type:"text", value:r.note || "", oninput:e => { r.note = e.target.value; save(); }})),
      h("td", {}, h("button", {class:"iconbtn", "aria-label":"Remove weigh-in", onclick:() => { S.weights.splice(i,1); save(); drawW(); }}, "✕")))));
  };
  drawW();
  const addW = h("button", {class:"btn sm", onclick:() => { S.weights.push({date:ymd(new Date()), kg:"", note:""}); save(); drawW(); }}, "+ Add weigh-in");

  /* backup */
  const imp = h("input", {type:"file", accept:"application/json,.json,text/plain", style:"display:none", onchange:e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => restoreFromText(t)).catch(() => toast("That file couldn't be read."));
    e.target.value = "";
  }});
  const exp = h("button", {class:"btn ghost sm", onclick:exportBackup}, "Export backup");

  return [h("h1", {style:"margin-bottom:12px"}, "Log"),
    h("div", {class:"card"}, h("h2", {}, "Progress tracker"), h("div", {class:"scroll"}, tracker)),
    h("div", {class:"card"}, h("h2", {}, "Grade & pain log"), h("div", {class:"scroll"}, grades)),
    h("div", {class:"card"}, h("div", {class:"row spread"}, h("h2", {}, "Weight log"), addW), chart,
      h("div", {class:"scroll"}, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "kg"), h("th", {}, "Notes"), h("th", {}))), wbody))),
    h("div", {class:"card"}, h("h2", {}, "Backup"),
      h("p", {class:"muted small"}, "Your data lives on this device" + (plug("Preferences") ? " (with a second copy in the app's protected storage)" : "") + ". Export a backup now and then, or to move to another device."),
      h("div", {class:"row"}, exp,
        h("button", {class:"btn ghost sm", onclick:() => backupText("show")}, "Show backup text"),
        h("button", {class:"btn ghost sm", onclick:() => imp.click()}, "Import file"),
        h("button", {class:"btn ghost sm", onclick:() => backupText("paste")}, "Paste to restore"), imp))];
};

views.info = () => [
  h("h1", {style:"margin-bottom:12px"}, P.title),
  h("div", {class:"card"}, h("p", {style:"margin-top:0"}, P.subtitle), P.goals.map(g => h("p", {class:"muted", style:"margin:4px 0"}, g)),
    h("p", {class:"muted", style:"margin:4px 0"}, "Equipment: " + P.equipment)),
  h("div", {class:"card"}, h("h2", {}, "Overview"), h("p", {style:"margin:0"}, P.overview)),
  equipmentCard(),
  remindersCard(),
  updatesCard(),
  h("div", {class:"card"}, h("h2", {}, "Strength guide"), P.strength_guide.map(g => h("p", {}, h("b", {}, g.title + ". "), g.text))),
  h("div", {class:"card"}, h("div", {class:"row spread"}, h("h2", {style:"margin:0"}, "Weekly plan"),
    h("a", {class:"btn sm", href:"#plan"}, "Edit")),
    h("p", {class:"muted small", style:"margin:8px 0 0"}, currentPlan().map((t, d) => DAY_SHORT[d] + ": " + (t.length ? t.map(areaName).join(" + ") : "Rest")).join("  ·  "))),
  h("div", {class:"card"}, h("h2", {}, "Injury management — read before starting"),
    P.injuries.map(i => h("p", {}, h("b", {}, i.label + ": "), i.text)),
    h("div", {class:"callout danger", style:"margin:0"}, P.injury_stop_rule)),
  h("div", {class:"card"}, h("h2", {}, "Nutrition & weight"), P.nutrition.map(t => h("p", {}, t)))];


function updatesCard(){
  const status = h("p", {class:"small", style:"margin:8px 0"});
  const urlIn = h("input", {class:"f", type:"url", placeholder:(window.APP_CONFIG || {}).contentUrl || "https://…/content.json", value:S.contentUrl || ""});
  const uiIn = h("input", {class:"f", type:"url", placeholder:(window.APP_CONFIG || {}).uiUrl || "https://…/ui.json", value:S.uiUrl || ""});
  const text = {
    nourl:"no update address set", bad:"file wasn't valid", current:"up to date", unsigned:"rejected (signature check failed)",
    updated:"new version downloaded", appold:"needs a newer app build", error:"couldn't reach the address"
  };
  const check = h("button", {class:"btn ghost sm", onclick:async () => {
    status.textContent = "Checking…";
    const [c, u] = await Promise.all([checkUpdates(), checkUiUpdate()]);
    status.textContent = `Content: ${text[c.status] || c.status}${c.version ? " (v" + c.version + ")" : ""} · Interface: ${text[u.status] || u.status}${u.version ? " (v" + u.version + ")" : ""}`;
  }}, "Check for updates");
  const live = P !== BUNDLED;
  return h("div", {class:"card"}, h("h2", {}, "Content & updates"),
    h("p", {class:"small muted", style:"margin:0 0 4px"}, `Program content: v${P.version}` + (live ? ` (live update; this app shipped with v${BUNDLED.version})` : " (bundled)")),
    h("p", {class:"small muted", style:"margin:0"}, `Interface: v${window.UI_RUNNING_VERSION || "?"} (${window.UI_SOURCE === "live" ? "live update" : "bundled"})` +
      (S.lastCheck ? ` · last checked ${new Date(S.lastCheck).toLocaleString()}` : "")),
    status,
    h("div", {class:"row"}, check),
    h("details", {style:"margin-top:12px"}, h("summary", {class:"small"}, "Update addresses"),
      h("p", {class:"small muted"}, "Where the app looks for new exercises/program changes (content) and new interface versions. Leave blank to use the built-in addresses. Interface updates only install if they're signed with this app's key."),
      h("label", {class:"small muted"}, "Content address"), urlIn,
      h("label", {class:"small muted", style:"display:block;margin-top:8px"}, "Interface address"), uiIn,
      h("div", {style:"margin-top:10px"}, h("button", {class:"btn sm", onclick:() => { S.contentUrl = urlIn.value.trim(); S.uiUrl = uiIn.value.trim(); save(); toast("Update addresses saved."); }}, "Save addresses"))),
    h("details", {style:"margin-top:10px"}, h("summary", {class:"small"}, "What's new"),
      (P.changelog || []).map(c => h("div", {style:"margin-top:8px"}, h("b", {}, `v${c.version}`), h("span", {class:"muted small"}, ` · ${c.date}`),
        h("ul", {style:"margin:4px 0 0;padding-left:20px"}, c.notes.map(n => h("li", {class:"small"}, n)))))));
}

/* ---------------- router ---------------- */
const TABS = [["today","Today","today"],["program","Program","program"],["mobility","Mobility","mobility"],["tests","Tests","tests"],["log","Log","log"],["info","Info","info"]];
function route(keep){
  const [name, ...args] = (location.hash.slice(1) || "today").split("/");
  const base = name === "week" || name === "day" || name === "plan" ? "program" : name;
  const view = views[name] || views.today;
  document.getElementById("tabs").replaceChildren(...TABS.map(([k, t, ic]) =>
    h("a", {href:"#" + k, class:k === base ? "on" : "", "aria-current":k === base ? "page" : null}, icon(ic), h("span", {}, t))));
  app.replaceChildren(...[view(...args)].flat(Infinity).filter(x => x != null && x !== false));
  if (!keep) window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* theme toggle */
document.getElementById("theme").onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem(KEY + ".theme", root.dataset.theme); } catch (e) {}
};
try { const t = localStorage.getItem(KEY + ".theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

applyPlan();
route();
try { localStorage.removeItem("climbprog.ui.pending"); } catch (e) {}   // this interface started fine

/* durable storage: if the WebView's own storage was wiped, restore from the native copy (once) */
(async function restoreNative(){
  const Pref = plug("Preferences");
  if (!Pref) return;
  try {
    if (!localStorage.getItem(KEY) && !sessionStorage.getItem("climbprog.restored")){
      const r = await Pref.get({ key:"state" });
      if (r && r.value){ localStorage.setItem(KEY, r.value); sessionStorage.setItem("climbprog.restored", "1"); location.reload(); return; }
    }
    mirrorState();
  } catch (e) {}
})();

/* live updates: on launch, and when the app comes back to the foreground (at most every 30 min) */
const autoCheck = () => {
  if (S.lastCheck && Date.now() - new Date(S.lastCheck).getTime() < 30*60*1000) return;
  if (navigator.onLine === false) return;
  checkUpdates();
  checkUiUpdate();
};
setTimeout(autoCheck, 1200);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") autoCheck(); });

/* installable + offline (needs http/https, skipped on file://) */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")){
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
