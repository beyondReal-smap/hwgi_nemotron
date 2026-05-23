"use client";

import { useEffect, useState } from "react";
import {
  loadLLMProvider,
  saveLLMProvider,
  simulateSurvey,
  type LLMProvider,
  type PersonaResponse,
  type SimulateResponse,
} from "@/lib/api";
import { LLMProviderToggle } from "@/components/LLMProviderToggle";

type Props = {
  analysisId: string;
  onSubmitted?: () => void;
};

type RespondentCount = number | "";

const PRESET_QUESTIONS = [
  "이 상품을 추천받으면 어떻게 반응하시겠어요?",
  "가입을 결정할 때 가장 중요하게 보는 점은 무엇인가요?",
  "이 상품에서 아쉽거나 부족하다고 느끼는 부분이 있나요?",
];

export function SurveyPanel({ analysisId, onSubmitted }: Props) {
  const [question, setQuestion] = useState("");
  const [nRespondents, setNRespondents] = useState<RespondentCount>(5);
  const [provider, setProvider] = useState<LLMProvider>("anthropic");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulateResponse | null>(null);

  useEffect(() => {
    setProvider(loadLLMProvider());
  }, []);

  function handleProviderChange(p: LLMProvider) {
    setProvider(p);
    saveLLMProvider(p);
  }

  const trimmed = question.trim();
  const isValidN = typeof nRespondents === "number" && nRespondents >= 1 && nRespondents <= 100;
  const canSubmit = trimmed.length >= 5 && trimmed.length <= 300 && !loading && isValidN;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await simulateSurvey(
        analysisId,
        trimmed,
        nRespondents as number,
        provider,
      );
      setResult(res);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-azure px-5 py-3.5">
        <h2 className="text-heading text-ink">📋 이 페르소나들에게 물어보기</h2>
        <p className="text-caption text-dusty mt-1">
          위에서 매칭된 페르소나가 본인 입장으로 설문에 어떻게 응답할지 시뮬레이션합니다
        </p>
      </header>

      <form onSubmit={onSubmit} className="px-5 py-5 space-y-4">
        <div>
          <label
            htmlFor="survey-question"
            className="block text-body-sm font-medium text-ink mb-2"
          >
            설문 문항
          </label>
          <textarea
            id="survey-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="예: 이 종신보험을 추천받으면 어떻게 반응하시겠어요?"
            rows={3}
            maxLength={300}
            className="w-full px-3 py-2 text-body bg-vellum border border-parchment rounded-[9.6px]
                       focus:outline-none focus:border-azure focus:ring-1 focus:ring-azure
                       placeholder:text-stone resize-none"
            disabled={loading}
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex flex-wrap gap-2">
              {PRESET_QUESTIONS.map((q) => (
                <button
                  type="button"
                  key={q}
                  onClick={() => setQuestion(q)}
                  disabled={loading}
                  className="text-caption px-2 py-1 rounded-[9.6px] border border-parchment
                             text-dusty hover:bg-snow hover:text-ink transition-colors
                             disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <span className="text-caption text-stone num-tabular shrink-0 ml-2">
              {trimmed.length} / 300
            </span>
          </div>
        </div>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <span className="block text-body-sm font-medium text-ink mb-2">
                응답자 수
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <div
                  role="radiogroup"
                  aria-label="응답자 수"
                  className="inline-flex border border-parchment rounded-[9.6px] overflow-hidden bg-vellum"
                >
                  {([3, 5, 10] as const).map((n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => setNRespondents(n)}
                      role="radio"
                      aria-checked={nRespondents === n}
                      disabled={loading}
                      className={`px-4 py-1.5 text-body-sm num-tabular border-r border-parchment last:border-r-0 transition-colors
                                  ${
                                    nRespondents === n
                                      ? "bg-azure/40 text-ink font-semibold"
                                      : "bg-vellum text-graphite hover:bg-snow"
                                  }
                                  disabled:opacity-50`}
                    >
                      {n}명
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 border border-parchment rounded-[9.6px] px-3 py-1.5 bg-vellum">
                  <input
                    type="number"
                    max={100}
                    value={nRespondents}
                    onChange={(e) => {
                      const text = e.target.value;
                      if (text === "") {
                        setNRespondents("");
                      } else {
                        const val = parseInt(text, 10);
                        if (!isNaN(val)) {
                          setNRespondents(Math.min(100, val));
                        }
                      }
                    }}
                    onBlur={() => {
                      if (nRespondents === "" || nRespondents < 1) {
                        setNRespondents(5);
                      }
                    }}
                    disabled={loading}
                    placeholder="직접"
                    className="w-12 bg-transparent text-body-sm num-tabular text-ink text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-semibold placeholder:text-stone/60 placeholder:font-normal"
                  />
                  <span className="text-body-sm text-stone pr-0.5">명 직접 입력 (최대 100명)</span>
                </div>
              </div>
            </div>

            <div>
              <span className="block text-body-sm font-medium text-ink mb-2">
                LLM
              </span>
              <LLMProviderToggle
                value={provider}
                onChange={handleProviderChange}
                disabled={loading}
                compact
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="px-5 py-2 rounded-[9.6px] bg-ink text-vellum text-body-sm font-medium
                       hover:bg-graphite transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "응답 생성 중..." : "응답 시뮬레이션 시작"}
          </button>
        </div>

        {trimmed.length > 0 && trimmed.length < 5 && (
          <p className="text-caption text-terra">최소 5자 이상 입력해주세요.</p>
        )}
      </form>

      {(loading || error || result) && (
        <div className="border-t border-parchment px-5 py-5">
          {loading && <ResultsLoading n={nRespondents === "" ? 5 : nRespondents} />}
          {error && <ResultsError message={error} />}
          {result && <ResultsView result={result} />}
        </div>
      )}
    </section>
  );
}

// ============================================================
// 로딩 상태 (스피너 + 안내문)
// ============================================================

function ResultsLoading({ n }: { n: number }) {
  return (
    <div className="space-y-4 py-3" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <p className="text-body-sm text-graphite text-center font-medium">
          AI 페르소나가 상품 검토 및 응답 작성 중... ({n}명 시뮬레이션)
        </p>
        <div className="w-full max-w-md mx-auto h-1.5 bg-parchment rounded-full overflow-hidden relative">
          <style>{`
            @keyframes smoothProgress {
              0% { transform: translateX(-100%); }
              50% { transform: translateX(0%); }
              100% { transform: translateX(100%); }
            }
            .animate-progress {
              animation: smoothProgress 2s infinite ease-in-out;
            }
          `}</style>
          <div className="h-full bg-azure rounded-full w-full absolute left-0 top-0 animate-progress origin-left" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: Math.min(n, 4) }).map((_, i) => (
          <div
            key={i}
            className="h-28 bg-snow border border-parchment rounded-[9.6px] animate-pulse flex flex-col justify-between p-4"
          >
            <div className="h-4 bg-parchment rounded w-1/3" />
            <div className="space-y-2">
              <div className="h-3 bg-parchment rounded w-5/6" />
              <div className="h-3 bg-parchment rounded w-4/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultsError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="bg-terra/10 border border-terra/30 rounded-[9.6px] p-3"
    >
      <p className="text-body-sm font-semibold text-ink mb-1">
        시뮬레이션에 실패했습니다
      </p>
      <p className="text-caption text-graphite">{message}</p>
    </div>
  );
}

// ============================================================
// 결과 표시
// ============================================================

function ResultsView({ result }: { result: SimulateResponse }) {
  const summary = summarize(result.responses);

  const sortedResponses = [...result.responses].sort((a, b) => {
    const order: Record<string, number> = { 긍정: 1, 부정: 2, 중립: 3 };
    return (order[a.sentiment] ?? 4) - (order[b.sentiment] ?? 4);
  });

  return (
    <div className="space-y-4">
      <SummaryStrip summary={summary} elapsedMs={result.elapsed_ms.total ?? 0} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sortedResponses.map((r) => (
          <ResponseCard key={r.persona_uuid} response={r} />
        ))}
      </div>
    </div>
  );
}

type SummaryStats = {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  avgIntent: number;
};

function summarize(responses: PersonaResponse[]): SummaryStats {
  const total = responses.length;
  const positive = responses.filter((r) => r.sentiment === "긍정").length;
  const neutral = responses.filter((r) => r.sentiment === "중립").length;
  const negative = responses.filter((r) => r.sentiment === "부정").length;
  const avgIntent =
    total === 0
      ? 0
      : responses.reduce((acc, r) => acc + r.purchase_intent, 0) / total;
  return { total, positive, neutral, negative, avgIntent };
}

function SummaryStrip({
  summary,
  elapsedMs,
}: {
  summary: SummaryStats;
  elapsedMs: number;
}) {
  const { total, positive, neutral, negative, avgIntent } = summary;
  const positiveRatio = total === 0 ? 0 : (positive / total) * 100;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-snow border border-parchment rounded-[9.6px] p-4">
      <Stat
        label="긍정 응답"
        value={`${positive} / ${total}`}
        sub={`${positiveRatio.toFixed(0)}%`}
        accent="terra"
      />
      <Stat
        label="감정 분포"
        value={`+${positive} · ${neutral} · -${negative}`}
        sub="긍정 · 중립 · 부정"
      />
      <Stat
        label="평균 가입 의향"
        value={avgIntent.toFixed(1)}
        sub="5점 만점"
        accent="azure"
      />
      <Stat
        label="소요 시간"
        value={`${(elapsedMs / 1000).toFixed(1)}초`}
        sub="실 시뮬레이션"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "terra" | "azure";
}) {
  const valueClass =
    accent === "terra"
      ? "text-ink"
      : accent === "azure"
        ? "text-ink"
        : "text-ink";
  return (
    <div>
      <p className="text-overline text-dusty">{label}</p>
      <p className={`text-heading font-semibold num-tabular mt-0.5 ${valueClass}`}>
        {value}
      </p>
      {sub && <p className="text-caption text-stone mt-0.5">{sub}</p>}
    </div>
  );
}

export function ResponseCard({ response }: { response: PersonaResponse }) {
  const sentimentBadge = sentimentBadgeClass(response.sentiment);

  return (
    <article className="border border-parchment rounded-[9.6px] p-4 bg-vellum hover:bg-snow/40 transition-colors">
      <header className="flex items-start justify-between gap-3 mb-2">
        <p className="text-body-sm font-medium text-ink min-w-0 truncate">
          {response.persona_summary}
        </p>
        <span
          className={`text-overline font-semibold px-2 py-0.5 rounded-[9.6px] border shrink-0 ${sentimentBadge}`}
        >
          {response.sentiment}
        </span>
      </header>

      <blockquote className="text-body text-graphite leading-7 my-3 pl-3 border-l-2 border-parchment">
        “{response.response_text}”
      </blockquote>

      <footer className="flex items-center justify-between gap-3 mt-3">
        <IntentMeter value={response.purchase_intent} />
        {response.key_concern && (
          <span className="text-caption text-dusty truncate">
            <span className="text-stone">관심: </span>
            {response.key_concern}
          </span>
        )}
      </footer>
    </article>
  );
}

function sentimentBadgeClass(sentiment: PersonaResponse["sentiment"]): string {
  switch (sentiment) {
    case "긍정":
      return "bg-terra/10 text-ink border-terra/30";
    case "부정":
      return "bg-stone/10 text-graphite border-stone/30";
    default:
      return "bg-azure/40 text-ink border-azure";
  }
}

function IntentMeter({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-caption text-dusty">가입 의향</span>
      <div className="flex items-center gap-0.5" aria-label={`${value} / 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`inline-block w-2 h-3 rounded-sm ${
              i <= value ? "bg-ink" : "bg-parchment"
            }`}
          />
        ))}
      </div>
      <span className="text-caption font-mono text-graphite num-tabular">
        {value}/5
      </span>
    </div>
  );
}
