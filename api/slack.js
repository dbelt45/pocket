import { waitUntil } from "@vercel/functions";
import { asAdmin } from "./_lib/supabase.js";
import { verifySlack, slackUserId } from "./_lib/slack.js";

// POST /api/slack - the "Save to Pocket" shortcut on any Slack message.
// Slack posts here when Daniel picks it from a message's menu. The message is
// saved to Pocket unsorted, with a link back, and the AI sorts it into a task,
// follow-up or note the next time the app opens.
//
// A web handler (not req/res) because the signature check needs the raw body,
// exactly as Slack sent it.
export async function POST(request) {
  const raw = await request.text();
  const ok = verifySlack(raw, request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"), process.env.SLACK_SIGNING_SECRET);
  if (!ok) return new Response("bad signature", { status: 401 });

  const p = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}");
  if (p.type !== "message_action" || p.callback_id !== "save_to_pocket") return new Response("");

  const reply = (text) => waitUntil(fetch(p.response_url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", text }),
  }).catch(() => null));

  // The shortcut shows for everyone in the workspace. Only Daniel's clicks count.
  if (p.user?.id !== (await slackUserId())) {
    reply("Save to Pocket only works for Daniel.");
    return new Response("");
  }

  const link = `https://${p.team.domain}.slack.com/archives/${p.channel.id}/p${p.message.ts.replace(".", "")}`;
  const text = (p.message.text || "(message with no text)").slice(0, 3800);
  const { error } = await asAdmin().from("captures").insert({
    id: crypto.randomUUID(), user_id: process.env.POCKET_USER_ID,
    body: `${text}\n\nFrom Slack: ${link}`, captured_at: new Date().toISOString(),
  });
  reply(error ? `Could not save to Pocket: ${error.message}` : "Saved to Pocket. It gets sorted the next time you open the app.");
  return new Response("");
}
