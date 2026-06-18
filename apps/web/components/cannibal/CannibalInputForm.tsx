"use client";

import { useState } from "react";
import { HwgiProductPicker } from "@/components/HwgiProductPicker";
import {
  runCannibalization,
  type ABTestInputMode,
  type CannibalCohortLevel,
  type CannibalResponse,
} from "@/lib/api";

type Props = {
  onResult: (r: CannibalResponse) => void;
  onError: (msg: string | null) => void;
  loading: boolean;
  setLoading: (b: boolean) => void;
};

const MIN_TEXT = 20;
const MAX_TEXT = 20_000;
const MIN_ITEMS = 2;
const MAX_ITEMS = 8;

type Item = { label: string; text: string };

// A/B 테스트(ABTestInputForm)와 동일한 순서로 통일.
const INPUT_MODES: { value: ABTestInputMode; label: string; hint: string }[] = [
  { value: "terms", label: "약관·상품설명서", hint: "보장·면책·가입 조건 등 전문(全文)" },
  { value: "marketing", label: "마케팅 카피", hint: "광고 카피·헤드라인 등 짧은 문구" },
  { value: "concept", label: "컨셉 + 보장 요약", hint: "신상품 기획 초기 — 타겟·핵심 보장 요약본" },
];

const COHORT_LEVELS: { value: CannibalCohortLevel; label: string; hint: string }[] = [
  { value: "core", label: "핵심층 (≥81)", hint: "가장 강하게 반응한 좁은 층 — 선명하나 인원 적음" },
  { value: "target", label: "타겟층 (≥73)", hint: "넓은 반응층 — 안정적 겹침(권장)" },
  { value: "interest", label: "관심층 (≥68)", hint: "가장 넓은 층 — 겹침이 전반적으로 커짐" },
];

function labelFor(idx: number): string {
  return `안 ${String.fromCharCode(65 + idx)}`; // 안 A, 안 B, ...
}

function placeholderFor(mode: ABTestInputMode): string {
  if (mode === "marketing") return '예) "여성의 모든 순간을 — 한화손보 시그니처 여성건강 4.0"';
  if (mode === "terms") return "예) 약관 본문을 붙여 넣으세요 — 보장 내용, 면책 사항, 가입 조건 등";
  return "예) 40대 가장 타겟. 사망 1억 + 암 진단비 3천만, 비흡연 20% 할인. 월 8만원대";
}

