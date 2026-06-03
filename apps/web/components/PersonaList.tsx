import type { PersonaHit, PersonaOpinion } from "@/lib/api";
import { SentimentBadge } from "@/components/SentimentBadge";

type Variant = "top" | "mid" | "bottom";

type Props = {
  personas: PersonaHit[];
  opinions?: PersonaOpinion[];
  variant?: Variant;
  /** 카드 헤더 제목 오버라이드 */
  title?: string;
  /** 헤더 보조 설명 오버라이드 */
  subtitle?: string;
};

export function PersonaList({
  personas,
  opinions = [],
  variant = "top",
  title,
  subtitle,
}: Props) {
  const opinionByUuid = new Map(opinions.map((o) => [o.persona_uuid, o]));

  const defaultTitle =
    variant === "top"
      ? "상위 반응 페르소나"
      : variant === "mid"
        ? "중위 반응 페르소나"
        : "하위 반응 페르소나";
  const defaultSubtitle =
    variant === "top"
      ? `반응도 높은 순서로 ${personas.length}명 · 본인 의견 포함`
      : variant === "mid"
        ? `평균 시장 반응 — 중간 점수 ${personas.length}명 · 본인 의견 포함`
        : `반응도 낮은 순서로 ${personas.length}명 · 비교용 (반대 반응)`;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header
        className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4 flex items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <h2 className="text-title text-ink">{title ?? defaultTitle}</h2>
          <p className="text-body-sm text-dusty mt-1 num-tabular">
            {subtitle ?? defaultSubtitle}
          </p>
        </div>
        <ScoreBadgeLegend />
      </header>
      <ul className="divide-y divide-parchment max-h-[560px] sm:max-h-[640px] overflow-auto">
        {personas.map((p, idx) => (
          <PersonaItem
            key={p.uuid}
            persona={p}
            rank={idx + 1}
            opinion={opinionByUuid.get(p.uuid)}
            variant={variant}
          />
        ))}
      </ul>
    </section>
  );
}

function PersonaItem({
  persona: p,
  rank,
  opinion,
  variant,
}: {
  persona: PersonaHit;
  rank: number;
  opinion?: PersonaOpinion;
  variant: Variant;
}) {
  const scoreClass =
    p.score >= 80
      ? "bg-terra/10 text-ink border-terra/30"
      : p.score >= 65
        ? "bg-azure/50 text-ink border-azure"
        : "bg-snow text-graphite border-parchment";

  const rankPrefix = variant === "top" ? "#" : variant === "mid" ? "•" : "↓";

  return (
    <li className="px-4 py-3 sm:px-5 sm:py-4 hover:bg-snow/70 transition-colors">
      <div className="flex items-start gap-2 sm:gap-3">
        <span className="text-body-sm font-mono text-dusty w-6 sm:w-7 shrink-0 mt-0.5 num-tabular">
          {rankPrefix}
          {rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 sm:gap-3">
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">
                {p.sex} {p.age}세
                <span className="text-dusty font-normal">
                  {" · "}
                  {p.province} · {p.district}
                </span>
              </p>
              <p className="text-body-sm text-dusty mt-1">
                {p.occupation}
                {p.family_type && (
                  <span className="text-dusty"> · {p.family_type}</span>
                )}
              </p>
            </div>
            <div className="flex flex-col items-end shrink-0 gap-0.5">
              <span
                className={`text-body font-mono font-semibold px-2 sm:px-2.5 py-1 rounded-[9.6px] border num-tabular ${scoreClass}`}
              >
                {p.score.toFixed(1)}
              </span>
              {/* 보조 라벨 — 모집단 백분위. raw 점수가 [52,78]로 좁아 의미 직관이 어려운 점 보완.
                  옛 분석은 percentile_score=null이라 자동 숨김. */}
              {p.percentile_score != null && (
                <span
                  className="text-overline text-dusty num-tabular leading-tight"
                  title="모집단 100만 명 내 백분위 (높을수록 상위)"
                >
                  상위 {(100 - p.percentile_score).toFixed(p.percentile_score >= 99.9 ? 2 : 1)}%
                </span>
              )}
            </div>
          </div>
          <p className="text-body-sm text-graphite mt-2 line-clamp-3 leading-relaxed">
            {p.persona}
          </p>

          {opinion && <OpinionBlock opinion={opinion} />}
        </div>
      </div>
    </li>
  );
}

function OpinionBlock({ opinion }: { opinion: PersonaOpinion }) {
  // 감정 색은 시맨틱 상태색 + 아이콘으로 통일(SentimentBadge): 긍정=success, 부정=danger, 중립=회색.
  return (
    <div className="mt-3 border-t border-parchment pt-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <SentimentBadge sentiment={opinion.sentiment} />
        <span className="text-caption text-dusty num-tabular">
          가입의향{" "}
          <span className="font-semibold text-ink">{opinion.purchase_intent}</span>
          <span className="text-dusty">/5</span>
        </span>
        {opinion.key_concern && (
          <span className="text-caption text-dusty truncate max-w-full sm:max-w-[60%]">
            관심사: <span className="text-graphite">{opinion.key_concern}</span>
          </span>
        )}
      </div>
      <blockquote className="text-body text-ink leading-relaxed border-l-2 border-parchment pl-3">
        &ldquo;{opinion.opinion_text}&rdquo;
      </blockquote>
    </div>
  );
}

function ScoreBadgeLegend() {
  return (
    <div className="hidden sm:flex items-center gap-1.5 text-caption text-dusty num-tabular shrink-0">
      <span className="inline-block w-2 h-2 rounded-full bg-terra" />
      <span>80+</span>
      <span className="inline-block w-2 h-2 rounded-full bg-azure ml-1.5" />
      <span>65+</span>
      <span className="inline-block w-2 h-2 rounded-full bg-stone ml-1.5" />
      <span>~65</span>
    </div>
  );
}
