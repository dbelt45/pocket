// The browser needs the Supabase address, the publishable key and the public
// push key. None of them are secrets: the publishable key only identifies the
// project, and row-level security decides what a session may read. Serving
// them from here keeps every value in Vercel's settings instead of the code.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  });
}
