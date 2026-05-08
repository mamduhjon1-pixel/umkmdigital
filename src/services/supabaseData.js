import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY di file .env");
}

export const supabase = createClient(supabaseUrl || "https://example.supabase.co", supabaseKey || "missing-key");
export const auth = supabase.auth;
export const db = { provider: "supabase" };

const COLLECTION_TABLES = {
  users: "users",
  products: "products",
  orders: "orders",
  reviews: "reviews",
  withdrawals: "withdrawals",
  seller_wallets: "seller_wallets",
  wallet_transactions: "wallet_transactions",
  komisi_tagihan: "komisi_tagihan",
  notifications: "notifications",
  chats: "chats",
  admin_settings: "admin_settings",
  admin_wallets: "admin_wallets",
  admin_commission_transactions: "admin_commission_transactions",
};

function nowIso() { return new Date().toISOString(); }
function randomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
function cleanValue(value) {
  if (value && value.__op === "serverTimestamp") return nowIso();
  if (value && value.__op === "increment") return value;
  if (Array.isArray(value)) return value.map(cleanValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanValue(v)]));
  }
  return value;
}
function normalizeData(data = {}) { return cleanValue(data || {}); }
function tableFromPath(path = []) {
  if (path.length >= 3 && path[0] === "chats" && path[2] === "messages") return "chat_messages";
  return COLLECTION_TABLES[path[0]] || path[0];
}
function parentPatch(path = []) {
  if (path.length >= 3 && path[0] === "chats" && path[2] === "messages") return { chatId: path[1] };
  return {};
}
function snapFromRow(row) {
  return {
    id: row?.id,
    exists: () => !!row,
    data: () => row ? { ...(row.data || {}), id: row.id } : undefined,
  };
}
function collectionSnap(rows = []) {
  const docs = rows.map(snapFromRow);
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (cb) => docs.forEach(cb) };
}

export function collection(_dbOrRef, ...segments) {
  const base = _dbOrRef?.path || [];
  return { type: "collection", path: [...base, ...segments].filter(Boolean) };
}
export function doc(_dbOrRef, ...segments) {
  const base = _dbOrRef?.path || [];
  const path = [...base, ...segments].filter(Boolean);
  if (path.length % 2 === 1) path.push(randomId());
  return { type: "doc", path, id: path[path.length - 1] };
}
export function query(ref, ...constraints) { return { ...ref, constraints: constraints.filter(Boolean) }; }
export function where(field, op, value) { return { kind: "where", field, op, value }; }
export function orderBy(field, direction = "asc") { return { kind: "orderBy", field, direction }; }
export function serverTimestamp() { return { __op: "serverTimestamp" }; }
export function increment(n) { return { __op: "increment", value: Number(n || 0) }; }

async function selectRows(ref) {
  const table = tableFromPath(ref.path);
  let q = supabase.from(table).select("id,data,created_at,updated_at");
  const p = parentPatch(ref.path);
  Object.entries(p).forEach(([k, v]) => { q = q.eq(`data->>${k}`, String(v)); });
  (ref.constraints || []).forEach((c) => {
    if (c.kind === "where") {
      const key = `data->>${c.field}`;
      if (c.op === "==") q = q.eq(key, String(c.value));
      else if (c.op === "!=") q = q.neq(key, String(c.value));
      else if (c.op === "in") q = q.in(key, (c.value || []).map(String));
      else if (c.op === ">") q = q.gt(key, String(c.value));
      else if (c.op === ">=") q = q.gte(key, String(c.value));
      else if (c.op === "<") q = q.lt(key, String(c.value));
      else if (c.op === "<=") q = q.lte(key, String(c.value));
    }
    if (c.kind === "orderBy") q = q.order(`data->>${c.field}`, { ascending: c.direction !== "desc" });
  });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getDocs(ref) { return collectionSnap(await selectRows(ref)); }
export async function getDoc(ref) {
  const table = tableFromPath(ref.path);
  const { data, error } = await supabase.from(table).select("id,data").eq("id", ref.id).maybeSingle();
  if (error) throw error;
  return snapFromRow(data);
}
async function readData(ref) { return (await getDoc(ref)).data() || {}; }
async function upsertRef(ref, payload, merge = true) {
  const table = tableFromPath(ref.path);
  const prev = merge ? await readData(ref).catch(() => ({})) : {};
  const patch = { ...normalizeData(payload), ...parentPatch(ref.path) };
  const next = { ...prev };
  Object.entries(patch).forEach(([k, v]) => {
    next[k] = v && v.__op === "increment" ? Number(next[k] || 0) + v.value : v;
  });
  const { error } = await supabase.from(table).upsert({ id: ref.id, data: next }, { onConflict: "id" });
  if (error) throw error;
  return ref;
}
export async function setDoc(ref, data, options = {}) { return upsertRef(ref, data, options.merge !== false); }
export async function updateDoc(ref, data) { return upsertRef(ref, data, true); }
export async function addDoc(colRef, data) { const ref = doc(colRef); await setDoc(ref, data, { merge: false }); return ref; }
export async function deleteDoc(ref) {
  const { error } = await supabase.from(tableFromPath(ref.path)).delete().eq("id", ref.id);
  if (error) throw error;
}
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data, options = {}) => ops.push(() => setDoc(ref, data, options)),
    update: (ref, data) => ops.push(() => updateDoc(ref, data)),
    delete: (ref) => ops.push(() => deleteDoc(ref)),
    commit: async () => { for (const op of ops) await op(); },
  };
}
export async function runTransaction(_db, callback) {
  const tx = {
    get: getDoc,
    set: (ref, data, options) => setDoc(ref, data, options),
    update: updateDoc,
    delete: deleteDoc,
  };
  return callback(tx);
}
export function onSnapshot(ref, cb, errCb) {
  let active = true;
  const emit = async () => {
    try {
      const snap = ref.type === "doc" ? await getDoc(ref) : await getDocs(ref);
      if (active) cb(snap);
    } catch (e) { if (errCb) errCb(e); else console.error(e); }
  };
  emit();
  const channel = supabase.channel(`rt_${ref.path.join("_")}_${randomId()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: tableFromPath(ref.path) }, emit)
    .subscribe();
  return () => { active = false; supabase.removeChannel(channel); };
}

export async function createUserWithEmailAndPassword(_auth, email, password, options = {}) {
  const signUpOptions = options?.data ? { data: options.data } : undefined;
  const { data, error } = await supabase.auth.signUp({ email, password, options: signUpOptions });
  if (error) throw error;
  return {
    user: { ...(data.user || {}), uid: data.user?.id },
    session: data.session || null,
    needsEmailConfirmation: !!data.user && !data.session,
  };
}
export async function signInWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { user: { ...(data.user || {}), uid: data.user?.id } };
}
export async function signOut() { const { error } = await supabase.auth.signOut(); if (error) throw error; }
export function onAuthStateChanged(_auth, cb) {
  supabase.auth.getUser().then(({ data }) => cb(data.user ? { ...data.user, uid: data.user.id } : null));
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ? { ...session.user, uid: session.user.id } : null));
  return () => sub?.subscription?.unsubscribe?.();
}
export function getPasswordResetRedirectUrl() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}?page=update-password`;
}

export async function sendPasswordResetEmail(_auth, email) {
  const redirectTo = getPasswordResetRedirectUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

