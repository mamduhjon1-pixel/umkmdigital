import { getToken } from "firebase/messaging";
import { collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db, firebaseConfig, getFirebaseMessaging } from "./firebase";
import { isKnownAdminEmail } from "../utils/appHelpers";

const NOTIFICATION_SOUND_PATH = "/mixkit-happy-bells-notification-937.wav";
const PUSH_SESSION_KEY = "umkm_push_notification_enabled";
const PUSH_TOKEN_KEY = "umkm_fcm_token";

let notificationAudio = null;
let notificationAudioUnlocked = false;
let lastNotificationSoundAt = 0;

function getNotificationAudio() {
  if (typeof window === "undefined") return null;
  if (!notificationAudio) {
    notificationAudio = new Audio(NOTIFICATION_SOUND_PATH);
    notificationAudio.preload = "auto";
    notificationAudio.volume = 0.75;
  }
  return notificationAudio;
}

export function unlockNotificationSound() {
  try {
    const audio = getNotificationAudio();
    if (!audio) return;
    audio.muted = true;
    audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        notificationAudioUnlocked = true;
      })
      .catch(() => {
        audio.muted = false;
        notificationAudioUnlocked = true;
      });
  } catch {
    notificationAudioUnlocked = true;
  }
}

export function setNotificationAudioUnlocked(value = true) {
  notificationAudioUnlocked = Boolean(value);
}

export function playOrderSound() {
  try {
    if (!notificationAudioUnlocked) return;
    const now = Date.now();
    if (now - lastNotificationSoundAt < 1500) return;
    lastNotificationSoundAt = now;
    const audio = getNotificationAudio();
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {
    // Browser can block autoplay before user interaction. Ignore safely.
  }
}

export function getNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function isPushSessionEnabled() {
  try {
    return localStorage.getItem(PUSH_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function lockNotificationSession() {
  try { localStorage.setItem(PUSH_SESSION_KEY, "1"); } catch {}
  notificationAudioUnlocked = true;
}

export function clearNotificationSession() {
  try {
    localStorage.removeItem(PUSH_SESSION_KEY);
    localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {}
  notificationAudioUnlocked = false;
}

export async function showLocalBrowserNotification(notif) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!isPushSessionEnabled()) return;
    if (document.visibilityState === "visible") return;

    const registration = await navigator.serviceWorker?.ready;
    if (!registration?.showNotification) return;

    await registration.showNotification(notif?.title || "Notifikasi Baru", {
      body: notif?.message || "Ada aktivitas baru di UMKM Digital.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: notif?.id || `umkm-${Date.now()}`,
      renotify: true,
      data: { page: notif?.type === "chat_message" ? "chat" : "notif", chatId: notif?.chatId || null },
    });
  } catch (error) {
    console.warn("Gagal menampilkan browser notification:", error);
  }
}

export async function registerPushNotification(user, profile) {
  if (!user?.uid) throw new Error("User belum login.");
  if (typeof window === "undefined" || !("Notification" in window)) throw new Error("Browser ini belum mendukung notifikasi web.");
  if (!navigator.serviceWorker) throw new Error("Service worker belum didukung di browser ini.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Izin notifikasi belum diberikan.");

  unlockNotificationSound();
  lockNotificationSession();

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;

  try {
    registration.active?.postMessage({ type: "UMKM_FIREBASE_CONFIG", firebaseConfig });
  } catch {}

  const messaging = await getFirebaseMessaging();
  if (!messaging) throw new Error("Firebase Messaging tidak didukung di browser ini.");

  const tokenOptions = { serviceWorkerRegistration: registration };
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (vapidKey) tokenOptions.vapidKey = vapidKey;

  const token = await getToken(messaging, tokenOptions);
  if (!token) throw new Error("Token notifikasi belum berhasil dibuat.");

  try { localStorage.setItem(PUSH_TOKEN_KEY, token); } catch {}

  await setDoc(doc(db, "users", user.uid), {
    notificationEnabled: true,
    notificationPermission: "granted",
    fcmToken: token,
    fcmTokenUpdatedAt: serverTimestamp(),
    notificationDevice: {
      userAgent: navigator.userAgent,
      platform: navigator.platform || "web",
      role: profile?.role || null,
    },
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return token;
}

export async function markDashboardNotificationsRead({ user, profile, role, types = [], extraFilter = null }) {
  if (!user?.uid) return;
  const isAdminViewer = role === "admin" || role === "sub_admin" || profile?.role === "admin" || profile?.role === "sub_admin" || isKnownAdminEmail(user?.email);
  const refs = [];
  try {
    const personalSnap = await getDocs(query(collection(db, "notifications"), where("userId", "==", user.uid)));
    refs.push(...personalSnap.docs);
  } catch {}
  if (isAdminViewer) {
    try {
      const adminSnap = await getDocs(query(collection(db, "notifications"), where("role", "==", "admin")));
      refs.push(...adminSnap.docs);
    } catch {}
  }
  refs.forEach((d) => {
    const n = d.data() || {};
    if (n.isRead === true || n.read === true) return;
    if (types.length && !types.includes(n.type)) return;
    if (extraFilter && !extraFilter(n)) return;
    updateDoc(doc(db, "notifications", d.id), { isRead: true, read: true, readAt: serverTimestamp() }).catch(() => {});
  });
}
