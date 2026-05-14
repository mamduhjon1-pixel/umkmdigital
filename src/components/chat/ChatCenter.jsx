import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";
import { getMillis } from "../../utils/orderUtils";
import { normalizeRole } from "../../utils/appHelpers";
import { getAdminSellerChatId, getChatParticipantsKey } from "../../utils/businessUtils";
import { playOrderSound } from "../../services/pushNotifications";

export default function ChatCenter({ user, profile, createNotif, mode = "buyer", users = [] }) {
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [admins, setAdmins] = useState([]);
  const firstMsgLoadRef = useRef(true);
  const isAdminChatMode = mode === "admin";
  const isSellerChatMode = mode === "seller";
  const isAdminRole = profile?.role === "admin" || profile?.role === "sub_admin";

  function isAdminSellerChat(chat) {
    if (!chat) return false;
    const id = String(chat.id || "");
    const type = String(chat.chatType || chat.type || "");
    return type === "admin_seller"
      || type === "seller_admin"
      || id.startsWith("admin_seller_")
      || (Boolean(chat.adminId) && Boolean(chat.sellerId))
      || (Boolean(chat.sellerId) && !chat.buyerId && !chat.productId);
  }

  function normalizeAdminSellerChat(chat) {
    if (!isAdminSellerChat(chat)) return chat;
    const sellerId = chat.sellerId || (Array.isArray(chat.participants) ? chat.participants.find((id) => id !== chat.adminId && id !== user?.uid) : null);
    const adminId = chat.adminId || user?.uid || null;
    const seller = users.find((u) => (u.uid || u.id) === sellerId);
    return {
      ...chat,
      chatType: "admin_seller",
      type: "seller_admin",
      adminId,
      sellerId,
      participants: Array.isArray(chat.participants) && chat.participants.length
        ? chat.participants
        : [adminId, sellerId].filter(Boolean),
      participantsKey: chat.participantsKey || getChatParticipantsKey([adminId, sellerId].filter(Boolean)),
      adminName: "Admin",
      sellerName: chat.sellerName || seller?.name || seller?.email || "Seller",
      productName: chat.productName || "Chat dengan Admin",
    };
  }

  useEffect(() => {
    if (!isSellerChatMode) return;
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, uid: d.data().uid || d.id, ...d.data() }))
        .filter((u) => {
          const role = normalizeRole(u.role || u.peran, u.email);
          return ["admin", "sub_admin"].includes(role) && u.status !== "deleted" && !u.isDeleted;
        });
      setAdmins(data);
    }, (error) => {
      console.error("Gagal memuat admin untuk chat:", error);
      setAdmins([]);
    });
    return () => unsub();
  }, [isSellerChatMode]);

  function getOtherName(chat) {
    if (isAdminSellerChat(chat)) {
      if (profile?.role === "admin" || profile?.role === "sub_admin") return chat.sellerName || "Seller";
      return chat.adminName || "Admin";
    }
    return user.uid === chat.sellerId ? (chat.buyerName || "Buyer") : (chat.sellerName || "Seller");
  }

  function getChatSubtitle(chat) {
    if (isAdminSellerChat(chat)) return "Chat Seller ↔ Admin";
    return chat?.productName || "Chat produk";
  }

  function canShowChat(chat) {
    if (isAdminChatMode) return isAdminSellerChat(chat);
    if (isSellerChatMode) {
      if (isAdminSellerChat(chat)) return chat.sellerId === user.uid || chat.participants?.includes(user.uid);
      return Array.isArray(chat.participants) && chat.participants.includes(user.uid);
    }
    if (!Array.isArray(chat.participants) || !chat.participants.includes(user.uid)) return false;
    return !isAdminSellerChat(chat);
  }

  async function startAdminSellerChat(targetSeller) {
    if (!user?.uid) return;
    const sellerId = targetSeller?.uid || targetSeller?.id;
    if (!sellerId) return alert("ID seller tidak ditemukan.");
    setStartingChat(true);
    try {
      const chatId = getAdminSellerChatId(user.uid, sellerId);
      const payload = {
        chatType: "admin_seller",
        type: "seller_admin",
        adminId: user.uid,
        sellerId,
        participants: [user.uid, sellerId],
        participantsKey: getChatParticipantsKey([user.uid, sellerId]),
        adminName: "Admin",
        sellerName: targetSeller?.name || targetSeller?.email || "Seller",
        productId: null,
        productName: "Chat dengan Admin",
        lastMessage: "Chat admin dimulai",
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "chats", chatId), payload, { merge: true });
      const nextChat = { id: chatId, ...payload };
      setActiveChat(nextChat);
      // Step 8: membuka chat tidak lagi membuat notifikasi agar bell tidak terasa spam.
    } catch (error) {
      console.error("Gagal membuat chat admin-seller:", error);
      alert("Gagal membuka chat. Coba lagi.");
    } finally {
      setStartingChat(false);
    }
  }

  async function startChatWithAdmin() {
    if (!user?.uid || !profile) return;
    const admin = admins.find((a) => (a.uid || a.id) && a.status !== "deleted") || admins[0];
    const adminId = admin?.uid || admin?.id;
    if (!adminId) return alert("Admin belum ditemukan untuk chat. Pastikan akun admin ada di koleksi users dengan role admin/sub_admin atau email admin utama.");
    setStartingChat(true);
    try {
      const chatId = getAdminSellerChatId(adminId, user.uid);
      const payload = {
        chatType: "admin_seller",
        type: "seller_admin",
        adminId,
        sellerId: user.uid,
        participants: [adminId, user.uid],
        participantsKey: getChatParticipantsKey([adminId, user.uid]),
        adminName: "Admin",
        sellerName: profile?.name || profile?.email || "Seller",
        productId: null,
        productName: "Chat dengan Admin",
        lastMessage: "Chat admin dimulai",
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "chats", chatId), payload, { merge: true });
      const nextChat = { id: chatId, ...payload };
      setActiveChat(nextChat);
      // Step 8: membuka chat tidak lagi membuat notifikasi; notifikasi hanya dikirim saat ada pesan baru.
    } catch (error) {
      console.error("Gagal membuat chat seller-admin:", error);
      alert("Gagal membuka chat admin. Coba lagi.");
    } finally {
      setStartingChat(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "chats"), (snap) => {
      const data = snap.docs
        .map((d) => normalizeAdminSellerChat({ id: d.id, ...d.data() }))
        .filter(canShowChat)
        .sort((a, b) => getMillis(b.updatedAt || b.lastMessageAt) - getMillis(a.updatedAt || a.lastMessageAt));
      setChats(data);
      setActiveChat((prev) => {
        let pendingChatId = null;
        try { pendingChatId = sessionStorage.getItem("umkm_open_chat_id"); } catch (error) { pendingChatId = null; }
        if (pendingChatId) {
          const pendingChat = data.find((c) => c.id === pendingChatId);
          if (pendingChat) {
            try { sessionStorage.removeItem("umkm_open_chat_id"); } catch (error) { console.warn("Tidak bisa menghapus chat tujuan", error); }
            return pendingChat;
          }
        }
        if (prev?.id && data.some((c) => c.id === prev.id)) return data.find((c) => c.id === prev.id);
        return data[0] || null;
      });
    }, (error) => {
      console.error("Chats realtime error:", error);
      setChats([]);
    });
    return () => unsub();
  }, [user?.uid, mode, profile?.role]);

  useEffect(() => {
    try { window.umkmActiveChatId = activeChat?.id || null; } catch (error) {}
    if (!activeChat?.id) { setMessages([]); return; }
    firstMsgLoadRef.current = true;
    const unsub = onSnapshot(collection(db, "chats", activeChat.id, "messages"), (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt));
      if (!firstMsgLoadRef.current && data.some((m) => m.senderId !== user.uid && !messages.find((old) => old.id === m.id))) {
        playOrderSound();
      }
      firstMsgLoadRef.current = false;
      setMessages(data);
    }, (error) => {
      console.error("Chat messages realtime error:", error);
      setMessages([]);
    });
    return () => unsub();
  }, [activeChat?.id, user?.uid]);

  useEffect(() => {
    if (!activeChat?.id || !user?.uid) return;
    const markChatNotifRead = (snap) => {
      snap.docs.forEach((d) => {
        const n = d.data();
        if (!n.isRead && n.chatId === activeChat.id) updateDoc(doc(db, "notifications", d.id), { isRead: true, read: true });
      });
    };
    getDocs(query(collection(db, "notifications"), where("userId", "==", user.uid), where("type", "==", "chat_message"))).then(markChatNotifRead).catch(() => {});
    if (isAdminRole) {
      getDocs(query(collection(db, "notifications"), where("role", "==", "admin"), where("type", "==", "chat_message"))).then(markChatNotifRead).catch(() => {});
    }
  }, [activeChat?.id, user?.uid, isAdminRole]);

  async function sendMessage(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || !activeChat?.id || busy) return;
    setBusy(true);
    try {
      const normalizedActiveChat = normalizeAdminSellerChat(activeChat);
      const receiverId = isAdminSellerChat(normalizedActiveChat)
        ? (isAdminRole
          ? normalizedActiveChat.sellerId
          : (normalizedActiveChat.adminId || normalizedActiveChat.participants?.find((id) => id !== user.uid)))
        : normalizedActiveChat.participants?.find((id) => id !== user.uid);
      await addDoc(collection(db, "chats", activeChat.id, "messages"), {
        chatId: activeChat.id,
        senderId: user.uid,
        senderName: profile?.name || "User",
        receiverId: receiverId || null,
        text: value,
        isRead: false,
        unreadFor: receiverId || null,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, "chats", activeChat.id), {
        lastMessage: value,
        lastSenderId: user.uid,
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      // Pesan chat sengaja TIDAK membuat dokumen notifications.
      // Semua pesan harus tetap berada di fitur Chat, bukan masuk ke ikon/halaman Notifikasi.
      setText("");
    } catch (err) {
      alert("Gagal mengirim pesan. Coba lagi.");
    }
    setBusy(false);
  }


  async function deleteMessage(message) {
    if (!activeChat?.id || !message?.id) return;
    if (!confirm("Hapus pesan ini?")) return;
    try {
      await deleteDoc(doc(db, "chats", activeChat.id, "messages", message.id));
    } catch (error) {
      console.error("Gagal hapus pesan:", error);
      alert("Gagal menghapus pesan. Coba lagi.");
    }
  }

  async function deleteActiveChat() {
    if (!activeChat?.id) return;
    if (!confirm("Hapus seluruh percakapan ini? Semua pesan di chat ini akan dihapus.")) return;
    try {
      const msgSnap = await getDocs(collection(db, "chats", activeChat.id, "messages"));
      const batch = writeBatch(db);
      msgSnap.docs.forEach((d) => batch.delete(doc(db, "chats", activeChat.id, "messages", d.id)));
      batch.delete(doc(db, "chats", activeChat.id));
      await batch.commit();
      setActiveChat(null);
      setMessages([]);
    } catch (error) {
      console.error("Gagal hapus percakapan:", error);
      alert("Gagal menghapus percakapan. Coba lagi.");
    }
  }

  const sellers = users
    .filter((u) => u.role === "seller" && !u.isDeleted && u.status !== "deleted")
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));

  return (
    <div className="page-container chat-page" style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>💬 Live Chat</div>
        {isSellerChatMode && <button className="btn-primary btn-sm" onClick={startChatWithAdmin} disabled={startingChat}>{startingChat ? "Membuka..." : "Chat Admin"}</button>}
      </div>
      {isAdminChatMode && sellers.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Mulai chat dengan seller</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sellers.map((s) => (
              <button key={s.uid || s.id} className="btn-ghost btn-sm" onClick={() => startAdminSellerChat(s)} disabled={startingChat}>
                {s.name || s.email || "Seller"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", gap: 14 }} className="chat-layout-wrap">
        <div className="card chat-list-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: 14, fontWeight: 800, borderBottom: "1px solid var(--border)" }}>Daftar Chat</div>
          {chats.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-icon">💬</div>
              <p>Belum ada chat.</p>
            </div>
          ) : chats.map((c) => {
            const otherName = getOtherName(c);
            return (
              <button key={c.id} onClick={() => setActiveChat(c)}
                style={{ width: "100%", textAlign: "left", padding: 14, border: "none", borderBottom: "1px solid var(--border)", background: activeChat?.id === c.id ? "var(--orange-light)" : "#fff", cursor: "pointer" }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{otherName}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>{getChatSubtitle(c)}</div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.lastMessage || "-"}</div>
              </button>
            );
          })}
        </div>
        <div className="card chat-room-card" style={{ minHeight: 460, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {activeChat ? (
            <>
              <div style={{ padding: 14, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>
                  {getOtherName(activeChat)}
                  <div style={{ fontWeight: 400, fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{getChatSubtitle(activeChat)}</div>
                </div>
                <button type="button" className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#FCA5A5" }} onClick={deleteActiveChat}>Hapus Percakapan</button>
              </div>
              <div className="chat-message-area" style={{ flex: 1, padding: 14, background: "#F8FAFC", overflowY: "auto" }}>
                {messages.length === 0 ? <p style={{ color: "var(--text3)", fontSize: 13 }}>Mulai percakapan...</p> : messages.map((m) => {
                  const mine = m.senderId === user.uid;
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 10 }}>
                      <div style={{ maxWidth: "78%", padding: "9px 12px", borderRadius: 14, background: mine ? "var(--orange)" : "#fff", color: mine ? "#fff" : "var(--text)", boxShadow: "0 2px 8px rgba(0,0,0,.05)", fontSize: 14, lineHeight: 1.45 }}>
                        <div>{m.text}</div>
                        <button type="button" onClick={() => deleteMessage(m)} style={{ marginTop: 6, padding: 0, border: "none", background: "transparent", color: mine ? "rgba(255,255,255,.85)" : "#EF4444", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>Hapus</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <form className="chat-input-row" onSubmit={sendMessage} style={{ padding: 12, display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
                <input className="form-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis pesan..." style={{ flex: 1 }} />
                <button className="btn-primary" disabled={busy || !text.trim()}>{busy ? "..." : "Kirim"}</button>
              </form>
            </>
          ) : (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="empty-icon">💬</div>
              <p>Pilih chat untuk mulai percakapan.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
