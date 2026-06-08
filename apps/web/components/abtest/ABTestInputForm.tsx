"use client";

import { useState } from "react";
import { HwgiProductPicker } from "@/components/HwgiProductPicker";
import {
  runABTest,
  type ABChallengerKind,
  type ABTestInputMode,
  type ABTestResponse,
} from "@/lib/api";

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
- 한화 그룹 시너지(여행·건강·생활 멤버십) 연계 가능.

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
      a: '예) "여성의 모든 순간을 — 한화손보 시그니처 여성건강 4.0"',
      b: '예) "운전이 즐거워지는 보험 — 한화손보 캐롯 퍼마일"',
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
        top_k: 50,
      });
      onResult(r);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // 입력 모드 변경 시 두 안의 텍스트·라벨을 초기화한다.
  // 모드별 입력 성격(약관 전문 / 마케팅 카피 / 컨셉 요약)이 완전히 달라
  // 이전 모드에서 입력한 내용은 새 모드에서 의미가 없기 때문.
  // 라벨도 약관 모드에서 상품 선택 시 상품명으로 채워지므로 함께 초기화한다.
  // 같은 모드를 다시 누른 경우엔 초기화하지 않는다.
  function handleInputModeChange(mode: ABTestInputMode) {
    if (mode === inputMode) return;
    setInputMode(mode);
    setLabelA("안 A");
    setLabelB("안 B");
    setTextA("");
    setTextB("");
  }

  const placeholders = getPlaceholders(inputMode);

  return (
    <form onSubmit={handleSubmit}>
      <div className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
        {/* 제목 헤더 — 분석·설문 등 다른 탭 카드와 동일한 bg-snow 흰색 띠로 통일 */}
        <header className="bg-snow border-b border-parchment px-5 py-4">
          <h2 className="text-title text-ink">비교할 두 안 입력</h2>
          <p className="text-body-sm text-dusty mt-1.5">
            기준안(당사)과 도전안을 입력하면 동일 모집단 페르소나 반응을 비교합니다.
          </p>
        </header>
        <div className="space-y-5 p-5">
      {/* 당사 정보 */}
      <section className="rounded-[9.6px] border border-parchment bg-snow/40 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <label htmlFor="company-context" className="text-overline text-graphite">
            당사 정보 (장단점·전략의 기준)
          </label>
          <span
            className={`text-caption num-tabular ${
              companyLen > MAX_COMPANY
                ? "text-terra font-medium"
                : companyOk
                  ? "text-ink"
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
                onClick={() => handleInputModeChange(m.value)}
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

      {/* 도전안 성격 — 기준안(당사)이 아닌 쪽 안을 어떤 관점으로 비교할지. 두 안 공통 설정이라
          카드 밖에 두어 A·B 입력 카드를 좌우 대칭으로 유지(입력란 시작선 정렬). */}
      <section>
        <ChallengerKindToggle
          value={challengerKind}
          onChange={setChallengerKind}
          disabled={loading}
        />
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
          inputMode={inputMode}
          onError={onError}
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
          inputMode={inputMode}
          onError={onError}
        />
      </section>
      <p className="text-caption text-dusty -mt-2">
        기준안(당사 안)으로 지정한 쪽은 &lsquo;유지·보완&rsquo; 관점으로, 반대편은 도전안의 성격(당사 다른 상품 / 타사 상품)에 따라 다른 관점으로 분석됩니다.
      </p>

      {/* 라벨 중복 안내 */}
      {!labelsOk && labelA.trim() && labelB.trim() && labelA.trim() === labelB.trim() && (
        <p className="text-caption text-terra font-medium" aria-live="polite" aria-atomic="true">
          A와 B의 별명을 다르게 지정해 주세요.
        </p>
      )}

      {/* 제출 */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-end gap-3 pt-2">
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
        </div>
      </div>
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
  inputMode,
  onError,
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
  /** 약관 PDF 드롭다운 노출 조건(showProductPicker) 판단용 — 토글 UI는 카드 밖 공통 영역으로 이동. */
  challengerKind: ABChallengerKind;
  /** 약관 모드에서 당사 약관 PDF 드롭다운 노출 여부 판단용. */
  inputMode: ABTestInputMode;
  onError: (msg: string | null) => void;
}) {
  // 약관 모드 + (당사 안(기준) 또는 도전안이 '당사 다른 상품')일 때만 약관 PDF 드롭다운 노출.
  // 타사 상품(external)은 insurance/ 폴더에 약관이 없으므로 숨김.
  const showProductPicker =
    inputMode === "terms" && (isBaseline || challengerKind === "internal");
  const len = text.length;
  // 기준안 카드는 좌측 강조선 대신 살짝 밝은 배경으로 구분 ("당사 안" 라벨이 보강)
  const cardClass = isBaseline ? "bg-snow/40" : "bg-vellum";
  return (
    <div
      className={`rounded-[9.6px] border border-parchment ${cardClass} p-4 flex flex-col gap-3 transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-body-sm font-bold
                        ${accent === "A" ? "bg-marine/20 text-marine" : "bg-terra/20 text-terra"}`}
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
          className={`text-caption shrink-0 num-tabular ${
            tooLong ? "text-terra font-medium" : tooShort ? "text-dusty font-medium" : "text-dusty"
          }`}
        >
          {len.toLocaleString()} / {MAX_TEXT.toLocaleString()}자
        </span>
      </div>

      {/* 기준안 지정 — 양쪽 카드 모두 '라디오 한 줄' 동일 구조라 A·B 입력란 시작선이 정렬됨.
          도전안 성격(당사 다른 상품/타사 상품)은 카드 밖 공통 토글에서 설정. */}
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
            className={`w-4 h-4 ${accent === "A" ? "accent-marine" : "accent-terra"}`}
            aria-label={`${accent}안 — 당사 안(기준)`}
          />
          <span
            className={`font-semibold ${accent === "A" ? "text-marine" : "text-terra"}`}
          >
            ✓ 당사 안 (기준)
          </span>
        </label>
      ) : (
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
      )}
      {showProductPicker && (
        <HwgiProductPicker
          disabled={disabled}
          onError={onError}
          onPick={({ text: body, label, productId }) => {
            setText(body);
            // 별명에는 상품명만(해시 id 제외) 채워 비교표 가독성 유지
            setLabel(label.replace(` (${productId})`, "").trim());
          }}
        />
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full rounded-[7px] border border-parchment bg-vellum px-3 py-2 text-body text-ink placeholder:text-dusty focus:outline-none focus:border-azure focus:ring-2 focus:ring-azure/30 resize-y font-mono text-body-sm"
        maxLength={MAX_TEXT + 200}
        aria-invalid={tooShort || tooLong}
        aria-describedby={tooShort ? `variant-${accent}-error` : undefined}
      />
      {tooShort && (
        <p id={`variant-${accent}-error`} className="text-caption text-graphite" aria-live="polite" aria-atomic="true">
          <span className="text-terra font-medium">!</span> 최소 {MIN_TEXT}자 이상 입력해 주세요.
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
