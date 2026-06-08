"use client";

import { useCallback, useEffect, useState } from "react";

// 서버 프록시(/admind/cfg)가 .env의 ADMIN_TOKEN을 자동 주입한다 — 클라이언트는 토큰을 모른다.
type AdminLlmConfig = {
  provider: string;
  openai_model: string;
  valid_providers: string[];
  suggested_openai_models: string[];
};

const PROVIDER_LABEL: Record<string, string> = {
  sllm: "사내 sLLM (vLLM·무료)",
  openai: "OpenAI (상용·길이 제한 해제)",
  anthropic: "Anthropic Claude",
};

const CFG_URL = "/admind/cfg";

export default function AdminLlmPage() {
  const [config, setConfig] = useState<AdminLlmConfig | null>(null);
  const [provider, setProvider] = useState("sllm");
  const [openaiModel, setOpenaiModel] = useState("gpt-5.4");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(CFG_URL, { cache: "no-store" });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.detail || `HTTP ${r.status}`);
      }
      const cfg: AdminLlmConfig = await r.json();
      setConfig(cfg);
      setProvider(cfg.provider);
      setOpenaiModel(cfg.openai_model);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch(CFG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, openai_model: openaiModel }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.detail || `HTTP ${r.status}`);
      }
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-vellum text-ink p-6 lg:p-10">
      <div className="max-w-xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1.5">
          <p className="text-overline text-dusty">관리자</p>
          <h1 className="text-display text-ink tracking-tight">LLM 설정</h1>
          <p className="text-body-sm text-graphite">
            서버 전역 LLM provider/모델을 선택합니다. 분석·설문·A/B·총평·페르소나 응답 등
            모든 LLM 호출에 즉시 적용됩니다.
          </p>
        </header>

        {error && (
          <p role="alert" className="text-caption text-ink bg-terra/10 border border-terra/30 rounded-[9.6px] px-3 py-2">
            {error}
          </p>
        )}

        {loading && !config && (
          <p className="text-body-sm text-graphite">설정을 불러오는 중…</p>
        )}

        {config && (
          <section className="bg-snow border border-parchment rounded-[9.6px] p-4 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-body font-medium text-ink">Provider</span>
              {config.valid_providers.map((p) => (
                <label key={p} className="flex items-center gap-2 cursor-pointer text-body-sm text-graphite">
                  <input
                    type="radio"
                    name="provider"
                    value={p}
                    checked={provider === p}
                    onChange={() => setProvider(p)}
                    className="accent-terra"
                  />
                  <span>{PROVIDER_LABEL[p] ?? p}</span>
                </label>
              ))}
            </div>

            {provider === "openai" && (
              <div className="flex flex-col gap-2">
                <span className="text-body font-medium text-ink">OpenAI 모델</span>
                <select
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  className="w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                             text-body-sm text-ink focus:outline-none focus:ring-2 focus:ring-azure"
                >
                  {config.suggested_openai_models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <p className="text-caption text-dusty">
                  OpenAI 호출 시 입력 truncate·출력 토큰 제한 없이 충실한 결과를 생성합니다(토큰 비용 증가).
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-parchment">
              <p className="text-caption text-graphite">
                현재 적용: <span className="font-mono text-ink">{config.provider}</span>
                {config.provider === "openai" && (
                  <span className="font-mono text-ink"> · {config.openai_model}</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => void save()}
                disabled={loading}
                className="px-4 py-2 text-body-sm font-medium text-snow bg-ink rounded-[9.6px]
                           hover:bg-onyx active:bg-graphite transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? "저장 중…" : "저장 (전역 적용)"}
              </button>
            </div>
            {saved && <p className="text-caption text-success">✓ 저장되어 전역 적용되었습니다.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
