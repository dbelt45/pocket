import { logCall } from "./supabase.js";

// Slack: sends a message from Daniel to his DM with Ricky. It uses Daniel's own
// Slack user token (SLACK_USER_TOKEN), so it shows up from him, and every
// message ends with "Sent by Daniel via Jarvis" so Ricky knows how it got there.
// Posting to Ricky's user id with a user token lands in their existing DM.
// Jarvis always reads the message back and waits for a "yes" before this runs.

export const SIGNATURE = "_Sent by Daniel via Jarvis_";
const LABEL = { task: "Tasks", followup: "Follow-ups", note: "Notes", thought: "Thoughts" };

/** The Slack message for a set of Pocket items and/or a note from Daniel. */
export function slackText(kind, items = [], note = "") {
  const parts = [];
  if (note) parts.push(note);
  if (items.length) {
    const lines = items.map((i) => `• ${i.text}${i.due_on ? ` (due ${i.due_on})` : ""}`);
    parts.push(`*${LABEL[kind] ?? "Items"}*\n${lines.join("\n")}`);
  }
  return `${parts.join("\n\n")}\n\n${SIGNATURE}`;
}

export async function sendToRicky(supabase, userId, text) {
  const token = process.env.SLACK_USER_TOKEN, ricky = process.env.SLACK_RICKY_USER_ID;
  if (!token || !ricky) return { ok: false, message: "Slack is not set up yet. It needs SLACK_USER_TOKEN and SLACK_RICKY_USER_ID in Vercel." };
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: ricky, text, unfurl_links: false }),
    }).then((x) => x.json());
    await logCall(supabase, userId, "slack", r.ok, 200, `[pocket] DM to Ricky: ${r.ok ? "sent" : r.error}`);
    return r.ok ? { ok: true } : { ok: false, message: `Slack said ${r.error}.` };
  } catch (e) {
    await logCall(supabase, userId, "slack", false, null, `[pocket] ${e.message}`);
    return { ok: false, message: "Could not reach Slack." };
  }
}
