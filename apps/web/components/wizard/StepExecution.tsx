"use client";

import { useMemo } from "react";
import type { LLMProvider } from "@/lib/api";
import type { WizardState } from "./types";

/**
 * Step 4 — 실행 설정.
 *
 * 입력:
 *  - LLM provider (anthropic / sllm)
 *  - 모델 select (provider별 옵션)
 *  - temperature slider (0 ~ 2)
 *  - include_reasoning 토글
 *
 * 출력:
 *  - 예상 호출 수 = personas × questions
 *  - 예상 토큰 = 호출 수 × (300 input + 100 output)
 *  - 예상 비용 = 모델별 단가
 */

// 사내 sLLM(Qwen)을 기본·우선. 첫 항목이 각 provider의 기본 선택.
const MODELS: Record<LLMProvider, { value: string; label: string; input_per_mtok: number; output_per_mtok: number }[]> = {
  sllm: [
    { value: "Qwen3.6-27B-FP8", label: "Qwen3.6-27B-FP8 (사내 vLLM · 무료 · 기본)", input_per_mtok: 0, output_per_mtok: 0 },
  ],
  anthropic: [
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (빠름·저렴)", input_per_mtok: 0.8, output_per_mtok: 4.0 },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (균형)", input_per_mtok: 3.0, output_per_mtok: 15.0 },
  ],
};

const INPUT_TOKENS_PER_CALL = 300;
const OUTPUT_TOKENS_PER_CALL = 100;

