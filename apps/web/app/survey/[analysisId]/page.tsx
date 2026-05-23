"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { SurveyPanel } from "@/components/SurveyPanel";
import { PastSimulationsPanel } from "@/components/PastSimulationsPanel";
import { getAnalysis, type AnalysisDetail } from "@/lib/api";

type Props = {
  params: { analysisId: string };
};

export default function SurveyDetailPage({ params }: Props) {
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAnalysis(params.analysisId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [params.analysisId, refreshKey]);

  return (
    <div className="min-h-screen bg-vellum text-ink flex flex-col">
      <SiteHeader />

      <main className="flex-1 max-w-[1100px] w-full mx-auto p-4 lg:p-8">
        <nav className="text-caption text-dusty mb-4">
          <Link href="/survey" className="hover:text-ink underline">
            설문 목록
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-graphite">
            분석 {params.analysisId.slice(0, 8)}…
          </span>
        </nav>

        {loading && <DetailSkeleton />}

        {error && (
          <div
            role="alert"
            className="bg-terra/10 border border-terra/30 text-ink rounded-[9.6px] p-4"
          >
            <p className="text-body font-semibold mb-1">분석 조회 실패</p>
            <p className="text-caption text-graphite">{error}</p>
            <Link
              href="/survey"
              className="text-caption text-ink underline mt-2 inline-block"
            >
              ← 설문 목록으로
            </Link>
          </div>
        )}

        {!loading && !error && detail && (
          <div className="space-y-5">
            <AnalysisHeader detail={detail} />
            <SurveyPanel
              analysisId={detail.id}
              onSubmitted={() => setRefreshKey((k) => k + 1)}
            />
            {detail.simulations && detail.simulations.length > 0 && (
              <PastSimulationsPanel simulations={detail.simulations} />
            )}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function AnalysisHeader({ detail }: { detail: AnalysisDetail }) {
  const topPersona = detail.top_personas[0];
  const topProvince = detail.province_stats[0];

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-3.5">
        <h1 className="text-title text-ink">
          📋 {detail.selling_points.summary || "(요약 없음)"}
        </h1>
        <p className="text-caption text-dusty mt-1 num-tabular">
          분석 {detail.id.slice(0, 8)}… · {formatDate(detail.created_at)}
        </p>
      </header>
      <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="매칭 페르소나"
          value={`${detail.top_personas.length}명`}
        />
        <Stat
          label="최고 반응도"
          value={topPersona ? topPersona.score.toFixed(1) : "-"}
        />
        <Stat
          label="공략 1순위 지역"
          value={topProvince ? topProvince.name : "-"}
          sub={topProvince ? `${topProvince.count}명` : undefined}
        />
        <Stat
          label="저장된 시뮬레이션"
          value={`${detail.simulations?.length ?? 0}건`}
        />
      </div>
      {detail.selling_points.key_benefits.length > 0 && (
        <div className="border-t border-parchment px-5 py-3 bg-snow/50">
          <p className="text-overline text-dusty mb-1.5">핵심 혜택</p>
          <div className="flex flex-wrap gap-1.5">
            {detail.selling_points.key_benefits.map((b) => (
              <span
                key={b}
                className="text-caption px-2 py-0.5 rounded-[9.6px] border border-parchment bg-vellum text-graphite"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-overline text-dusty">{label}</p>
      <p className="text-heading font-semibold text-ink num-tabular mt-0.5">
        {value}
      </p>
      {sub && <p className="text-caption text-stone mt-0.5">{sub}</p>}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-32 bg-vellum border border-parchment rounded-[9.6px] animate-pulse" />
      <div className="h-64 bg-vellum border border-parchment rounded-[9.6px] animate-pulse" />
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
