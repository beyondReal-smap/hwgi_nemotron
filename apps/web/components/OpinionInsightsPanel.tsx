"use client";

import { useMemo, useState } from "react";
import type { PersonaOpinion } from "@/lib/api";
import { SEMANTIC } from "@/lib/chartColors";

/**
 * VOC(고객의 소리) 인사이트 패널 — 이미 생성된 페르소나 의견(top/mid/bottom)을
 * 클라이언트에서 집계해 정량 인사이트로 격상한다. **LLM 추가 호출 0** (비싼 의견 재활용).
 *
 * 카드 나열("30명이 말했다")보다 '90명 중 67% 긍정, 최대 우려는 보험료(23명)'라는 집계가
 * 훨씬 '집단이 진짜 답한' 설문 같은 무게를 준다 — 정성(의견)과 정량(점수)을 잇는 다리.
 */
export function OpinionInsightsPanel({
  opinions,
}: {
  opinions: PersonaOpinion[];
}) {
  const [openConcern, setOpenConcern] = useState<string | null>(null);

  const stats = useMemo(() => {
    const total = opinions.length;
    if (total === 0) return null;

    let pos = 0;
    let neu = 0;
    let neg = 0;
    let intentSum = 0;
    let intentN = 0;
    const concernCount = new Map<string, number>();
    const concernQuote = new Map<string, PersonaOpinion>();

    for (const o of opinions) {
      if (o.sentiment === "긍정") pos += 1;
      else if (o.sentiment === "부정") neg += 1;
      else neu += 1;

      if (typeof o.purchase_intent === "number") {
        intentSum += o.purchase_intent;
        intentN += 1;
      }

      const concern = (o.key_concern ?? "").trim();
      if (concern) {
        concernCount.set(concern, (concernCount.get(concern) ?? 0) + 1);
        // 대표 인용: 같은 우려 중 본문이 가장 긴(구체적인) 의견을 대표로 보존
        const prev = concernQuote.get(concern);
        if (!prev || o.opinion_text.length > prev.opinion_text.length) {
          concernQuote.set(concern, o);
        }
      }
    }

    const topConcerns = Array.from(concernCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({
        label,
        count,
        quote: concernQuote.get(label) ?? null,
      }));

    return {
      total,
      pos,
      neu,
      neg,
      avgIntent: intentN > 0 ? intentSum / intentN : null,
      topConcerns,
    };
  }, [opinions]);

  if (!stats) return null;

  const { total, pos, neu, neg, avgIntent, topConcerns } = stats;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title text-ink">고객 반응 핵심 (VOC)</h2>
          <p className="text-body-sm text-dusty num-tabular">
            페르소나 {total.toLocaleString()}명 의견 집계
          </p>
        </div>
        <p className="text-body-sm text-dusty mt-1">
          상·중·하위 반응 페르소나가 직접 남긴 의견을 감정·가입의향·핵심 우려로 정량화했습니다.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-parchment">
        {/* 감정 분포 + 가입의향 */}
        <div className="p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-overline text-dusty">감정 분포</p>
            {avgIntent != null && (
              <p className="text-body-sm num-tabular text-graphite">
                평균 가입의향{" "}
                <span className="font-semibold text-ink">
                  {avgIntent.toFixed(1)}
                </span>
                <span className="text-dusty"> / 5</span>
              </p>
            )}
          </div>

          {/* 감정 스택 막대 */}
          <div
            className="mt-2.5 flex h-3 w-full overflow-hidden rounded-full bg-snow"
            role="img"
            aria-label={`긍정 ${pct(pos).toFixed(0)}%, 중립 ${pct(neu).toFixed(0)}%, 부정 ${pct(neg).toFixed(0)}%`}
          >
            <span style={{ width: `${pct(pos)}%`, background: SEMANTIC.success }} />
            <span style={{ width: `${pct(neu)}%`, background: SEMANTIC.warning }} />
            <span style={{ width: `${pct(neg)}%`, background: SEMANTIC.danger }} />
          </div>

          <ul className="mt-3 grid grid-cols-3 gap-2 text-center">
            <SentimentStat label="긍정" count={pos} pct={pct(pos)} color={SEMANTIC.success} />
            <SentimentStat label="중립" count={neu} pct={pct(neu)} color={SEMANTIC.warning} />
            <SentimentStat label="부정" count={neg} pct={pct(neg)} color={SEMANTIC.danger} />
          </ul>

          {avgIntent != null && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-caption text-dusty">
                <span>가입의향 게이지</span>
                <span className="num-tabular">{avgIntent.toFixed(2)} / 5</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-snow">
                <div
                  className="h-full rounded-full bg-terra"
                  style={{ width: `${Math.min(100, (avgIntent / 5) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 핵심 우려 랭킹 */}
        <div className="p-4 sm:p-5">
          <p className="text-overline text-dusty">가장 많이 언급된 핵심 관심·우려</p>
          {topConcerns.length === 0 ? (
            <p className="mt-2 text-body-sm text-dusty">
              집계된 핵심 우려가 없습니다.
            </p>
          ) : (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {topConcerns.map((c) => {
                const open = openConcern === c.label;
                return (
                  <li key={c.label}>
                    <button
                      type="button"
                      onClick={() => setOpenConcern(open ? null : c.label)}
                      aria-expanded={open}
                      className="w-full flex items-center gap-2 rounded-[7px] border border-parchment bg-snow px-2.5 py-1.5 text-left transition-colors hover:border-terra/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                    >
                      <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                        {c.label}
                      </span>
                      <span className="num-tabular text-caption font-semibold text-terra shrink-0">
                        {c.count}명
                      </span>
                      <span
                        aria-hidden
                        className={`text-dusty transition-transform ${open ? "rotate-90" : ""}`}
                      >
                        ›
                      </span>
                    </button>
                    {open && c.quote && (
                      <blockquote className="mt-1 ml-1 border-l-2 border-terra/30 pl-2.5 py-1 text-caption text-graphite italic">
                        “{c.quote.opinion_text}”
                        <span className="not-italic text-dusty">
                          {" "}
                          — {c.quote.sentiment} · 가입의향 {c.quote.purchase_intent}/5
                        </span>
                      </blockquote>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function SentimentStat({
  label,
  count,
  pct,
  color,
}: {
  label: string;
  count: number;
  pct: number;
  color: string;
}) {
  return (
    <li className="rounded-[7px] border border-parchment bg-snow px-2 py-2">
      <div className="flex items-center justify-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: color }}
        />
        <span className="text-caption text-graphite">{label}</span>
      </div>
      <p className="mt-1 num-tabular text-body font-semibold text-ink">
        {pct.toFixed(0)}
        <span className="text-caption text-dusty font-normal">%</span>
      </p>
      <p className="text-caption text-dusty num-tabular">{count}명</p>
    </li>
  );
}
