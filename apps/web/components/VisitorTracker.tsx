"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const VISITOR_ID_KEY = "personafit.visitor_id";
const SESSION_ID_KEY = "personafit.session_id";
const TRACKABLE_CLICK_SELECTOR =
  "button, a, [role='button'], [role='tab'], [data-track-action]";

type TrackEvent = {
  event_type: "page_view" | "click" | "submit" | "change";
  action?: string;
  target_tag?: string | null;
  target_role?: string | null;
  target_id?: string | null;
  target_name?: string | null;
  target_type?: string | null;
  target_label?: string | null;
  target_href?: string | null;
};

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

function currentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

function trackingIds() {
  try {
    return {
      visitorId: storedId(localStorage, VISITOR_ID_KEY, "visitor"),
      sessionId: storedId(sessionStorage, SESSION_ID_KEY, "session"),
    };
  } catch {
    return {
      visitorId: newId("visitor"),
      sessionId: newId("session"),
    };
  }
}

function cleanText(value: string | null | undefined, maxLength: number) {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function safeHref(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.hash}`;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function targetLabel(el: HTMLElement) {
  return cleanText(
    el.getAttribute("data-track-label") || el.getAttribute("aria-label"),
    200,
  );
}

function targetPayload(el: HTMLElement): Omit<TrackEvent, "event_type" | "action"> {
  const anchor = el instanceof HTMLAnchorElement ? el : el.closest("a");
  const input = el instanceof HTMLInputElement ? el : null;
  const button = el instanceof HTMLButtonElement ? el : null;
  return {
    target_tag: cleanText(el.tagName.toLowerCase(), 40),
    target_role:
      cleanText(el.getAttribute("role"), 80) ||
      (anchor ? "link" : button ? "button" : null),
    target_id: cleanText(el.id, 120),
    target_name: cleanText(
      "name" in el ? String((el as HTMLInputElement | HTMLSelectElement).name) : "",
      120,
    ),
    target_type: cleanText(input?.type || button?.type || null, 80),
    target_label: targetLabel(el),
    target_href: safeHref(anchor?.getAttribute("href")),
  };
}

function sendTrack(event: TrackEvent) {
  if (trackingBlocked()) return;

  const { visitorId, sessionId } = trackingIds();
  const payload = {
    visitor_id: visitorId,
    session_id: sessionId,
    path: currentPath(),
    page_title: document.title || null,
    referrer: safeReferrer(),
    language: navigator.language || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    screen_width: window.screen.width,
    screen_height: window.screen.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    ...event,
    action: event.action || event.event_type,
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
}

export function VisitorTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || trackingBlocked()) return;
    sendTrack({ event_type: "page_view", action: "page_view" });
  }, [pathname]);

  useEffect(() => {
    if (trackingBlocked()) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>(TRACKABLE_CLICK_SELECTOR);
      if (!el) return;
      sendTrack({
        event_type: "click",
        action: el.dataset.trackAction || "click",
        ...targetPayload(el),
      });
    };

    const handleSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      sendTrack({
        event_type: "submit",
        action: form.dataset.trackAction || "submit",
        ...targetPayload(form),
      });
    };

    const handleChange = (event: Event) => {
      const target = event.target;
      if (
        !(
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
        )
      ) {
        return;
      }
      if (target instanceof HTMLInputElement && ["hidden", "password"].includes(target.type)) {
        return;
      }
      sendTrack({
        event_type: "change",
        action: target.dataset.trackAction || "change",
        ...targetPayload(target),
      });
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("change", handleChange, true);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("change", handleChange, true);
    };
  }, []);

  return null;
}
