// Pocket, the whole front end. No framework: one page, one file.
//
// The offline design in one sentence: every capture is saved on the phone
// FIRST (the "outbox"), shown immediately, and sent to the database whenever
// there is a signal. The last list and calendar the phone saw are kept too, so
// the app opens and reads fine on a plane.

const $ = (s) => document.querySelector(s);
const K = { outbox: "pocket.outbox", list: "pocket.list", today: "pocket.today", cfg: "pocket.config" };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

let sb, cfg, session, filter = null, syncing = false;

// ------------------------------------------------------------------ startup
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

async function start() {
  try {
    const r = await fetch("/api/config");
    if (r.ok) { cfg = await r.json(); write(K.cfg, cfg); }
  } catch { /* offline: fall back to the saved copy */ }
  cfg ??= read(K.cfg, null);
  if (!cfg?.supabaseUrl) { $("#auth").hidden = false; $("#authMsg").textContent = "Open Pocket once with a signal to finish setting up."; return; }

  // Arrived from the tapped email link? Supabase puts the new session in the
  // address after "#". On iPhone this lands in Safari, not the installed app,
  // so show the refresh token as a code to paste into the app instead of
  // signing Safari in. Nothing is stored here: if Safari kept and later
  // refreshed the same token, Supabase would treat it as stolen and sign the
  // app out too.
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has("refresh_token") || h.has("error_code")) {
    history.replaceState(null, "", location.pathname);
    if (h.has("refresh_token")) return handoff(h, cfg);
    $("#auth").hidden = false;
    $("#authMsg").textContent = h.get("error_code") === "otp_expired"
      ? "That email link was already used or expired. Send a new one and tap it once." : h.get("error_description");
  }

  sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_e, s) => { const was = !!session; session = s; if (was !== !!s) show(); });
  show();
}

function show() {
  $("#install").hidden = !(isIOS && !standalone);
  $("#auth").hidden = !!session;
  $("#app").hidden = !session;
  $("#moveBox").hidden = !(session && isIOS && !standalone);
  renderNet();
  if (!session) return;
  render(); renderToday();
  track("open", { standalone });
  sync(); loadToday();
}

