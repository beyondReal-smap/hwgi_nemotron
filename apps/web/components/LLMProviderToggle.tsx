"use client";

import {
  LLM_PROVIDER_OPTIONS,
  loadLLMProvider,
  saveLLMProvider,
  type LLMProvider,
} from "@/lib/api";
import { useEffect, useState } from "react";

type Props = {
  value?: LLMProvider;
  onChange?: (p: LLMProvider) => void;
  disabled?: boolean;
  /** 라벨을 컴팩트하게 — 좁은 공간(SurveyPanel)에서 사용 */
  compact?: boolean;
};

/** LLM provider 선택 토글. value/onChange 외부 제어 또는 자체 localStorage 동기화 모두 지원. */
export function LLMProviderToggle({
  value,
  onChange,
  disabled,
  compact = false,
}: Props) {
  // 외부 제어가 없으면 localStorage 기반 자체 state
  const [internal, setInternal] = useState<LLMProvider>("sllm");
  useEffect(() => {
    if (value === undefined) setInternal(loadLLMProvider());
  }, [value]);

  const current = value ?? internal;
  const apply = (p: LLMProvider) => {
    if (onChange) {
      onChange(p);
    } else {
      setInternal(p);
      saveLLMProvider(p);
    }
  };

  return (
    <div>
      {!compact && (
        <span className="block text-overline text-graphite mb-2">LLM 제공자</span>
      )}
      <div
        role="radiogroup"
        aria-label="LLM 제공자"
        className="inline-flex border border-parchment rounded-[9.6px] overflow-hidden bg-vellum"
      >
        {LLM_PROVIDER_OPTIONS.map((opt) => {
          const active = current === opt.value;
          return (
            <button
              type="button"
              key={opt.value}
              role="radio"
              aria-checked={active}
              onClick={() => apply(opt.value)}
              disabled={disabled}
              className={`px-3 ${compact ? "py-1" : "py-1.5"} border-r border-parchment last:border-r-0 transition-colors text-left
                          ${
                            active
                              ? "bg-azure/40 text-ink"
                              : "bg-vellum text-graphite hover:bg-snow"
                          }
                          disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <p
                className={`${compact ? "text-caption" : "text-body-sm"} font-semibold leading-tight`}
              >
                {opt.label}
              </p>
              {!compact && (
                <p className="text-overline text-stone mt-0.5 leading-tight">
                  {opt.sub}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
