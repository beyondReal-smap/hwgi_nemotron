"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { listAnalyses, type AnalysisSummary } from "@/lib/api";

export default function SurveyIndexPage() {
  const [items, setItems] = useState<AnalysisSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAnalyses(50, 0)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <SiteHeader />

      <main className="flex-1 max-w-[1100px] w-full mx-auto p-4 lg:p-8">
        <header className="mb-6">
          <h1 className="text-title text-ink">📋 설문 시뮬레이션</h1>
          <p className="text-caption text-dusty mt-1">
            기존 분석의 페르소나에게 주관식 문항을 던지고, 본인 입장의 응답을
            시뮬레이션합니다. 이력에서 분석을 선택하세요.
          </p>
        </header>

        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" aria-busy="true">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-32 bg-vellum border border-parchment rounded-[9.6px] animate-pulse"
              />
            ))}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="bg-terra/10 border border-terra/30 rounded-[9.6px] p-4"
          >
            <p className="text-body font-semibold text-ink mb-1">
              이력 조회 실패
            </p>
            <p className="text-caption text-graphite">{error}</p>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <EmptyState />
        )}

        {!loading && !error && items.length > 0 && (
          <>
            <p className="text-caption text-dusty mb-3 num-tabular">
              총 {total.toLocaleString()}건 · 최신순
            </p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((item) => (
                <li key={item.id}>
                  <AnalysisCard item={item} />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function AnalysisCard({ item }: { item: AnalysisSummary }) {
  return (
    <Link
      href={`/survey/${item.id}`}
      className="block h-full border border-parchment rounded-[9.6px] bg-vellum p-4 hover:bg-snow hover:border-terra/40 transition-colors
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-body font-semibold text-ink line-clamp-2 flex-1">
          {item.summary || "(요약 없음)"}
        </p>
        {item.simulation_count > 0 && (
          <span className="text-caption font-medium text-ink bg-azure/40 px-2 py-0.5 rounded-[9.6px] shrink-0 num-tabular">
            📋 {item.simulation_count}건
          </span>
        )}
      </div>

      {item.key_benefits.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {item.key_benefits.slice(0, 3).map((b) => (
            <span
              key={b}
              className="text-caption px-2 py-0.5 rounded-[9.6px] border border-parchment text-graphite"
            >
              {b}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-dusty num-tabular">
        <span>{formatDate(item.created_at)}</span>
        <span aria-hidden>·</span>
        <span>{item.top_persona_count}명 매칭</span>
        {item.top_province && (
          <>
            <span aria-hidden>·</span>
            <span>{item.top_province}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>최고 {item.max_score.toFixed(1)}</span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-parchment rounded-[9.6px] p-12 text-center bg-vellum">
      <div className="mx-auto mb-4 h-10 w-10 rounded-full border border-terra/30 bg-terra/10" />
      <p className="text-body font-semibold text-ink mb-2">
        설문 시뮬레이션 대상 분석이 없습니다.
      </p>
      <p className="text-caption text-dusty mb-4">
        먼저 상품을 분석하면, 매칭된 페르소나에게 주관식 문항을 던질 수 있습니다.
      </p>
      <Link
        href="/"
        className="inline-block px-4 py-2 rounded-[9.6px] bg-ink text-vellum text-body-sm font-medium hover:bg-graphite transition-colors"
      >
        분석 시작하기 →
      </Link>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
