"use client";

import { useEffect, useState } from "react";
import {
  loadLLMProvider,
  runABTest,
  saveLLMProvider,
  type ABChallengerKind,
  type ABTestInputMode,
  type ABTestResponse,
  type LLMProvider,
} from "@/lib/api";
import { LLMProviderToggle } from "@/components/LLMProviderToggle";

type Props = {
  onResult: (r: ABTestResponse) => void;
  onError: (msg: string | null) => void;
  loading: boolean;
  setLoading: (b: boolean) => void;
};

const MIN_TEXT = 20;
const MAX_TEXT = 20_000;
const MIN_COMPANY = 10;
const MAX_COMPANY = 2_000;

/**
 * 당사 정보 기본 텍스트 — 한화손해보험 공개 정보 기반(2026-05 기준, 약 700자).
 * 사용자가 자유롭게 수정·삭제 가능. 비워두면 플레이스홀더 노출.
 * 출처: 한화손보 IR·보도자료, 한화 그룹 캐롯손보 합병 발표(2025-10).
 */
const DEFAULT_COMPANY_CONTEXT = `한화손해보험 — 한화 금융계열 손해보험사. 2025년 10월 디지털 손보 캐롯손해보험을 흡수합병하여 '하이브리드' 전략(전통 손보의 상품·운영 안정성 + 캐롯의 디지털 역량)을 가동. 2026년 1분기 자동차보험 매출 3,000억원 돌파, 자동차보험 시장점유율 5.6%→6.0%로 상승.

핵심 강점:
- 여성보험 초격차 — LIFEPLUS 시그니처 여성건강보험 4.0. 배타적사용권 22건 확보. 임신·출산·갱년기·가정폭력 법률비용까지 여성 생애주기 통합 보장. 15~49세 여성고객 +102% 급증.
- 캐롯 디지털 채널 내재화 — 모바일 비대면 가입·UBI 자동차보험 등 디지털 역량 본격 가동.
- 신계약 CSM 1조원 첫 돌파(+38.9% YoY), 보유 CSM 4조694억(+7%).

차별점:
- LIFEPLUS 펨테크연구소 — 업계 최초 여성 건강·금융 연구조직, 차병원 협업(유방암 맞춤 보장·난소 나이 측정).
- 시그니처 라이브러리 — 여성 웰니스 디지털 콘텐츠 플랫폼.
- 한화 그룹 시너지(한화생명·여행·건강·생활 멤버십) 연계 가능.

핵심 KPI:
- 2030년 자동차보험 원수보험료 2조원, 시장점유율 10% 달성.
- 단기 KPI: (a) 자동차보험 빅4 진입, (b) 2030 여성 신규 유입 확대, (c) 캐롯 디지털 채널을 통한 MZ 모객, (d) FP 채널 갱신율 유지.`;

const INPUT_MODES: { value: ABTestInputMode; label: string; hint: string }[] = [
  {
    value: "terms",
    label: "약관·상품설명서",
    hint: "보장 내용·면책·가입 조건 등 전문(全文)을 분석",
  },
  {
    value: "marketing",
    label: "마케팅 카피",
    hint: "광고 카피·헤드라인 등 짧은 문구의 페르소나 인상 비교",
  },
  {
    value: "concept",
    label: "컨셉 + 보장 요약",
    hint: "신상품 기획 초기 — 타겟·핵심 보장 요약본",
  },
];

function getPlaceholders(mode: ABTestInputMode): { a: string; b: string } {
  if (mode === "marketing") {
    return {
      a: '예) "평생 보장, 든든한 일상 — 한화 종신보험 시그니처"',
      b: '예) "당신의 오늘에 안심을. 한화생명 New 종신보험"',
    };
  }
  if (mode === "concept") {
    return {
      a: "예) 40대 가장 타겟. 사망 보장 1억 + 암 진단비 3천만, 비흡연자 보험료 20% 할인. 월 보험료 8만원대",
      b: "예) 30대 1인가구 타겟. 사망 보장 5천만 + 입원일당 + 건강관리 앱. 월 보험료 5만원대",
    };
  }
  return {
    a: "예) 약관 본문을 붙여 넣으세요 — 보장 내용, 면책 사항, 가입 조건 등",
    b: "예) 비교할 다른 안의 약관 본문",
  };
}

