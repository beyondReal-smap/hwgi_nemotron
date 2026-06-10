import type { AnalyzeResponse, AnalysisDetail } from "@/lib/api";
import {
  estimateNationalScale,
  formatApproxKorean,
  TRADITIONAL_RESEARCH,
} from "@/lib/marketSizing";

/**
 * 한눈에 보는 결론 — 임원 보고용 1장 요약 (LLM 0콜, 기존 분석 필드만 조합).
 *
 * 마케팅 의사결정자가 스크롤 없이 30초 안에 판단할 수 있도록:
 *   ① 판정 신호(강한 반응/양호/신중 검토 — core_lift 기준)
 *   ② 도달 가능 타겟 규모(페르소나 인원 → 전국 성인 비례 환산 가늠치)
 *   ③ 가장 뜨거운 층(최상위 세그먼트 + 전국 대비 집중 배수)
 *   ④ 공략 1순위 지역
 *   ⑤ 시간·비용 — 전통 소비자조사 대비 (업계 통상 기준, 각주 명시)
 *
 * 옛 분석 이력에는 core_lift·segments가 없을 수 있어 모든 행이 graceful하게 빠진다.
 */

type Props = { result: AnalyzeResponse | AnalysisDetail };

type Signal = {
  label: string;
  desc: string;
  chip: string; // 칩 배경/테두리/글자 톤
};

// 판정 임계 — 운영 분석 실측 core_lift 분포(14~29점)에 맞춘 보수적 컷.
// azure=긍정/안정, terra=주의 (한화 톤 의미 매핑 준수).
function buildSignal(coreLift: number | null | undefined, hasCore: boolean): Signal | null {
  if (!hasCore || coreLift == null) return null;
  if (coreLift >= 20) {
    return {
      label: "강한 반응",
      desc: "핵심 타겟이 전체 평균을 크게 웃돕니다 — 출시·캠페인 청신호",
      chip: "bg-azure/30 border-azure text-ink",
    };
  }
  if (coreLift >= 10) {
    return {
      label: "양호한 반응",
      desc: "뚜렷한 반응층이 존재합니다 — 타겟을 좁히면 효율이 올라갑니다",
      chip: "bg-snow border-parchment text-graphite",
    };
  }
  return {
    label: "신중 검토",
    desc: "반응층과 전체 평균의 차이가 작습니다 — 소구점 보강을 권장",
    chip: "bg-terra/8 border-terra/25 text-terra",
  };
}

export function ExecutiveSummary({ result }: Props) {
  const ps = result.population_stats;
  const cohorts = ps.cohorts ?? [];
  const core = cohorts.find((c) => c.name === "core");
  const target = cohorts.find((c) => c.name === "target");
  const hasCore = !!core && core.size > 0;

  const signal = buildSignal(ps.core_lift, hasCore);
  const topSegment = result.segments?.[0];

  const provinceGroup = ps.demographics?.find((g) => g.column === "province");
  const topProvince = provinceGroup?.bins[0];

  const targetSize = target?.size ?? 0;
  const nationalScale = targetSize > 0 ? estimateNationalScale(targetSize) : 0;

  const totalSec = (result.elapsed_ms?.total ?? 0) / 1000;

  const rows: { label: string; value: string; sub?: string }[] = [];
  if (targetSize > 0) {
    rows.push({
      label: "도달 가능 타겟",
      value: `${formatApproxKorean(nationalScale)} 규모`,
      sub: `페르소나 ${targetSize.toLocaleString("ko-KR")}명 → 전국 성인 비례 환산 가늠치`,
    });
  }
  if (topSegment) {
    rows.push({
      label: "가장 뜨거운 층",
      value: topSegment.label,
      sub: `전국 평균보다 ${topSegment.lift_ratio.toFixed(1)}배 집중`,
    });
  }
  if (topProvince) {
    rows.push({
      label: "공략 1순위 지역",
      value: topProvince.label,
      sub: `타겟층 ${topProvince.count.toLocaleString("ko-KR")}명 거주`,
    });
  }
  if (totalSec > 0) {
    rows.push({
      label: "시간·비용",
      value: `${totalSec.toFixed(0)}초 · 추가 조사비 0원`,
      sub: `통상 소비자조사 ${TRADITIONAL_RESEARCH.duration} · ${TRADITIONAL_RESEARCH.cost} 대비*`,
    });
  }

  // 신호도 행도 없으면(아주 옛 이력) 카드 자체를 숨긴다.
  if (!signal && rows.length === 0) return null;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-title text-ink">한눈에 보는 결론</h2>
          <p className="text-body-sm text-dusty mt-1">
            의사결정에 필요한 핵심만 30초 분량으로 추렸습니다.
          </p>
        </div>
        {signal && (
          <div className="text-right">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-body-sm font-semibold ${signal.chip}`}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {signal.label}
            </span>
            <p className="text-caption text-graphite mt-1.5 max-w-[19rem]">
              {signal.desc}
            </p>
          </div>
        )}
      </header>

      {rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 divide-parchment sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(even)]:border-l sm:[&>*]:border-parchment">
          {rows.map((r) => (
            <div key={r.label} className="px-4 py-3 sm:px-5 sm:py-4">
              <p className="text-overline text-dusty">{r.label}</p>
              <p className="text-heading text-ink mt-1 num-tabular">{r.value}</p>
              {r.sub && <p className="text-caption text-stone mt-1">{r.sub}</p>}
            </div>
          ))}
        </div>
      )}

      <p className="px-4 py-2.5 sm:px-5 border-t border-parchment bg-snow/60 text-caption text-dusty">
        * {TRADITIONAL_RESEARCH.footnote}
      </p>
    </section>
  );
}
