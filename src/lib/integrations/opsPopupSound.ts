import { eventBus } from "../events";
import { getCurrentUser } from "../auth/authStore";
import { notificationStore } from "./notificationStore";
import { playNewRequestChime } from "./soundAlert";
import { dataClient } from "../data";

/** Subscriber #1 on the event bus: alerts whoever is on the Ops dashboard when a new request lands. */
export function registerOpsPopupSound(): void {
  eventBus.on("RequestSubmitted", async ({ request }) => {
    if (getCurrentUser()?.role !== "ops") return;
    const account = await dataClient.getAccount(request.accountId);
    const itemCount = request.lineItems.length;
    notificationStore.push({
      kind: "info",
      title: "New request",
      body: `${account?.companyName ?? "A B2B account"} requested ${itemCount} item${itemCount === 1 ? "" : "s"}.`,
    });
    playNewRequestChime();
  });
}