export function StepExecution({
  state,
  setState,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
}) {
  function patch(p: Partial<WizardState["execution"]>) {
    setState({ ...state, execution: { ...state.execution, ...p } });
  }

  const totalCalls = state.targets.preview_persona_uuids.length * state.questions.length;

  const model = useMemo(
    () =>
      MODELS[state.execution.llm_provider].find((m) => m.value === state.execution.model) ??
      MODELS[state.execution.llm_provider][0],
    [state.execution.llm_provider, state.execution.model],
  );

  const inputTokens = totalCalls * INPUT_TOKENS_PER_CALL;
  const outputTokens = totalCalls * OUTPUT_TOKENS_PER_CALL;
  const totalTokens = inputTokens + outputTokens;
  const costUsd =
    (inputTokens / 1_000_000) * model.input_per_mtok +
    (outputTokens / 1_000_000) * model.output_per_mtok;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* 좌측: 실행 설정 */}
      <div className="flex flex-col gap-4">
        {/* Provider */}
        <SubCard title="LLM Provider">
          <fieldset className="flex flex-col gap-2">
            {(["sllm", "anthropic"] as LLMProvider[]).map((p) => (
              <label key={p} className="flex items-center gap-2 cursor-pointer text-body-sm">
                <input
                  type="radio"
                  name="provider"
                  checked={state.execution.llm_provider === p}
                  onChange={() =>
                    patch({
                      llm_provider: p,
                      model: MODELS[p][0].value,
                    })
                  }
                  className="accent-terra"
                />
                <span className={state.execution.llm_provider === p ? "text-ink font-medium" : "text-graphite"}>
                  {p === "sllm" ? "사내 sLLM (Qwen) · 기본" : "Anthropic Claude"}
                </span>
              </label>
            ))}
          </fieldset>
        </SubCard>

        {/* 모델 select */}
        <SubCard title="모델">
          <select
            value={state.execution.model}
            onChange={(e) => patch({ model: e.target.value })}
            className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                       text-body-sm text-ink focus:outline-none focus:ring-2 focus:ring-azure"
          >
            {MODELS[state.execution.llm_provider].map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="text-caption text-dusty mt-2 tabular-nums">
            단가: input ${model.input_per_mtok.toFixed(2)} / 1M tok · output $
            {model.output_per_mtok.toFixed(2)} / 1M tok
          </p>
        </SubCard>

        {/* Temperature */}
        <SubCard
          title="Temperature"
          sub="높을수록 다양한 응답, 낮을수록 일관성"
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={state.execution.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
              className="flex-1 accent-terra"
            />
            <span className="text-body-sm text-ink font-mono tabular-nums w-12 text-right">
              {state.execution.temperature.toFixed(1)}
            </span>
          </div>
          <div className="flex justify-between text-caption text-dusty mt-1">
            <span>일관 (0)</span>
            <span>균형 (0.7)</span>
            <span>발산 (2)</span>
          </div>
        </SubCard>

        {/* Reasoning */}
        <SubCard title="추론 근거 포함">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={state.execution.include_reasoning}
              onChange={(e) => patch({ include_reasoning: e.target.checked })}
              className="accent-terra"
            />
            <span className="text-body-sm text-graphite">
              각 답변마다 50자 이내 근거 reasoning 함께 생성
            </span>
          </label>
        </SubCard>
      </div>

      {/* 우측: 비용 산출 */}
      <div className="flex flex-col gap-4">
        <SubCard title="예상 비용 산출">
          {totalCalls === 0 ? (
            <p className="text-caption text-graphite bg-terra/10 border border-terra/30 rounded px-3 py-2">
              ⚠ 대상자(Step 2)와 질문(Step 3)을 먼저 확정하세요
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-body-sm">
              <dt className="text-dusty">대상 페르소나</dt>
              <dd className="text-ink text-right font-mono tabular-nums">
                {state.targets.preview_persona_uuids.length.toLocaleString()}명
              </dd>

              <dt className="text-dusty">질문 수</dt>
              <dd className="text-ink text-right font-mono tabular-nums">
                {state.questions.length}개
              </dd>

              <dt className="text-dusty">총 LLM 호출</dt>
              <dd className="text-ink text-right font-mono tabular-nums font-medium">
                {totalCalls.toLocaleString()}회
              </dd>

              <dt className="text-dusty col-span-2 border-t border-parchment pt-2 mt-1">
                토큰 사용량 (추정)
              </dt>

              <dt className="text-dusty">입력</dt>
              <dd className="text-graphite text-right font-mono tabular-nums">
                {inputTokens.toLocaleString()} tok
              </dd>

              <dt className="text-dusty">출력</dt>
              <dd className="text-graphite text-right font-mono tabular-nums">
                {outputTokens.toLocaleString()} tok
              </dd>

              <dt className="text-dusty">합계</dt>
              <dd className="text-ink text-right font-mono tabular-nums">
                {totalTokens.toLocaleString()} tok
              </dd>

              <dt className="text-dusty col-span-2 border-t border-parchment pt-2 mt-1">
                예상 비용
              </dt>
              <dt className="text-ink font-medium">USD</dt>
              <dd className="text-terra text-right font-mono tabular-nums font-semibold">
                ${costUsd.toFixed(4)}
              </dd>
              <dt className="text-ink font-medium">KRW (≈)</dt>
              <dd className="text-terra text-right font-mono tabular-nums font-semibold">
                ₩{(costUsd * 1380).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </dd>
            </dl>
          )}

          <p className="text-caption text-dusty mt-3 pt-3 border-t border-parchment">
            추정 가정: 호출당 입력 {INPUT_TOKENS_PER_CALL} tok + 출력{" "}
            {OUTPUT_TOKENS_PER_CALL} tok. 실제 토큰은 ±30% 범위에서 변동할 수 있습니다.
            동일 (페르소나·질문·모델) 조합은 캐싱되어 재실행 시 비용 0.
          </p>
        </SubCard>

        <SubCard title="요약">
          <ul className="text-body-sm text-graphite space-y-1">
            <li>
              <strong className="text-ink">제목:</strong> {state.basic.title || "—"}
            </li>
            <li>
              <strong className="text-ink">대상:</strong>{" "}
              {state.targets.preview_persona_uuids.length.toLocaleString()}명
            </li>
            <li>
              <strong className="text-ink">질문:</strong> {state.questions.length}개
            </li>
            <li>
              <strong className="text-ink">모델:</strong> {model.label}
            </li>
          </ul>
        </SubCard>
      </div>
    </div>
  );
}

function SubCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden">
      <header className="px-4 py-2.5 border-b border-parchment">
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {sub && <p className="text-caption text-dusty mt-0.5">{sub}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
