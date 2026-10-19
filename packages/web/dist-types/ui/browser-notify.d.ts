export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';
export declare function notifyPermission(): NotifyPermission;
export declare function requestNotifyPermission(): Promise<NotifyPermission>;
export declare function showBrowserNotification(text: string, onClick: () => void): void;