export function CannibalInputForm({ onResult, onError, loading, setLoading }: Props) {
  const [inputMode, setInputMode] = useState<ABTestInputMode>("terms");
  const [cohortLevel, setCohortLevel] = useState<CannibalCohortLevel>("target");
  const [items, setItems] = useState<Item[]>([
    { label: "안 A", text: "" },
    { label: "안 B", text: "" },
  ]);

  // 입력 모드 변경 시 각 안의 본문 초기화 (모드별 입력 성격이 완전히 달라 이전 내용 무의미).
  // A/B 폼과 동일 정책. 같은 모드 재선택 시엔 유지.
  function handleInputModeChange(mode: ABTestInputMode) {
    if (mode === inputMode) return;
    setInputMode(mode);
    setItems((prev) => prev.map((it) => ({ ...it, text: "" })));
  }

  function addItem() {
    if (items.length >= MAX_ITEMS) return;
    setItems((prev) => [...prev, { label: labelFor(prev.length), text: "" }]);
  }
  function removeItem(idx: number) {
    if (items.length <= MIN_ITEMS) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const trimmedLabels = items.map((it) => it.label.trim());
  const labelsFilled = trimmedLabels.every((l) => l.length > 0);
  const labelsUnique = new Set(trimmedLabels).size === items.length;
  const textsOk = items.every((it) => {
    const len = it.text.trim().length;
    return len >= MIN_TEXT && len <= MAX_TEXT;
  });
  const canSubmit = labelsFilled && labelsUnique && textsOk && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    onError(null);
    try {
      const r = await runCannibalization({
        items: items.map((it) => ({ label: it.label.trim(), text: it.text.trim() })),
        input_mode: inputMode,
        cohort_level: cohortLevel,
        llm_provider: "sllm",
      });
      onResult(r);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const placeholder = placeholderFor(inputMode);

  return (
    <form onSubmit={handleSubmit}>
      <div className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden">
        <header className="bg-snow border-b border-parchment px-5 py-4">
          <h2 className="text-title text-ink">비교할 안 입력 (2~8개)</h2>
          <p className="text-body-sm text-dusty mt-1.5">
            여러 안을 동일 모집단에 스코어링해, 안끼리 반응층이 얼마나 겹치는지 행렬로 비교합니다.
          </p>
        </header>

        <div className="space-y-5 p-5">
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

          {/* 코호트 레벨 */}
          <section>
            <span className="block text-overline text-graphite mb-2">겹침 산출 기준 (반응층)</span>
            <div
              role="radiogroup"
              aria-label="코호트 레벨"
              className="inline-flex border border-parchment rounded-[7px] overflow-hidden bg-vellum"
            >
              {COHORT_LEVELS.map((c) => {
                const active = cohortLevel === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setCohortLevel(c.value)}
                    disabled={loading}
                    title={c.hint}
                    className={`px-2.5 py-1 border-r border-parchment last:border-r-0 text-caption font-medium transition-colors
                                ${active ? "bg-ink text-vellum" : "text-graphite hover:bg-snow"}
                                disabled:opacity-50`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-caption text-dusty">
              {COHORT_LEVELS.find((c) => c.value === cohortLevel)?.hint}
            </p>
          </section>

          {/* 안 카드 리스트 */}
          <section className="space-y-3">
            {items.map((item, idx) => {
              const len = item.text.trim().length;
              const tooShort = len > 0 && len < MIN_TEXT;
              const tooLong = len > MAX_TEXT;
              return (
                <div
                  key={idx}
                  className="rounded-[9.6px] border border-parchment bg-vellum p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => updateItem(idx, { label: e.target.value })}
                      disabled={loading}
                      maxLength={40}
                      className="flex-1 min-w-0 px-2 py-1 rounded-[7px] border border-parchment bg-vellum text-body font-semibold text-ink focus:outline-none focus:border-azure focus:ring-2 focus:ring-azure/30"
                      placeholder={`${idx + 1}번 안 별명`}
                      aria-label={`${idx + 1}번 안 별명`}
                    />
                    <span
                      className={`text-caption shrink-0 num-tabular ${
                        tooLong ? "text-terra font-medium" : "text-dusty"
                      }`}
                    >
                      {len.toLocaleString()} / {MAX_TEXT.toLocaleString()}자
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      disabled={loading || items.length <= MIN_ITEMS}
                      className="shrink-0 px-2 py-1 rounded-[7px] text-caption text-graphite hover:text-terra hover:bg-snow disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label={`${idx + 1}번 안 삭제`}
                      title={items.length <= MIN_ITEMS ? "최소 2개 안이 필요합니다" : "이 안 삭제"}
                    >
                      삭제
                    </button>
                  </div>
                  {/* 약관 모드: 당사 보험약관 PDF 드롭다운 (A/B 테스트와 동일 기능) */}
                  {inputMode === "terms" && (
                    <HwgiProductPicker
                      disabled={loading}
                      onError={onError}
                      onPick={({ text: body, label, productId }) =>
                        updateItem(idx, {
                          text: body,
                          // 별명에는 상품명만(해시 id 제외) 채워 가독성 유지
                          label: label.replace(` (${productId})`, "").trim(),
                        })
                      }
                    />
                  )}
                  <textarea
                    value={item.text}
                    onChange={(e) => updateItem(idx, { text: e.target.value })}
                    rows={6}
                    disabled={loading}
                    placeholder={placeholder}
                    className="w-full rounded-[7px] border border-parchment bg-vellum px-3 py-2 text-body text-ink placeholder:text-dusty focus:outline-none focus:border-azure focus:ring-2 focus:ring-azure/30 resize-y font-mono text-body-sm"
                    maxLength={MAX_TEXT + 200}
                    aria-invalid={tooShort || tooLong}
                  />
                  {tooShort && (
                    <p className="text-caption text-graphite" aria-live="polite">
                      <span className="text-terra font-medium">!</span> 최소 {MIN_TEXT}자 이상 입력해 주세요.
                    </p>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={addItem}
              disabled={loading || items.length >= MAX_ITEMS}
              className="w-full py-2.5 rounded-[9.6px] border border-dashed border-parchment text-body-sm font-medium text-graphite hover:text-ink hover:bg-snow disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              + 안 추가 {items.length >= MAX_ITEMS ? "(최대 8개)" : `(${items.length}/${MAX_ITEMS})`}
            </button>
          </section>

          {/* 라벨 중복 안내 */}
          {!labelsUnique && (
            <p className="text-caption text-terra font-medium" aria-live="polite">
              안의 별명을 서로 다르게 지정해 주세요.
            </p>
          )}

          {/* 제출 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-[9.6px] bg-terra text-vellum text-body font-semibold transition
                         hover:bg-terra/90 active:scale-[0.98]
                         disabled:bg-stone disabled:text-vellum/70 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {loading ? (
                <>
                  <Spinner /> {items.length}개 안 분석 중…
                </>
              ) : (
                "겹침 행렬 분석 시작"
              )}
            </button>
          </div>

          {loading && (
            <p className="text-caption text-dusty text-center">
              각 안을 동시에 스코어링합니다. 안 개수에 따라 30~90초 정도 걸립니다.
            </p>
          )}
        </div>
      </div>
    </form>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