// --------------------------------------------------------------------- auth
// On iPhone the installed app and Safari keep separate storage, and a tapped
// email link opens Safari. So: tap the link, Safari shows a sign-in code
// (handoff below), paste the code here. Do NOT press and hold the link: iOS
// opens a preview, which uses up the one-time link before it can be pasted.
// The box also accepts the link itself or a 6-digit code (if the email
// template ever includes one; Supabase only allows that with custom SMTP).
export function readSignIn(text) {
  let s = text.trim();
  for (let i = 0; i < 3; i++) { try { s = decodeURIComponent(s); } catch { break; } } // unwraps Gmail's google.com/url?q=...
  const hash = s.match(/[?&]token(?:_hash)?=([^&\s#]+)/);
  if (hash) return { token_hash: hash[1], type: (s.match(/[?&]type=([a-z_]+)/) || [])[1] || "magiclink" };
  if (/^\d{6,10}$/.test(s)) return { code: s };
  if (/^[A-Za-z0-9_-]{8,200}$/.test(s)) return { refresh: s };
  return null;
}

function handoff(h, cfg) {
  $("#auth").hidden = false;
  $("#emailForm").hidden = $("#codeForm").hidden = $("#authLead").hidden = true;
  $("#handoff").hidden = false;
  $("#handoffCode").textContent = h.get("refresh_token");
  $("#handoffCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(h.get("refresh_token")); $("#handoffCopy").textContent = "Copied"; }
    catch { $("#handoffCopy").textContent = "Select the code and copy it"; }
  };
  $("#handoffHere").onclick = async () => { // on a laptop, just use Pocket in this browser
    sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    await sb.auth.setSession({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token") });
    location.reload();
  };
}

// Signed in inside Safari by mistake? Hand that session to the installed app:
// show its refresh token as a code, and forget it here WITHOUT signing out
// (signing out would end the very session being handed over).
$("#moveBtn").onclick = async () => {
  sb.auth.stopAutoRefresh();
  const s = (await sb.auth.getSession()).data.session;
  for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
  $("#app").hidden = true;
  handoff(new URLSearchParams({ access_token: s.access_token, refresh_token: s.refresh_token }), cfg);
};

$("#emailForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#authMsg").textContent = "Sending...";
  const { error } = await sb.auth.signInWithOtp({ email: $("#email").value.trim(),
    options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/` } });
  $("#authMsg").textContent = error ? error.message : "Email sent. Tap the link in it once. It shows a code. Copy that code, come back here and paste it below.";
  if (!error) { $("#codeForm").hidden = false; $("#code").focus(); }
};
$("#codeForm").onsubmit = async (e) => {
  e.preventDefault();
  const got = readSignIn($("#code").value);
  if (!got) { $("#authMsg").textContent = "That does not look like the sign-in code. Copy it again and paste it."; return; }
  $("#authMsg").textContent = "Signing in...";
  const { error } = got.code ? await sb.auth.verifyOtp({ email: $("#email").value.trim(), token: got.code, type: "email" })
    : got.refresh ? await sb.auth.refreshSession({ refresh_token: got.refresh })
    : await sb.auth.verifyOtp({ token_hash: got.token_hash, type: got.type });
  $("#authMsg").textContent = error ? `${error.message}. Links work once and expire after an hour, so send a new one if needed.` : "";
};
$("#signout").onclick = async () => { await sb.auth.signOut(); localStorage.removeItem(K.list); };

// ------------------------------------------------------------------ capture
function queueCapture(body, extra = {}) {
  // The id is made here, on the phone. A retried upload reuses it, so the
  // database can tell a retry from a new note and never saves one twice.
  const item = { id: crypto.randomUUID(), body, captured_at: new Date().toISOString(), ...extra };
  write(K.outbox, [...read(K.outbox, []), item]);
  render();
  track("capture", { offline: !navigator.onLine, chars: body.length });
  sync();
}

// --------------------------------------------------------------------- sync
async function token() { return (await sb.auth.getSession()).data.session?.access_token; }
async function api(path, method = "GET") {
  const r = await fetch(path, { method, headers: { Authorization: `Bearer ${await token()}` } });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function sync() {
  if (syncing || !session || !navigator.onLine) return;
  syncing = true; renderNet(); msg("");
  try {
    let box = read(K.outbox, []);
    // A task typed straight into Tasks also goes on the Daniel OS task list,
    // as a sorted one does. The task id is saved first so a retry never adds it twice.
    for (const b of box.filter((b) => b.kind === "task" && !b.task_id)) {
      const { data, error } = await sb.from("tasks")
        .insert({ user_id: session.user.id, title: b.title, due_on: b.due_on ?? null, priority: 3 }).select("id").single();
      if (error) throw new Error(`Could not add the task: ${error.message}`);
      box = read(K.outbox, []).map((q) => q.id === b.id ? { ...q, task_id: data.id } : q);
      write(K.outbox, box);
    }
    if (box.length) {
      const { error } = await sb.from("captures").upsert(box, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`Could not save to the database: ${error.message}`);
      // Remove only what was sent. Something typed during the upload stays queued.
      const sent = new Set(box.map((b) => b.id));
      write(K.outbox, read(K.outbox, []).filter((b) => !sent.has(b.id)));
    }
    await loadList();
    if (read(K.list, []).some((c) => c.ai_status === "pending" || (c.kind === "thought" && !c.feedback))) {
      render();
      const r = await api("/api/sort", "POST");
      if (!r.ok) msg(`AI sorting is unavailable right now, so your notes are saved unsorted. It tries again next time. (${r.message ?? r.status})`);
      await loadList();
    }
  } catch (e) {
    msg(e.message);
  } finally {
    syncing = false; render(); renderNet();
  }
}

async function loadList() {
  const { data, error } = await sb.from("captures").select("*").order("captured_at", { ascending: false }).limit(150);
  if (error) throw new Error(`Could not load your list: ${error.message}`);
  write(K.list, data);
}

addEventListener("online", () => { renderNet(); sync(); loadToday(); });
addEventListener("offline", renderNet);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !session) return;
  sync();
  loadToday(); // every time, so an event added anywhere shows up at once
});

// ------------------------------------------------------------------- render
function renderNet() {
  const waiting = read(K.outbox, []).length;
  const el = $("#net");
  if (!navigator.onLine) { el.textContent = waiting ? `Offline, ${waiting} waiting` : "Offline"; el.className = "pill off"; }
  else if (syncing) { el.textContent = "Syncing"; el.className = "pill"; }
  else { el.textContent = waiting ? `${waiting} waiting` : "Synced"; el.className = "pill ok"; }
}

const LABEL = { task: "Task", followup: "Follow-up", note: "Note", thought: "Thought", unsorted: "Unsorted" };

function render() {
  renderNet();
  const today = new Date().toLocaleDateString("en-CA");
  const queued = read(K.outbox, []).map((q) => ({ kind: "unsorted", ...q, queued: true }));
  const all = [...queued, ...read(K.list, [])];
  const pick = (f) => f === "done" ? all.filter((r) => r.done_at)
    : all.filter((r) => !r.done_at && (f === "all" ? r.kind !== "thought" : r.kind === f));
  document.querySelectorAll("#tabs button").forEach((b) => { b.querySelector("b").textContent = pick(b.dataset.f).length; });
  $("#tabs").hidden = $("#today").hidden = !!filter;
  $("#section").hidden = !filter;
  if (!filter) return;
  $("#addBtn").hidden = filter === "done";
  $("#sectionTitle").textContent = $(`#tabs [data-f="${filter}"]`).firstChild.textContent;
  const rows = pick(filter);

  $("#list").innerHTML = rows.length ? rows.map((r) => {
    const status = r.queued ? "Waiting for a signal"
      : r.ai_status === "pending" ? "Sorting..."
      : r.ai_status === "failed" ? "AI could not sort this" : "";
    const overdue = r.due_on && !r.done_at && r.due_on < today;
    const due = r.due_on ? `<span class="due ${overdue ? "late" : ""}">${r.due_on === today ? "Today" : fmtDate(r.due_on)}</span>` : "";
    const actions = r.queued ? "" : r.done_at
      ? `<button data-a="undo" data-id="${r.id}">Undo</button>`
      : `${r.ai_status === "failed" ? `<button data-a="retry" data-id="${r.id}">Try again</button>` : ""}
         <button data-a="done" data-id="${r.id}">Done</button>`;
    return `<li class="${r.kind}">
      <div class="meta"><span class="kind">${LABEL[r.kind]}</span>${due}${status ? `<span class="status">${status}</span>` : ""}</div>
      <p class="title">${esc(r.title || r.body)}</p>
      ${r.title && r.title !== r.body ? `<p class="body">${esc(r.body)}</p>` : ""}
      ${r.kind === "thought" ? feedbackHtml(r) : ""}
      <div class="actions">${actions}${r.queued ? "" : `<button data-a="del" data-id="${r.id}" class="link">Delete</button>`}</div>
    </li>`;
  }).join("") : `<li class="empty">${filter === "done" ? "Nothing done yet."
      : "Nothing here."}</li>`;
}

const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

$("#tabs").onclick = (e) => {
  const f = e.target.closest("button")?.dataset.f; if (!f) return;
  filter = f;
  render(); scrollTo(0, 0);
};
$("#back").onclick = () => { filter = null; closeAdd(); render(); };

// Typing straight into a section. It saves as that kind, so the AI does not
// re-sort it. In All there is no kind to pick, so the AI sorts it as before.
const HINT = { task: "New task", followup: "Who to follow up with, and about what", note: "New note",
  thought: "What's the thought?", all: "Anything. AI sorts it." };
$("#addBtn").onclick = () => {
  $("#addForm").hidden = false;
  $("#addText").placeholder = HINT[filter];
  $("#addDueRow").hidden = !["task", "followup"].includes(filter);
  $("#addText").focus();
};
function closeAdd() { $("#addForm").hidden = true; $("#addText").value = ""; $("#addDue").value = ""; }
$("#addCancel").onclick = closeAdd;
$("#addForm").onsubmit = (e) => {
  e.preventDefault();
  const body = $("#addText").value.trim(); if (!body) return;
  const due_on = $("#addDue").value || null;
  queueCapture(body, filter === "all" ? {} : { kind: filter, title: body, ai_status: "done", ai_note: "Typed in Pocket",
    ...(["task", "followup"].includes(filter) && { due_on }) });
  closeAdd();
};

// Changing a saved row needs the database, so these ask for a signal rather
// than queueing. Only new captures are queued offline.
$("#list").onclick = async (e) => {
  const { a, id } = e.target.dataset ?? {}; if (!a) return;
  if (!navigator.onLine) return msg("You're offline. New notes still save; changes to old ones need a signal.");
  const row = read(K.list, []).find((r) => r.id === id);
  if (a === "del" && !confirm("Delete this note?")) return;
  const now = new Date().toISOString();
  const q = a === "done" ? sb.from("captures").update({ done_at: now }).eq("id", id)
          : a === "undo" ? sb.from("captures").update({ done_at: null }).eq("id", id)
          : a === "retry" ? sb.from("captures").update({ ai_status: "pending", ai_note: null }).eq("id", id)
          : sb.from("captures").delete().eq("id", id);
  const { error } = await q;
  if (error) return msg(error.message);
  // Keep the Daniel OS task list in step with Pocket.
  if (row?.task_id && (a === "done" || a === "undo")) {
    await sb.from("tasks").update(a === "done" ? { status: "done", done_at: now } : { status: "open", done_at: null }).eq("id", row.task_id);
  }
  track(a);
  a === "retry" ? sync() : (await loadList(), render());
};

// ---------------------------------------------------------- today's calendar
async function loadToday() {
  if (!navigator.onLine) return;
  const r = await api("/api/today").catch(() => null);
  if (r) { write(K.today, { ...r, at: Date.now() }); renderToday(); }
}

function renderToday() {
  const t = read(K.today, null), el = $("#today");
  if (!t) { el.innerHTML = `<p class="muted">${navigator.onLine ? "Loading today's calendar..." : "Today's calendar needs a signal."}</p>`; return; }
  const asOf = new Date(t.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!t.ok) { el.innerHTML = `<p class="warn">Calendar unavailable: ${esc(t.message)}</p>`; return; }
  const items = t.events.map((e) => `<li><span>${e.allDay ? "All day" : new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>${esc(e.summary)}</li>`).join("");
  el.innerHTML = `<div class="head"><b>Today</b><span class="muted">as of ${asOf}${navigator.onLine ? "" : ", saved copy"}</span></div>
    ${items ? `<ul>${items}</ul>` : `<p class="muted">No meetings today.</p>`}`;
}

// ---------------------------------------------------------------- analytics
// Same `events` table as Daniel OS, tagged app = pocket. Analytics never
// blocks or breaks the app, so failures are ignored on purpose.
function track(name, meta = {}) {
  if (!session || !navigator.onLine) return;
  sb.from("events").insert({
    user_id: session.user.id, kind: name === "open" ? "page_view" : "action",
    name: `pocket:${name}`, path: location.pathname, meta: { app: "pocket", ...meta },
  }).then(() => {}, () => {});
}

function msg(t) { $("#msg").textContent = t; }

// The AI's take on a thought, plus a deeper review if one was written from Claude Code.
function feedbackHtml(r) {
  const f = r.feedback;
  const review = r.review ? `<p class="h">Claude's review</p><p>${esc(r.review).replace(/\n/g, "<br>")}</p>` : "";
  if (!f) return `<div class="fb"><p class="muted">Feedback coming when the AI is free.</p>${review}</div>`;
  return `<div class="fb">
    <p><span class="verdict ${f.verdict.replace(" ", "-")}">${esc(f.verdict)}</span> ${esc(f.summary)}</p>
    <p class="h">Why</p><p>${esc(f.why)}</p>
    <p class="h">What it could become</p><p>${esc(f.what_could_be_done)}</p>
    <p class="h">How to start</p><ol>${f.first_steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
    ${review}
  </div>`;
}

// -------------------------------------------------------------------- jarvis
// Tap Jarvis, talk, and he answers out loud. The phone's own speech engine
// does both directions (listening and speaking), so voice costs nothing. Only
// working out what you meant uses the AI, on the server.
// If this phone's browser cannot listen, the text box works with the keyboard's mic.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;

$("#jarvisBtn").onclick = () => {
  $("#jarvis").hidden = false;
  $("#jYou").textContent = "";
  unlockSpeech();
  if (SR) talk();
  else { $("#jSays").textContent = "Type below, or tap the mic on your keyboard."; $("#jText").focus(); }
};
$("#jClose").onclick = () => { $("#jarvis").hidden = true; speechSynthesis.cancel(); try { playing?.stop(); } catch {} recog?.abort(); };
$("#jTalk").onclick = () => { unlockSpeech(); SR ? talk() : $("#jText").focus(); };
$("#jForm").onsubmit = (e) => {
  e.preventDefault();
  const t = $("#jText").value.trim();
  if (t) { $("#jText").value = ""; ask(t); }
};

// iPhone only lets a page speak after a tap. Speaking nothing during the tap
// unlocks it for the reply that arrives a few seconds later.
// The ElevenLabs player needs the same unlock: waking the audio engine during
// the tap lets it play the reply that arrives later.
let audioCtx = null, playing = null;
function unlockSpeech() {
  try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch { /* no speech */ }
  try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* no audio */ }
}

function talk() {
  recog?.abort();
  recog = new SR();
  recog.lang = "en-US"; recog.interimResults = true; recog.continuous = false;
  let heard = "";
  $("#jSays").textContent = "Listening...";
  recog.onresult = (e) => { heard = [...e.results].map((r) => r[0].transcript).join(""); $("#jYou").textContent = heard; };
  recog.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") $("#jSays").textContent = "The microphone is blocked. Allow it in Settings, or type below.";
  };
  recog.onend = () => {
    if (heard.trim()) ask(heard.trim());
    else if ($("#jSays").textContent === "Listening...") $("#jSays").textContent = "I didn't hear anything. Tap Talk to try again.";
  };
  try { recog.start(); } catch { $("#jSays").textContent = "Tap Talk to answer."; }
}

async function ask(text) {
  $("#jYou").textContent = text;
  if (!navigator.onLine) {
    // No signal: never lose what he said. Keep it as a note to sort later.
    queueCapture(text);
    return reply("No signal, so I saved that as a note. I'll sort it when you're back online.");
  }
  $("#jSays").textContent = "...";
  const r = await fetch("/api/jarvis", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ text }),
  }).then((x) => x.json()).catch(() => ({ say: "I couldn't reach the server. Try again in a moment." }));
  await reply(r.say ?? "Something went wrong on my side.");
  loadList().then(render).catch(() => {});
  loadToday(); // he may have just added or removed a calendar event
  // He asked a question ("What are you thinking?", "delete X?"), so listen for the answer.
  if (r.listen) SR ? talk() : $("#jText").focus();
}

// Jarvis's own voice, from ElevenLabs via /api/speak. Resolves true once he
// has finished speaking, or false straight away (offline, not set up, any
// error) so reply() falls back to the phone's built-in voice.
async function speakJarvis(text) {
  if (!audioCtx || !navigator.onLine) return false;
  try {
    const r = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ text }),
    });
    if (r.status !== 200) return false;
    const buf = await audioCtx.decodeAudioData(await r.arrayBuffer());
    speechSynthesis.cancel();
    return await new Promise((done) => {
      const src = audioCtx.createBufferSource();
      src.buffer = buf; src.connect(audioCtx.destination); playing = src;
      src.onended = () => done(true);
      src.start();
      setTimeout(() => done(true), buf.duration * 1000 + 2000); // never hang
    });
  } catch { return false; }
}

async function reply(text) {
  $("#jSays").textContent = text;
  if (await speakJarvis(text)) return;
  return new Promise((done) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US"; u.onend = done; u.onerror = done;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      setTimeout(done, 30000); // never hang if the phone never reports "finished"
    } catch { done(); }
  });
}


start();
