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
    const partial = request.status === "approved_partial";
    notifyIfMine(
      request,
      "success",
      partial ? "Request partially approved" : "Request approved",
      partial
        ? "Some quantities were adjusted — check your Requests page for details."
        : "All items were approved as requested."
    );
  });

  eventBus.on("RequestDeclined", ({ request }) => {
    notifyIfMine(
      request,
      "danger",
      "Request declined",
      request.decisionNote ? `Reason: ${request.decisionNote}` : "See your Requests page for details."
    );
  });
}
