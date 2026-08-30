// 瀏覽器原生 Notification API。免費、不需要任何後端或第三方服務。
// 限制：只有在網站分頁還開著（可在背景）時才會運作，完全關閉分頁後不會收到。

export type NotificationPermissionStatus = "default" | "granted" | "denied" | "unsupported";

export function getNotificationPermission(): NotificationPermissionStatus {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotificationPermissionStatus;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  const result = await Notification.requestPermission();
  return result as NotificationPermissionStatus;
}

export function showNotification(title: string, body: string, tag?: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag, icon: undefined });
  } catch {
    // 部分瀏覽器（尤其手機版）可能限制直接建立 Notification，安靜失敗即可，不影響其他功能
  }
}
