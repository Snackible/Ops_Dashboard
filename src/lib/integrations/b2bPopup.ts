import { eventBus } from "../events";
import { getCurrentUser } from "../auth/authStore";
import { notificationStore } from "./notificationStore";
import type { StockRequest } from "../types";

function notifyIfMine(request: StockRequest, kind: "success" | "danger", title: string, body: string): void {
  const user = getCurrentUser();
  if (user?.role !== "b2b" || user.accountId !== request.accountId) return;
  notificationStore.push({ kind, title, body });
}

/** Subscriber #2 on the event bus: tells the requesting B2B account the moment Ops decides. */
export function registerB2BPopup(): void {
  eventBus.on("RequestApproved", ({ request }) => {
    notifyIfMine(request, "success", "Order approved", "Your committed order has been confirmed by Ops.");
  });

  eventBus.on("RequestDeclined", ({ request }) => {
    notifyIfMine(
      request,
      "danger",
      "Order declined",
      request.decisionNote ? `Reason: ${request.decisionNote}` : "Reserved stock has been released back."
    );
  });
}
