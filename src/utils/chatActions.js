import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";

export async function startChatWithSeller(product, user, profile) {
  if (!user || !profile) { alert("Login sebagai pembeli dulu untuk chat seller."); return null; }
  if (profile.role !== "buyer") { alert("Fitur chat seller hanya untuk pembeli."); return null; }
  if (!product?.sellerId) { alert("Data seller tidak ditemukan."); return null; }
  if (product.sellerId === user.uid) { alert("Ini produk toko kamu sendiri."); return null; }

  const chatId = [user.uid, product.sellerId].sort().join("_");
  await setDoc(doc(db, "chats", chatId), {
    buyerId: user.uid,
    sellerId: product.sellerId,
    participants: [user.uid, product.sellerId],
    buyerName: profile.name || "Buyer",
    sellerName: product.sellerName || "Seller",
    productId: product.id || null,
    productName: product.productName || "Produk",
    chatType: "buyer_seller",
    lastMessage: "Chat dimulai",
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return chatId;
}
