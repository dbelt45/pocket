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

let sb, cfg, session, filter = "all", syncing = false;

// ------------------------------------------------------------------ startup
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

async function start() {
  try {
    const r = await fetch("/api/config");
    if (r.ok) { cfg = await r.json(); write(K.cfg, cfg); }
  } catch { /* offline: fall back to the saved copy */ }
  cfg ??= read(K.cfg, null);
  if (!cfg?.supabaseUrl) { $("#auth").hidden = false; $("#authMsg").textContent = "Open Pocket once with a signal to finish setting up."; return; }

  sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_e, s) => { const was = !!session; session = s; if (was !== !!s) show(); });
  show();
}

function show() {
  $("#install").hidden = !(isIOS && !standalone);
  $("#auth").hidden = !!session;
  $("#app").hidden = !session;
  renderNet();
  if (!session) return;
  render(); renderToday(); renderPush();
  track("open", { standalone });
  sync(); loadToday(); loadStats();
}

// --------------------------------------------------------------------- auth
// A typed code, not a magic link. On iPhone a link in an email opens in Safari,
// which has separate storage from the installed app, so the app would never see
// the login. A code typed into the app itself avoids that entirely.
$("#emailForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#authMsg").textContent = "Sending...";
  const { error } = await sb.auth.signInWithOtp({ email: $("#email").value.trim(), options: { shouldCreateUser: false } });
  $("#authMsg").textContent = error ? error.message : "Check your email for the code.";
  if (!error) { $("#codeForm").hidden = false; $("#code").focus(); }
};
$("#codeForm").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.verifyOtp({ email: $("#email").value.trim(), token: $("#code").value.trim(), type: "email" });
  $("#authMsg").textContent = error ? error.message : "";
};
$("#signout").onclick = async () => { await sb.auth.signOut(); localStorage.removeItem(K.list); };

// ------------------------------------------------------------------ capture
$("#captureForm").onsubmit = (e) => {
  e.preventDefault();
  const body = $("#body").value.trim();
  if (!body) return;
  // The id is made here, on the phone. A retried upload reuses it, so the
  // database can tell a retry from a new note and never saves one twice.
  const item = { id: crypto.randomUUID(), body, captured_at: new Date().toISOString() };
  write(K.outbox, [...read(K.outbox, []), item]);
  $("#body").value = "";
  render();
  track("capture", { offline: !navigator.onLine, chars: body.length });
  sync();
};

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
    const box = read(K.outbox, []);
    if (box.length) {
      const { error } = await sb.from("captures").upsert(box, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`Could not save to the database: ${error.message}`);
      // Remove only what was sent. Something typed during the upload stays queued.
      const sent = new Set(box.map((b) => b.id));
      write(K.outbox, read(K.outbox, []).filter((b) => !sent.has(b.id)));
    }
    await loadList();
    if (read(K.list, []).some((c) => c.ai_status === "pending")) {
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
  if (Date.now() - (read(K.today, {}).at ?? 0) > 15 * 60e3) loadToday();
});

// ------------------------------------------------------------------- render
function renderNet() {
  const waiting = read(K.outbox, []).length;
  const el = $("#net");
  if (!navigator.onLine) { el.textContent = waiting ? `Offline, ${waiting} waiting` : "Offline"; el.className = "pill off"; }
  else if (syncing) { el.textContent = "Syncing"; el.className = "pill"; }
  else { el.textContent = waiting ? `${waiting} waiting` : "Synced"; el.className = "pill ok"; }
}

const LABEL = { task: "Task", followup: "Follow-up", note: "Note", unsorted: "Unsorted" };

function render() {
  renderNet();
  const today = new Date().toLocaleDateString("en-CA");
  const queued = read(K.outbox, []).map((q) => ({ ...q, kind: "unsorted", queued: true }));
  let rows = [...queued, ...read(K.list, [])];
  rows = filter === "done" ? rows.filter((r) => r.done_at)
       : rows.filter((r) => !r.done_at && (filter === "all" || r.kind === filter));

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
      <div class="actions">${actions}${r.queued ? "" : `<button data-a="del" data-id="${r.id}" class="link">Delete</button>`}</div>
    </li>`;
  }).join("") : `<li class="empty">${filter === "done" ? "Nothing done yet." : "Nothing here. Type something above."}</li>`;
}

const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

$("#tabs").onclick = (e) => {
  const f = e.target.dataset?.f; if (!f) return;
  filter = f;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.f === f));
  render();
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
  if (!t) { el.innerHTML = `<p class="muted">Loading today's calendar...</p>`; return; }
  const asOf = new Date(t.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!t.ok) { el.innerHTML = `<p class="warn">Calendar unavailable: ${esc(t.message)}</p>`; return; }
  const items = t.events.map((e) => `<li><span>${e.allDay ? "All day" : new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>${esc(e.summary)}</li>`).join("");
  el.innerHTML = `<div class="head"><b>Today</b><span class="muted">as of ${asOf}${navigator.onLine ? "" : ", saved copy"}</span></div>
    ${items ? `<ul>${items}</ul>` : `<p class="muted">No meetings today.</p>`}`;
}

// ------------------------------------------------------------ notifications
async function renderPush() {
  const box = $("#pushBox");
  if (!("PushManager" in window) || !("serviceWorker" in navigator)) {
    box.innerHTML = `<p class="muted">${isIOS && !standalone ? "Add Pocket to your Home Screen to turn on the morning reminder." : "This browser cannot show reminders."}</p>`;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  box.innerHTML = sub && Notification.permission === "granted"
    ? `<p>Morning reminder is on.</p><button id="pushTest" class="secondary">Send it now</button>`
    : `<button id="pushOn" class="secondary">Turn on morning reminder</button>`;
  $("#pushOn")?.addEventListener("click", enablePush);
  $("#pushTest")?.addEventListener("click", async () => {
    msg("Sending...");
    const r = await api("/api/push-test", "POST");
    msg(r.ok ? "Sent. It should appear in a few seconds." : `Did not send: ${r.message ?? `delivered ${r.delivered ?? 0} of ${r.subscribed ?? 0}`}`);
  });
}

async function enablePush() {
  // iOS only allows this from a tap, and only in the installed app.
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return msg("Notifications are off. Turn them on in Settings, Notifications, Pocket.");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) });
  const j = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent });
  if (error) return msg(`Could not save the reminder: ${error.message}`);
  track("push_enabled");
  renderPush();
}

function b64ToBytes(b64) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
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

async function loadStats() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [c, o] = await Promise.all([
    sb.from("captures").select("id", { count: "exact", head: true }).gte("captured_at", since),
    sb.from("events").select("id", { count: "exact", head: true }).eq("name", "pocket:open").gte("created_at", since),
  ]);
  if (!c.error && !o.error) $("#stats").textContent = `Last 7 days: ${c.count} captures, ${o.count} opens.`;
}

function msg(t) { $("#msg").textContent = t; }

start();
