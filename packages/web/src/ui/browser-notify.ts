// Browser (system) notifications for alerts, used only while the tab is hidden and only if the user opted in.
export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function notifyPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return notifyPermission();
  }
}

export function showBrowserNotification(text: string, onClick: () => void): void {
  if (notifyPermission() !== 'granted' || !document.hidden) return;
  try {
    const notification = new Notification('AI Office', { body: text, tag: 'ai-office-alert', icon: '/favicon.svg' });
    notification.addEventListener('click', () => {
      window.focus();
      onClick();
      notification.close();
    });
  } catch {
    // Some browsers only allow notifications from a service worker; ignore silently.
  }
}
