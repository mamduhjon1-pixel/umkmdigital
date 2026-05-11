import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { isKnownAdminEmail } from "../utils/appHelpers";
import { getMillis, sortNewest, sortOrdersByStage } from "../utils/orderUtils";

export default function useRealtimeData({ user, profile, onNewOrder, onNewNotification }) {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [paymentSetting, setPaymentSetting] = useState(null);
  const [manualBalance, setManualBalance] = useState(null);
  const [commissionSetting, setCommissionSetting] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [commissionBills, setCommissionBills] = useState([]);
  const [adminCommissionWallet, setAdminCommissionWallet] = useState(null);
  const [adminCommissionTransactions, setAdminCommissionTransactions] = useState([]);
  const [allUsers, setAllUsers] = useState([]);

  const seenOrderIdsRef = useRef(new Set());
  const orderSoundReadyRef = useRef(false);
  const seenNotificationIdsRef = useRef(new Set());
  const notificationSoundReadyRef = useRef(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "products"), (snap) => {
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Products realtime error:", error);
      setProducts([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "orders"), (snap) => {
      setOrders(sortOrdersByStage(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Orders realtime error:", error);
      setOrders([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "reviews"), (snap) => {
      setReviews(sortNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Reviews realtime error:", error);
      setReviews([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "withdrawals"), (snap) => {
      setWithdrawals(sortNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Withdrawals realtime error:", error);
      setWithdrawals([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "seller_wallets"), (snap) => {
      setWallets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Wallets realtime error:", error);
      setWallets([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "komisi_tagihan"), (snap) => {
      setCommissionBills(sortNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Commission bills realtime error:", error);
      setCommissionBills([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_wallets", "commission"), (snap) => {
      setAdminCommissionWallet(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, (error) => {
      console.error("Admin commission wallet realtime error:", error);
      setAdminCommissionWallet(null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "admin_commission_transactions"), (snap) => {
      setAdminCommissionTransactions(sortNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Admin commission transactions realtime error:", error);
      setAdminCommissionTransactions([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setAllUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Users realtime error:", error);
      setAllUsers([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_settings", "payment"), (snap) => {
      setPaymentSetting(snap.exists() ? snap.data() : null);
    }, (error) => {
      console.error("Payment settings realtime error:", error);
      setPaymentSetting(null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_settings", "manualBalance"), (snap) => {
      setManualBalance(snap.exists() ? snap.data() : null);
    }, (error) => {
      console.error("Manual balance realtime error:", error);
      setManualBalance(null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_settings", "commission"), (snap) => {
      setCommissionSetting(snap.exists() ? snap.data() : { globalCommissionPercent: 10 });
    }, (error) => {
      console.error("Commission settings realtime error:", error);
      setCommissionSetting({ globalCommissionPercent: 10 });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!profile || !user) return;
    const isAdminNotifViewer = profile.role === "admin" || profile.role === "sub_admin" || isKnownAdminEmail(user?.email);
    const qNotif = isAdminNotifViewer
      ? collection(db, "notifications")
      : query(collection(db, "notifications"), where("userId", "==", user.uid));

    const unsub = onSnapshot(qNotif, (snap) => {
      const rawData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const data = sortNewest(isAdminNotifViewer
        ? rawData
        : rawData.filter((n) => n.userId === user.uid || n.role === profile.role)
      );
      const notificationKey = (n) => `${n.id}_${getMillis(n.updatedAt || n.lastTriggeredAt || n.createdAt)}`;
      const currentIds = new Set(data.map(notificationKey));
      if (!notificationSoundReadyRef.current) {
        seenNotificationIdsRef.current = currentIds;
        notificationSoundReadyRef.current = true;
      } else {
        const newNotifications = data.filter((n) => !seenNotificationIdsRef.current.has(notificationKey(n)));
        if (newNotifications.length > 0) {
          onNewNotification?.(newNotifications);
        }
        seenNotificationIdsRef.current = currentIds;
      }
      setNotifications(data);
    }, (error) => {
      console.error("Notifications realtime error:", error);
      setNotifications([]);
    });
    return () => unsub();
  }, [profile, user, onNewNotification]);

  useEffect(() => {
    if (!profile || !user) return;
    const relevantOrders =
      profile.role === "admin" || profile.role === "sub_admin"
        ? orders
        : profile.role === "seller"
          ? orders.filter((order) => order.sellerId === user.uid)
          : [];

    const currentIds = new Set(relevantOrders.map((order) => order.id));
    if (!orderSoundReadyRef.current) {
      seenOrderIdsRef.current = currentIds;
      orderSoundReadyRef.current = true;
      return;
    }

    const hasNewOrder = relevantOrders.some((order) => !seenOrderIdsRef.current.has(order.id));
    if (hasNewOrder) onNewOrder?.();
    seenOrderIdsRef.current = currentIds;
  }, [orders, profile, user, onNewOrder]);

  return {
    products,
    orders,
    reviews,
    notifications,
    withdrawals,
    paymentSetting,
    manualBalance,
    commissionSetting,
    wallets,
    commissionBills,
    adminCommissionWallet,
    adminCommissionTransactions,
    allUsers,
  };
}
