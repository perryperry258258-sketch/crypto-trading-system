"use client";

import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-bear text-white text-xs text-center py-1.5 px-4">
      ⚠️ 目前離線，畫面上的資料可能不是最新的
    </div>
  );
}
