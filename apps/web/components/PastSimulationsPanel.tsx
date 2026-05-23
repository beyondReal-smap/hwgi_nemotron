"use client";

import Link from "next/link";
import { useState } from "react";
import { ResponseCard } from "@/components/SurveyPanel";
import type { StoredSimulation } from "@/lib/api";

/** 분석 결과/이력 화면에서 /survey/[id]로 유도하는 CTA. */
export function SurveyCta({ analysisId }: { analysisId: string }) {
  return (
    <Link
      href={`/survey/${analysisId}`}
      className="group block border border-parchment rounded-[9.6px] bg-vellum hover:bg-snow hover:border-azure transition-colors
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
    >
      <div className="border-l-4 border-l-azure px-4 py-3 sm:px-5 sm:py-4 flex items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <p className="text-title text-ink">
            📋 이 페르소나들에게 설문하기
          </p>
          <p className="text-body-sm text-dusty mt-1">
            매칭된 페르소나가 본인 입장으로 주관식 문항에 어떻게 응답할지
            시뮬레이션합니다
          </p>
        </div>
        <span className="text-title text-graphite group-hover:text-ink group-hover:translate-x-0.5 transition-all shrink-0">
          →
        </span>
      </div>
    </Link>
  );
}

type Props = {
  simulations: StoredSimulation[];
  title?: string;
  description?: string;
};

export function PastSimulationsPanel({
  simulations,
  title = "📋 과거 설문 시뮬레이션",
  description = "이 분석에 대해 실행한 설문 시뮬레이션 이력 (최신순)",
}: Props) {
  if (simulations.length === 0) return null;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-azure px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">
          {title} ({simulations.length}건)
        </h2>
        <p className="text-body-sm text-dusty mt-1">{description}</p>
      </header>
      <div className="divide-y divide-parchment">
        {simulations.map((sim) => (
          <PastSimulationItem key={sim.id} simulation={sim} />
        ))}
      </div>
    </section>
  );
}

function PastSimulationItem({ simulation }: { simulation: StoredSimulation }) {
  const [expanded, setExpanded] = useState(false);
  const positive = simulation.responses.filter(
    (r) => r.sentiment === "긍정",
  ).length;
  const negative = simulation.responses.filter(
    (r) => r.sentiment === "부정",
  ).length;
  const avgIntent =
    simulation.responses.length === 0
      ? 0
      : simulation.responses.reduce((acc, r) => acc + r.purchase_intent, 0) /
        simulation.responses.length;

  return (
    <details
      className="group"
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary
        className="px-4 py-3 sm:px-5 sm:py-4 cursor-pointer hover:bg-snow/50 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-azure
                   flex items-start justify-between gap-3 list-none min-h-[48px]"
      >
        <div className="flex-1 min-w-0">
          <p className="text-body font-semibold text-ink line-clamp-2">
            <span className="text-stone mr-1.5">Q.</span>
            {simulation.question}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body-sm text-dusty mt-1.5 num-tabular">
            <span>{formatDate(simulation.created_at)}</span>
            <span aria-hidden>·</span>
            <span>{simulation.responses.length}명 응답</span>
            <span aria-hidden>·</span>
            <span>
              긍정 {positive} · 부정 {negative}
            </span>
            <span aria-hidden>·</span>
            <span>평균 의향 {avgIntent.toFixed(1)}/5</span>
          </div>
        </div>
        <span className="text-body text-stone shrink-0 mt-0.5 group-open:rotate-180 transition-transform">
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4 sm:px-5 sm:pb-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {simulation.responses.map((r) => (
          <ResponseCard key={r.persona_uuid} response={r} />
        ))}
      </div>
    </details>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
