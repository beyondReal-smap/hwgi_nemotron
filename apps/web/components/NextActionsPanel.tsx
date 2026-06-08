"use client";

import Link from "next/link";
import type { AnalyzeResponse, AnalysisDetail } from "@/lib/api";

/**
 * 분석 코파일럿(Phase 1, 읽기전용) — 분석 결과의 정형 데이터로 '다음에 무엇을 분석하면
 * 좋을지' 제안 카드를 만들어 해당 도구로 원클릭 이동시킨다. LLM 0콜(클라이언트 규칙).
 *
 * - 세그먼트 탐색: 최상위 lift 세그먼트를 검색어로 /personas?q=... (q 프리필 → 자동 검색)
 * - 가상 설문: 저장된 분석으로 /survey/[analysis_id]
 * - A/B 비교: /abtest (이 분석을 변형안과 비교하도록 유도)
 *
 * 스트리밍 중(analysis_id="pending")엔 설문 카드를 숨겨 저장 완료 후에만 노출한다.
 */

type Props = { result: AnalyzeResponse | AnalysisDetail };

type ActionKind = "personas" | "survey" | "abtest";

type Action = {
  kind: ActionKind;
  title: string;
  rationale: string;
  href: string;
  cta: string;
};

const _TONE: Record<ActionKind, { dot: string; cta: string; ring: string }> = {
  personas: { dot: "bg-azure", cta: "text-ink", ring: "hover:border-azure" },
  survey: { dot: "bg-marine", cta: "text-marine", ring: "hover:border-marine/50" },
  abtest: { dot: "bg-terra", cta: "text-terra", ring: "hover:border-terra/50" },
};

function buildActions(result: Props["result"]): Action[] {
  const out: Action[] = [];

  const seg = result.segments?.[0];
  if (seg) {
    // 세그먼트 라벨("20대 · 배우자·자녀와 거주 · 경기")을 자연어 검색어로.
    const q = seg.label.replace(/ · /g, " ");
    out.push({
      kind: "personas",
      title: "핵심 세그먼트 깊이 탐색",
      rationale: `‘${seg.label}’이 전국 대비 ${seg.lift_ratio.toFixed(1)}배 집중 — 이 층을 더 들여다보세요`,
      href: `/personas?q=${encodeURIComponent(q)}`,
      cta: "페르소나 탐색 열기",
    });
  }

  if (result.analysis_id && result.analysis_id !== "pending") {
    out.push({
      kind: "survey",
      title: "이 타겟에게 직접 물어보기",
      rationale: "상위 반응층에 가상 설문을 돌려 생생한 반응과 이유를 확인하세요",
      href: `/survey/${result.analysis_id}`,
      cta: "가상 설문 시작",
    });
  }

  out.push({
    kind: "abtest",
    title: "변형안과 A/B 비교",
    rationale: "카피·컨셉을 바꾼 안과 나란히 분석해 어느 쪽이 더 반응하는지 가려보세요",
    href: "/abtest",
    cta: "A/B 테스트 열기",
  });

  return out;
}

export function NextActionsPanel({ result }: Props) {
  const actions = buildActions(result);
  if (actions.length === 0) return null;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">다음 분석 제안</h2>
        <p className="text-body-sm text-dusty mt-1">
          이 결과에서 이어가면 좋은 분석을 골라뒀습니다. 한 번에 이어서 파보세요.
        </p>
      </header>
      <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {actions.map((a) => {
          const tone = _TONE[a.kind];
          return (
            <Link
              key={a.kind}
              href={a.href}
              className={`group flex flex-col rounded-[7px] border border-parchment bg-snow/40 p-4 transition-colors ${tone.ring}
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-azure`}
            >
              <span className="flex items-center gap-2 mb-1.5">
                <span aria-hidden className={`h-2 w-2 rounded-full ${tone.dot}`} />
                <span className="text-heading font-semibold text-ink">{a.title}</span>
              </span>
              <span className="text-body-sm text-graphite leading-6 flex-1">{a.rationale}</span>
              <span className={`mt-3 text-body-sm font-semibold ${tone.cta} inline-flex items-center gap-1`}>
                {a.cta}
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">
                  →
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
