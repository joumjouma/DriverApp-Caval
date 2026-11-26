// UltraMsg webhook → public.whatsapp_bot (all the bot logic is in SQL).
// UltraMsg webhook URL:
//   https://ysuoieejgophdyrcotnv.supabase.co/functions/v1/whatsapp-webhook?key=<WHATSAPP_WEBHOOK_KEY>
// Secret to set once: WHATSAPP_WEBHOOK_KEY (any long random string, also put in the URL above).
// Deployed with verify_jwt = false: UltraMsg can't send a Supabase token, the key protects it.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const key = Deno.env.get("WHATSAPP_WEBHOOK_KEY");
  const url = new URL(req.url);
  if (req.method !== "POST" || !key || url.searchParams.get("key") !== key) {
    return new Response("forbidden", { status: 403 });
  }
  let payload: any = {};
  try { payload = await req.json(); } catch { return new Response("ok"); }
  const m = payload.data ?? {};
  if (payload.event_type && payload.event_type !== "message_received") return new Response("ok");
  if (m.fromMe || !m.from || String(m.from).endsWith("@g.us")) return new Response("ok"); // no groups, no echoes

  const lat = Number(m.lat ?? m.location?.latitude);
  const lng = Number(m.lng ?? m.location?.longitude);
  const { error } = await supabase.rpc("whatsapp_bot", {
    p_from: String(m.from).replace(/@.*/, ""),
    p_msg_id: m.id ? String(m.id) : null,
    p_type: m.type ?? "chat",
    p_body: m.body ?? "",
    p_lat: Number.isFinite(lat) ? lat : null,
    p_lng: Number.isFinite(lng) ? lng : null,
    p_name: m.pushname ?? null,
  });
  if (error) console.error("whatsapp_bot failed", error);
  return new Response("ok"); // always 200 so UltraMsg doesn't retry-storm
});
