"use client";

import { useSyncExternalStore } from "react";

import { OfflineNotice } from "@/components/ui/states";

export function OnlineStatus() {
  const online = useSyncExternalStore(
    (update) => {
      window.addEventListener("online", update);
      window.addEventListener("offline", update);
      return () => {
        window.removeEventListener("online", update);
        window.removeEventListener("offline", update);
      };
    },
    () => navigator.onLine,
    () => true,
  );

  return online ? null : <OfflineNotice />;
}
