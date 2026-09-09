export type ToastKind = "info" | "success" | "danger";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body: string;
}

type Listener = (toasts: Toast[]) => void;

class NotificationStore {
  private toasts: Toast[] = [];
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.toasts);
    return () => this.listeners.delete(listener);
  }

  push(toast: Omit<Toast, "id">): void {
    const withId: Toast = { ...toast, id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
    this.toasts = [...this.toasts, withId];
    this.emit();
    setTimeout(() => this.dismiss(withId.id), 6000);
  }

  dismiss(id: string): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.toasts);
  }
}

export const notificationStore = new NotificationStore();
