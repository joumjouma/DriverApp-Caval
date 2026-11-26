// In-app chat between a driver and a customer (one conversation per pair).
// The database only lets the two people in it read or write, and only once
// they have shared a ride. A new message notifies the other person (messages_notify).
import { supabase, check, me } from "../config/supabase";

/** Existing conversation id for this driver + customer, or a new one. */
export async function createConversation(driverId, customerId) {
  const { data } = await supabase.from("conversations").select("id")
    .eq("driver_id", driverId).eq("customer_id", customerId).maybeSingle();
  if (data?.id) return data.id;
  const row = check(await supabase.from("conversations")
    .insert({ driver_id: driverId, customer_id: customerId }).select("id").single());
  return row.id;
}

/** Calls cb(messages) now and on every new message. Returns an unsubscribe function. */
export function watchMessages(conversationId, cb) {
  let alive = true;
  const load = async () => {
    const { data } = await supabase.from("messages").select("*").eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }).limit(200);
    if (alive) cb((data || []).map((m) => ({ id: m.id, text: m.body, senderId: m.sender_id, at: new Date(m.created_at), read: !!m.read_at })));
  };
  load();
  const ch = supabase.channel(`messages:${conversationId}:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, load)
    .subscribe();
  return () => { alive = false; supabase.removeChannel(ch); };
}

export async function sendMessage(conversationId, text) {
  const body = String(text || "").trim().slice(0, 1000);
  if (!body) return;
  check(await supabase.from("messages").insert({ conversation_id: conversationId, sender_id: me(), body }));
}

/** Marks the other person's messages as read. */
export async function markConversationAsRead(conversationId) {
  await supabase.from("messages").update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId).neq("sender_id", me()).is("read_at", null).then(() => {}, () => {});
}
