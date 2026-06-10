"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type VisitRecord = {
  event_id: string;
  created_at: string;
  visitor_id: string | null;
  session_id: string | null;
  path: string | null;
  page_title: string | null;
  referrer: string | null;
  language: string | null;
  timezone: string | null;
  screen_width: number | null;
  screen_height: number | null;
  viewport_width: number | null;
  viewport_height: number | null;
  user_agent: string | null;
  accept_language: string | null;
  /** IP 원문 (2026-06-10 이후 수집). 옛 레코드에는 없어 해시로 폴백 표시. */
  ip?: string | null;
  ip_hash: string | null;
};

type VisitResponse = {
  items: VisitRecord[];
  count: number;
};

const LIMITS = [50, 100, 200, 500, 1000];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function shortId(value: string | null) {
  if (!value) return "-";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function browserLabel(userAgent: string | null) {
  if (!userAgent) return "-";
  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("Chrome/")) return "Chrome";
  if (userAgent.includes("Safari/")) return "Safari";
  if (userAgent.includes("Firefox/")) return "Firefox";
  return userAgent.slice(0, 42);
}

function compactSize(width: number | null, height: number | null) {
  if (!width || !height) return "-";
  return `${width}x${height}`;
}

function pathCounts(items: VisitRecord[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.path || "(unknown)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

export default function VisitorLogsPage() {
  const [limit, setLimit] = useState(200);
  const [data, setData] = useState<VisitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/admind/visitors/data?limit=${limit}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.detail || `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const items = data?.items ?? [];
    const visitors = new Set(items.map((v) => v.visitor_id).filter(Boolean));
    const sessions = new Set(items.map((v) => v.session_id).filter(Boolean));
    const paths = pathCounts(items);
    return { visitors: visitors.size, sessions: sessions.size, paths };
  }, [data]);

  return (
    <main className="min-h-screen bg-vellum text-ink px-4 py-6 lg:px-10 lg:py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <p className="text-overline text-dusty">관리자</p>
            <h1 className="text-display text-ink tracking-tight">방문 로그</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-10 rounded-[9.6px] border border-parchment bg-snow px-3 text-body-sm text-ink outline-none focus:ring-2 focus:ring-azure"
              aria-label="조회 건수"
            >
              {LIMITS.map((n) => (
                <option key={n} value={n}>
                  최근 {n}건
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="h-10 rounded-[9.6px] bg-ink px-4 text-body-sm font-medium text-snow transition-colors hover:bg-onyx disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "갱신 중" : "갱신"}
            </button>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-[9.6px] border border-terra/30 bg-terra/10 px-3 py-2 text-caption text-ink"
          >
            {error}
          </p>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[9.6px] border border-parchment bg-snow p-4">
            <p className="text-caption text-dusty">조회 이벤트</p>
            <p className="mt-1 text-display text-ink">{data?.count ?? 0}</p>
          </div>
          <div className="rounded-[9.6px] border border-parchment bg-snow p-4">
            <p className="text-caption text-dusty">가명 방문자</p>
            <p className="mt-1 text-display text-ink">{stats.visitors}</p>
          </div>
          <div className="rounded-[9.6px] border border-parchment bg-snow p-4">
            <p className="text-caption text-dusty">세션</p>
            <p className="mt-1 text-display text-ink">{stats.sessions}</p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-[9.6px] border border-parchment bg-snow">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-left">
                <thead className="border-b border-parchment bg-vellum/70">
                  <tr className="text-caption text-dusty">
                    <th className="px-3 py-3 font-medium">시각</th>
                    <th className="px-3 py-3 font-medium">경로</th>
                    <th className="px-3 py-3 font-medium">방문자</th>
                    <th className="px-3 py-3 font-medium">세션</th>
                    <th className="px-3 py-3 font-medium">IP</th>
                    <th className="px-3 py-3 font-medium">환경</th>
                    <th className="px-3 py-3 font-medium">유입</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-parchment">
                  {(data?.items ?? []).map((item) => (
                    <tr key={item.event_id} className="align-top text-body-sm text-graphite">
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-caption text-ink">
                        {formatDate(item.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-ink">{item.path || "-"}</p>
                        {item.page_title && (
                          <p className="mt-1 max-w-[280px] truncate text-caption text-dusty">
                            {item.page_title}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-caption">
                        {shortId(item.visitor_id)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-caption">
                        {shortId(item.session_id)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-caption">
                        {item.ip ? (
                          <span className="text-ink">{item.ip}</span>
                        ) : (
                          // 변경 이전 레코드 — 원문 미보존이라 해시 축약으로 폴백
                          shortId(item.ip_hash)
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p>{browserLabel(item.user_agent)}</p>
                        <p className="mt-1 text-caption text-dusty">
                          {item.language || "-"} · {item.timezone || "-"} ·{" "}
                          {compactSize(item.viewport_width, item.viewport_height)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="max-w-[260px] truncate text-caption text-dusty">
                          {item.referrer || "-"}
                        </p>
                      </td>
                    </tr>
                  ))}
                  {!loading && (data?.items.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-body-sm text-dusty">
                        표시할 방문 로그가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-[9.6px] border border-parchment bg-snow p-4">
            <h2 className="text-heading text-ink">상위 경로</h2>
            <div className="mt-4 flex flex-col gap-3">
              {stats.paths.map(([path, count]) => (
                <div key={path} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-body-sm text-graphite">{path}</span>
                  <span className="shrink-0 rounded-full bg-vellum px-2 py-0.5 font-mono text-caption text-ink">
                    {count}
                  </span>
                </div>
              ))}
              {stats.paths.length === 0 && (
                <p className="text-body-sm text-dusty">집계할 경로가 없습니다.</p>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