export function ABTestInputForm({ onResult, onError, loading, setLoading }: Props) {
  const [companyContext, setCompanyContext] = useState(DEFAULT_COMPANY_CONTEXT);
  const [inputMode, setInputMode] = useState<ABTestInputMode>("terms");
  const [labelA, setLabelA] = useState("안 A");
  const [labelB, setLabelB] = useState("안 B");
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [baseline, setBaseline] = useState<"A" | "B">("A");
  const [challengerKind, setChallengerKind] = useState<ABChallengerKind>("internal");
  const [provider, setProvider] = useState<LLMProvider>("sllm");

  useEffect(() => {
    setProvider(loadLLMProvider());
  }, []);

  function handleProviderChange(p: LLMProvider) {
    setProvider(p);
    saveLLMProvider(p);
  }

  const companyLen = companyContext.trim().length;
  const aLen = textA.trim().length;
  const bLen = textB.trim().length;

  const companyOk = companyLen >= MIN_COMPANY && companyLen <= MAX_COMPANY;
  const aOk = aLen >= MIN_TEXT && aLen <= MAX_TEXT;
  const bOk = bLen >= MIN_TEXT && bLen <= MAX_TEXT;
  const labelsOk =
    labelA.trim().length > 0 &&
    labelB.trim().length > 0 &&
    labelA.trim() !== labelB.trim();

  const canSubmit = companyOk && aOk && bOk && labelsOk && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    onError(null);

    try {
      const r = await runABTest({
        company_context: companyContext.trim(),
        input_mode: inputMode,
        variant_a: { label: labelA.trim(), text: textA.trim() },
        variant_b: { label: labelB.trim(), text: textB.trim() },
        baseline_variant: baseline,
        challenger_kind: challengerKind,
        llm_provider: provider,
        top_k: 50,
      });
      onResult(r);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const placeholders = getPlaceholders(inputMode);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* 당사 정보 */}
      <section className="rounded-[9.6px] border border-parchment bg-snow/40 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <label htmlFor="company-context" className="text-overline text-graphite">
            당사 정보 (장단점·전략의 기준)
          </label>
          <span
            className={`text-caption ${
              companyLen > MAX_COMPANY
                ? "text-rose-600"
                : companyOk
                  ? "text-emerald-700"
                  : "text-dusty"
            }`}
          >
            {companyLen.toLocaleString()} / {MAX_COMPANY.toLocaleString()}자
          </span>
        </div>
        <textarea
          id="company-context"
          value={companyContext}
          onChange={(e) => setCompanyContext(e.target.value)}
          rows={6}
          placeholder="예) 한화손해보험 — 캐롯손보 합병 후 '하이브리드' 전략. 여성보험 초격차(LIFEPLUS 시그니처). KPI: 2030 자동차보험 시장점유율 10%."
          className="w-full rounded-[7px] border border-parchment bg-vellum px-3 py-2 text-body text-ink placeholder:text-dusty focus:outline-none focus:border-azure focus:ring-2 focus:ring-azure/30 resize-y font-mono text-body-sm leading-6"
          maxLength={MAX_COMPANY + 200}
          disabled={loading}
        />
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <p className="text-caption text-dusty">
            한화손해보험 공개 정보(2026-05 기준)가 기본값으로 채워져 있습니다. 자유롭게 수정·교체하실 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => setCompanyContext(DEFAULT_COMPANY_CONTEXT)}
            disabled={loading || companyContext === DEFAULT_COMPANY_CONTEXT}
            className="shrink-0 text-caption text-azure hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
          >
            기본값으로 되돌리기
          </button>
        </div>
      </section>

      {/* 입력 모드 */}
      <section>
        <span className="block text-overline text-graphite mb-2">입력 모드</span>
        <div
          role="radiogroup"
          aria-label="입력 모드"
          className="inline-flex flex-wrap gap-1 border border-parchment rounded-[9.6px] p-0.5 bg-vellum"
        >
          {INPUT_MODES.map((m) => {
            const active = inputMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setInputMode(m.value)}
                disabled={loading}
                className={`px-3 py-1.5 rounded-[7px] text-body-sm font-medium transition-colors
                            ${active ? "bg-azure/40 text-ink" : "text-graphite hover:bg-snow"}
                            disabled:opacity-50`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-caption text-dusty">
          {INPUT_MODES.find((m) => m.value === inputMode)?.hint}
        </p>
      </section>

      {/* 좌우 분할 입력 */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VariantInputCard
          accent="A"
          label={labelA}
          setLabel={setLabelA}
          text={textA}
          setText={setTextA}
          placeholder={placeholders.a}
          disabled={loading}
          tooShort={aLen > 0 && aLen < MIN_TEXT}
          tooLong={aLen > MAX_TEXT}
          isBaseline={baseline === "A"}
          onSelectBaseline={() => setBaseline("A")}
          challengerKind={challengerKind}
          onChallengerKindChange={setChallengerKind}
        />
        <VariantInputCard
          accent="B"
          label={labelB}
          setLabel={setLabelB}
          text={textB}
          setText={setTextB}
          placeholder={placeholders.b}
          disabled={loading}
          tooShort={bLen > 0 && bLen < MIN_TEXT}
          tooLong={bLen > MAX_TEXT}
          isBaseline={baseline === "B"}
          onSelectBaseline={() => setBaseline("B")}
          challengerKind={challengerKind}
          onChallengerKindChange={setChallengerKind}
        />
      </section>
      <p className="text-caption text-dusty -mt-2">
        기준안(당사 안)으로 지정한 쪽은 &lsquo;유지·보완&rsquo; 관점으로, 반대편은 도전안의 성격(당사 다른 상품 / 타사 상품)에 따라 다른 관점으로 분석됩니다.
      </p>

      {/* 라벨 중복 안내 */}
      {!labelsOk && labelA.trim() && labelB.trim() && labelA.trim() === labelB.trim() && (
        <p className="text-caption text-rose-600">
          A와 B의 별명을 다르게 지정해 주세요.
        </p>
      )}

      {/* Provider + 제출 */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-2">
        <LLMProviderToggle
          value={provider}
          onChange={handleProviderChange}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-[9.6px] bg-terra text-vellum text-body font-semibold transition
                     hover:bg-terra/90 active:scale-[0.98]
                     disabled:bg-stone disabled:text-vellum/70 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {loading ? (
            <>
              <Spinner /> 두 안 분석 중…
            </>
          ) : (
            "두 안 비교 분석 시작"
          )}
        </button>
      </div>

      {loading && (
        <p className="text-caption text-dusty text-center">
          A·B 두 안을 동시에 분석합니다. 30~60초 정도 걸립니다.
        </p>
      )}
    </form>
  );
}

function VariantInputCard({
  accent,
  label,
  setLabel,
  text,
  setText,
  placeholder,
  disabled,
  tooShort,
  tooLong,
  isBaseline,
  onSelectBaseline,
  challengerKind,
  onChallengerKindChange,
}: {
  accent: "A" | "B";
  label: string;
  setLabel: (v: string) => void;
  text: string;
  setText: (v: string) => void;
  placeholder: string;
  disabled: boolean;
  tooShort: boolean;
  tooLong: boolean;
  isBaseline: boolean;
  onSelectBaseline: () => void;
  /** 도전안 카드일 때만 사용되는 성격 토글 — 기준안 카드는 무시. */
  challengerKind: ABChallengerKind;
  onChallengerKindChange: (k: ABChallengerKind) => void;
}) {
  const len = text.length;
  // 기준안 카드는 좌측 4px 강조선 + 살짝 밝은 배경
  const cardClass = isBaseline
    ? "border-l-4 border-l-ink bg-snow/40"
    : "bg-vellum";
  return (
    <div
      className={`rounded-[9.6px] border border-parchment ${cardClass} p-4 flex flex-col gap-3 transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-body-sm font-bold
                        ${accent === "A" ? "bg-azure/30 text-ink" : "bg-terra/20 text-terra"}`}
          >
            {accent}
          </span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={disabled}
            maxLength={40}
            className="flex-1 min-w-0 px-2 py-1 rounded-[7px] border border-parchment bg-vellum text-body font-semibold text-ink focus:outline-none focus:border-azure focus:ring-2 focus:ring-azure/30"
            placeholder={`${accent}안 별명`}
            aria-label={`${accent}안 별명`}
          />
        </div>
        <span
          className={`text-caption shrink-0 ${
            tooLong ? "text-rose-600" : tooShort ? "text-amber-700" : "text-dusty"
          }`}
        >
          {len.toLocaleString()} / {MAX_TEXT.toLocaleString()}자
        </span>
      </div>

      {/* 기준안 / 도전안 성격 — 카드 1개에 두 줄 (기준안일 때 기준안 라디오, 도전안일 때 internal/external 토글) */}
      {isBaseline ? (
        <label
          className={`inline-flex items-center gap-2 cursor-default text-body-sm select-none
                      ${disabled ? "opacity-60" : ""}`}
        >
          <input
            type="radio"
            name="baseline-variant"
            checked
            readOnly
            disabled={disabled}
            className="w-4 h-4 accent-ink"
            aria-label={`${accent}안 — 당사 안(기준)`}
          />
          <span className="text-ink font-semibold">✓ 당사 안 (기준)</span>
        </label>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {/* 좌: 기준안으로 지정 버튼 */}
          <button
            type="button"
            onClick={onSelectBaseline}
            disabled={disabled}
            className={`inline-flex items-center gap-2 text-body-sm
                        text-graphite hover:text-ink hover:underline
                        ${disabled ? "opacity-60 cursor-not-allowed hover:no-underline" : ""}`}
          >
            <input
              type="radio"
              name="baseline-variant"
              checked={false}
              readOnly
              tabIndex={-1}
              disabled={disabled}
              className="w-4 h-4 accent-ink pointer-events-none"
              aria-hidden
            />
            <span>이 안을 당사 안(기준)으로 지정</span>
          </button>
          {/* 우: 도전안 성격 토글 */}
          <ChallengerKindToggle
            value={challengerKind}
            onChange={onChallengerKindChange}
            disabled={disabled}
          />
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full rounded-[7px] border border-parchment bg-vellum px-3 py-2 text-body text-ink placeholder:text-dusty focus:outline-none focus:border-azure focus:ring-2 focus:ring-azure/30 resize-y font-mono text-body-sm"
        maxLength={MAX_TEXT + 200}
      />
      {tooShort && (
        <p className="text-caption text-amber-700">
          최소 {MIN_TEXT}자 이상 입력해 주세요.
        </p>
      )}
    </div>
  );
}

/**
 * 도전안 성격 토글 — internal(당사 다른 상품) / external(타사 상품).
 * 도전안 카드(=기준안이 아닌 쪽)에만 노출. baseline이 바뀌어도 값은 유지(상위 state).
 */
function ChallengerKindToggle({
  value,
  onChange,
  disabled,
}: {
  value: ABChallengerKind;
  onChange: (v: ABChallengerKind) => void;
  disabled: boolean;
}) {
  const options: { value: ABChallengerKind; label: string; hint: string }[] = [
    { value: "internal", label: "당사 다른 상품", hint: "내부 포트폴리오 비교" },
    { value: "external", label: "타사 상품", hint: "경쟁 분석" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-overline text-graphite">도전안 성격</span>
      <div
        role="radiogroup"
        aria-label="도전안 성격"
        className="inline-flex border border-parchment rounded-[7px] overflow-hidden bg-vellum"
      >
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              disabled={disabled}
              title={opt.hint}
              className={`px-2.5 py-1 border-r border-parchment last:border-r-0 text-caption font-medium transition-colors
                          ${active ? "bg-ink text-vellum" : "text-graphite hover:bg-snow"}
                          disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
