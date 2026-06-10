"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const VISITOR_ID_KEY = "personafit.visitor_id";
const SESSION_ID_KEY = "personafit.session_id";

function newId(prefix: string) {
  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${value}`;
}

function storedId(storage: Storage, key: string, prefix: string) {
  const current = storage.getItem(key);
  if (current) return current;
  const next = newId(prefix);
  storage.setItem(key, next);
  return next;
}

function safeReferrer() {
  if (!document.referrer) return null;
  try {
    const url = new URL(document.referrer);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function trackingBlocked() {
  const win = window as Window & { doNotTrack?: string };
  return navigator.doNotTrack === "1" || win.doNotTrack === "1";
}

export function VisitorTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || trackingBlocked()) return;

    let visitorId: string;
    let sessionId: string;
    try {
      visitorId = storedId(localStorage, VISITOR_ID_KEY, "visitor");
      sessionId = storedId(sessionStorage, SESSION_ID_KEY, "session");
    } catch {
      visitorId = newId("visitor");
      sessionId = newId("session");
    }

    const payload = {
      visitor_id: visitorId,
      session_id: sessionId,
      path: pathname,
      page_title: document.title || null,
      referrer: safeReferrer(),
      language: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
    };
    const body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      // sendBeacon은 큐가 가득 차면 false를 반환하므로, 실패 시 fetch로 폴백한다.
      if (navigator.sendBeacon("/api/visitors/track", blob)) return;
    }

    void fetch("/api/visitors/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}
