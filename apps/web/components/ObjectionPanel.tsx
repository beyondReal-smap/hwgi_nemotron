import { useMemo } from "react";
import type { PersonaHit, PersonaOpinion } from "@/lib/api";

/**
 * 이탈 사유 해부 패널 — '왜 안 사는가'를 클러스터링한다. **LLM 추가 호출 0** (클라이언트 집계).
 *
 * 상위 반응층(top_opinions)은 마케팅에 쓰이지만, 하위 반응층(bottom_opinions)의
 * 부정·중립 의견은 사장되기 쉽다. 이 패널은 그 의견의 key_concern을 빈도순으로 묶어
 * '집단이 무엇 때문에 발길을 돌리는가'를 정량(인원·막대)+정성(대표 인용)으로 드러낸다.
 *
 * terra 톤(주의·부정 의미)으로 통일하고, 인용자는 personas join으로 데모(예: "여 62세 · 경북")만 노출.
 * 원본 행번호(uuid 등 식별자)는 절대 표면화하지 않는다.
 */

/** sentiment만 있고 key_concern이 없는 의견을 묶는 폴백 라벨. */
const SENTIMENT_FALLBACK: Record<PersonaOpinion["sentiment"], string> = {
  부정: "구체적 우려 미언급 (부정)",
  중립: "구체적 우려 미언급 (중립)",
  긍정: "구체적 우려 미언급 (긍정)", // 도달 불가(긍정은 집계 제외) — 타입 완전성 위해 정의
};

type Cluster = {
  /** 우려 키워드 또는 폴백 라벨 */
  label: string;
  /** 이 클러스터에 묶인 인원 */
  count: number;
  /** key_concern 기반 클러스터인지(true), sentiment 폴백인지(false) */
  hasConcern: boolean;
  /** 대표 인용(본문이 가장 구체적인 의견) */
  quote: PersonaOpinion | null;
};

/** PersonaHit → "여 62세 · 경북" 형태 데모 라벨. 누락 필드는 graceful 생략. */
function demoLabel(p: PersonaHit | undefined): string | null {
  if (!p) return null;
  const parts: string[] = [];
  const who = [p.sex, typeof p.age === "number" ? `${p.age}세` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (who) parts.push(who);
  if (p.province) parts.push(p.province);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ObjectionPanel({
  personas,
  opinions,
}: {
  personas?: PersonaHit[];
  opinions?: PersonaOpinion[];
}) {
  const data = useMemo(() => {
    const ops = opinions ?? [];
    // 부정·중립만 — '안 사는 이유' 해부가 목적이므로 긍정은 제외
    const negative = ops.filter(
      (o) => o.sentiment === "부정" || o.sentiment === "중립"
    );
    if (negative.length === 0) return null;

    const byUuid = new Map<string, PersonaHit>();
    for (const p of personas ?? []) byUuid.set(p.uuid, p);

    const count = new Map<string, number>();
    const hasConcern = new Map<string, boolean>();
    const quote = new Map<string, PersonaOpinion>();

    for (const o of negative) {
      const concern = (o.key_concern ?? "").trim();
      const label = concern || SENTIMENT_FALLBACK[o.sentiment];

      count.set(label, (count.get(label) ?? 0) + 1);
      hasConcern.set(label, Boolean(concern));
      // 대표 인용: 같은 라벨 중 본문이 가장 긴(구체적인) 의견을 보존
      const prev = quote.get(label);
      if (!prev || o.opinion_text.length > prev.opinion_text.length) {
        quote.set(label, o);
      }
    }

    const clusters: Cluster[] = Array.from(count.entries())
      // 빈도 내림차순, 동률이면 구체적 우려(hasConcern)를 폴백 라벨보다 먼저.
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return Number(hasConcern.get(b[0])) - Number(hasConcern.get(a[0]));
      })
      .slice(0, 6)
      .map(([label, c]) => ({
        label,
        count: c,
        hasConcern: hasConcern.get(label) ?? false,
        quote: quote.get(label) ?? null,
      }));

    return {
      clusters,
      negativeTotal: negative.length,
      maxCount: clusters.length > 0 ? clusters[0].count : 0,
      byUuid,
    };
  }, [personas, opinions]);

  if (!data) return null;

  const { clusters, negativeTotal, maxCount, byUuid } = data;
  // 표본이 작으면(부정·중립 의견 10건 미만) 빈도 해석에 주의가 필요
  const smallSample = negativeTotal < 10;

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title text-ink">이탈 사유 — 왜 안 사는가</h2>
          <p className="text-body-sm text-dusty num-tabular">
            부정·중립 의견 {negativeTotal.toLocaleString()}건
          </p>
        </div>
        <p className="text-body-sm text-dusty mt-1">
          하위 반응층의 우려를 빈도순으로. 사장되던 의견에서 &lsquo;안 사는 이유&rsquo;를 묶었습니다.
        </p>
        {smallSample && (
          <p className="text-caption text-terra mt-1.5">
            표본이 작아(부정·중립 {negativeTotal}건) 빈도 순위는 참고용입니다.
          </p>
        )}
      </header>

      <ul className="divide-y divide-parchment">
        {clusters.map((c) => {
          const speaker = c.quote
            ? demoLabel(byUuid.get(c.quote.persona_uuid))
            : null;
          const barPct = maxCount > 0 ? (c.count / maxCount) * 100 : 0;
          const sharePct =
            negativeTotal > 0 ? (c.count / negativeTotal) * 100 : 0;

          return (
            <li key={c.label} className="p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p
                  className={`min-w-0 flex-1 text-body ${
                    c.hasConcern ? "text-ink font-medium" : "text-graphite italic"
                  }`}
                >
                  {c.label}
                </p>
                <p className="num-tabular text-body-sm shrink-0">
                  <span className="font-semibold text-terra">{c.count}명</span>
                  <span className="text-dusty"> / {negativeTotal}</span>
                  <span className="text-dusty"> ({sharePct.toFixed(0)}%)</span>
                </p>
              </div>

              {/* 빈도 막대 — 최다 우려 대비 상대 길이 */}
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-snow"
                role="img"
                aria-label={`${c.label}: ${negativeTotal}건 중 ${c.count}건 (${sharePct.toFixed(0)}%)`}
              >
                <div
                  className="h-full rounded-full bg-terra/70 transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${barPct}%` }}
                />
              </div>

              {c.quote && (
                <blockquote className="mt-3 rounded-[7px] border border-parchment bg-snow/40 px-3 py-2.5">
                  <p className="text-body-sm text-graphite italic">
                    “{c.quote.opinion_text}”
                  </p>
                  <footer className="mt-1.5 flex items-center gap-2 text-caption text-dusty">
                    {speaker && (
                      <span className="num-tabular not-italic">{speaker}</span>
                    )}
                    {speaker && <span aria-hidden>·</span>}
                    <span className="not-italic">{c.quote.sentiment}</span>
                    <span aria-hidden>·</span>
                    <span className="num-tabular not-italic">
                      가입의향 {c.quote.purchase_intent}/5
                    </span>
                  </footer>
                </blockquote>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
