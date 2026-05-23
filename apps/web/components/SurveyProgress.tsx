"use client";

import { useState } from "react";
import {
  retryFailedSessions,
  triggerSurveyRun,
  type SurveyStatusResponse,
} from "@/lib/api";

/**
 * 설문 진행 모니터링 — /surveys/:id/progress 페이지의 핵심 위젯.
 *
 * 구성:
 *  - SectionCard 헤더 + sub
 *  - 진행 바 (terra) + 카운터
 *  - 통계 4 카드 (평균 응답 / 누적 토큰 / 완료 / 실패)
 *  - 실패 페르소나 목록 + "재시도" 버튼
 */
export function SurveyProgress({
  status,
  onRetried,
}: {
  status: SurveyStatusResponse;
  onRetried: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  // 진행 바: 문항 단위(즉각 반영). 페르소나 단위(completed_ratio)는 보조 표시.
  const pct = status.answered_ratio * 100;
  const inflight = status.counts.running + status.counts.pending;

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    setRetryNotice(null);
    try {
      const r = await retryFailedSessions(status.survey_id);
      if (r.status === "noop") {
        setRetryNotice("재시도할 실패 항목이 없습니다");
      } else {
        setRetryNotice(`${r.retry_count}명 재시도 시작`);
        onRetried();
      }
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  /** 강제 재시작 — 백그라운드 작업이 끊겨 stuck running 상태일 때 복구. */
  async function handleForceRestart() {
    if (!window.confirm(
      "진행이 멈췄을 때만 사용하세요.\n\n" +
      "이미 완료된 응답은 보존되고 (캐시 활용), 미완료/멈춘 세션만 다시 시작합니다. 계속하시겠습니까?",
    )) return;

    setRetrying(true);
    setRetryError(null);
    setRetryNotice(null);
    try {
      const r = await triggerSurveyRun(status.survey_id, { force: true });
      setRetryNotice(
        `${r.reset}명 다시 시작 · 완료 ${r.completed_preserved}명 보존 (캐시 활용)`,
      );
      onRetried();
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  // pm2 재시작 등으로 background task가 끊긴 정황 감지:
  // status가 running인데 일정 시간 동안 답변이 늘지 않으면 사용자에게 "강제 재시작" 권장.
  const isStuck =
    status.survey_status === "running" &&
    status.counts.completed + status.counts.failed === 0 &&
    status.counts.running > 0 &&
    status.total_tokens === 0;

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title text-ink">진행 현황</h2>
          <StatusBadge status={status.survey_status} />
        </div>
        <p className="text-body-sm text-dusty mt-1">
          총{" "}
          <span className="font-mono text-graphite">
            {status.total.toLocaleString()}
          </span>
          명 대상 · 완료{" "}
          <span className="font-mono text-graphite">
            {status.counts.completed.toLocaleString()}
          </span>
          {inflight > 0 && (
            <>
              {" · 진행 중 "}
              <span className="font-mono text-terra">{inflight}</span>
            </>
          )}
          {status.counts.failed > 0 && (
            <>
              {" · 실패 "}
              <span className="font-mono text-terra">
                {status.counts.failed}
              </span>
            </>
          )}
          {status.total_planned_answers > 0 && (
            <>
              {" · 응답 문항 "}
              <span className="font-mono text-graphite">
                {status.answered_questions.toLocaleString()}
              </span>
              <span className="text-stone">
                /{status.total_planned_answers.toLocaleString()}
              </span>
            </>
          )}
        </p>
      </header>

      <div className="p-5 flex flex-col gap-5">
        {/* Stuck 경고 — pm2 재시작 등으로 백그라운드 작업 끊긴 정황 */}
        {isStuck && (
          <div className="bg-terra/10 border border-terra/30 rounded-[9.6px] px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-ink">
                ⚠ 진행이 멈춘 것 같습니다
              </p>
              <p className="text-caption text-graphite mt-0.5">
                서버 재시작 등으로 백그라운드 작업이 끊겼을 수 있습니다.
                완료된 응답은 보존하고 멈춘 세션만 다시 시작합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={handleForceRestart}
              disabled={retrying}
              className="px-3 py-1.5 text-caption font-medium text-snow bg-ink rounded-[9.6px]
                         hover:bg-onyx active:bg-graphite transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {retrying ? "재시작 중…" : "강제 재시작"}
            </button>
          </div>
        )}

        {/* 진행 바 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-caption">
              {status.survey_status === "running" && (
                <span className="text-terra font-medium animate-pulse flex items-center gap-1">
                  ⚡ AI 페르소나가 상품 검토 및 응답 작성 중...
                </span>
              )}
            </span>
          </div>
          <div className="h-3 bg-parchment rounded-full overflow-hidden relative">
            {status.survey_status === "running" && (
              <style>{`
                @keyframes shimmerProgress {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(100%); }
                }
                .shimmer-overlay {
                  animation: shimmerProgress 1.5s infinite linear;
                  background: linear-gradient(
                    90deg,
                    transparent,
                    rgba(255, 255, 255, 0.45) 50%,
                    transparent
                  );
                }
              `}</style>
            )}
            <div
              className="h-full bg-terra transition-all duration-500 relative overflow-hidden"
              style={{ width: `${Math.max(1.5, pct)}%` }}
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {status.survey_status === "running" && (
                <div className="absolute inset-0 shimmer-overlay" />
              )}
            </div>
          </div>
          <p className="text-caption text-graphite mt-2 tabular-nums flex justify-between items-center">
            <span className="text-caption text-dusty">
              {status.survey_status === "running" ? "⚡ 실시간으로 토큰 사용량과 응답 진행률이 즉시 갱신되고 있습니다" : ""}
            </span>
            <span>
              <span className="font-mono font-semibold text-ink">{pct.toFixed(1)}%</span> 완료
            </span>
          </p>
        </div>

        {/* 통계 4 카드 */}
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="평균 응답 시간"
            value={
              status.avg_response_seconds !== null
                ? status.avg_response_seconds.toFixed(1)
                : "—"
            }
            suffix="초"
          />
          <Stat
            label="누적 토큰"
            value={status.total_tokens.toLocaleString()}
            suffix="tok"
          />
          <Stat
            label="완료"
            value={status.counts.completed.toLocaleString()}
            suffix="명"
          />
          <Stat
            label="실패"
            value={status.counts.failed.toLocaleString()}
            suffix="명"
            highlight={status.counts.failed > 0 ? "terra" : undefined}
          />
        </ul>

        {/* 재시도 알림 */}
        {(retryError || retryNotice) && (
          <p
            className={`text-caption px-3 py-2 rounded-[9.6px] border ${
              retryError
                ? "text-ink bg-terra/10 border-terra/30"
                : "text-ink bg-azure/20 border-azure"
            }`}
          >
            {retryError ?? retryNotice}
          </p>
        )}

        {/* 실패 페르소나 목록 */}
        {status.failed_personas.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-body font-medium text-ink">
                실패 페르소나 ({status.counts.failed}명)
              </h3>
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying || status.survey_status === "running"}
                className="px-3 py-1.5 text-caption font-medium text-snow bg-ink rounded-[9.6px]
                           hover:bg-onyx active:bg-graphite transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {retrying ? "재시도 중…" : "실패만 재시도"}
              </button>
            </div>
            <ul className="max-h-64 overflow-auto bg-snow border border-parchment rounded-[9.6px] divide-y divide-parchment">
              {status.failed_personas.map((f) => (
                <li
                  key={f.persona_uuid}
                  className="px-3 py-2 border-l-2 border-l-terra/60"
                >
                  <p className="text-caption text-graphite font-mono">
                    {f.persona_uuid.slice(0, 8)}…
                  </p>
                  <p className="text-caption text-ink mt-0.5">
                    {f.error ?? "원인 불명"}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}

// ============================================================
// 보조
// ============================================================

function Stat({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string;
  value: string;
  suffix?: string;
  highlight?: "terra" | "azure";
}) {
  const accentColor =
    highlight === "terra"
      ? "text-terra"
      : highlight === "azure"
        ? "text-graphite"
        : "text-ink";
  return (
    <li className="bg-snow border border-parchment rounded-[9.6px] px-4 py-3 flex flex-col gap-1">
      <p className="text-overline text-dusty">{label}</p>
      <p className={`text-title ${accentColor} tabular-nums truncate`}>
        {value}
        {suffix && (
          <span className="text-body-sm text-dusty ml-1 font-normal">{suffix}</span>
        )}
      </p>
    </li>
  );
}

function StatusBadge({ status }: { status: SurveyStatusResponse["survey_status"] }) {
  const map: Record<
    SurveyStatusResponse["survey_status"],
    { label: string; cls: string }
  > = {
    draft: { label: "초안", cls: "bg-parchment text-graphite" },
    running: { label: "진행 중", cls: "bg-terra/20 text-terra border border-terra/40" },
    completed: { label: "완료", cls: "bg-azure/30 text-graphite border border-azure" },
    failed: { label: "실패", cls: "bg-terra/15 text-terra border border-terra/40" },
  };
  const v = map[status];
  return (
    <span
      className={`inline-flex items-center text-caption font-medium px-2.5 py-0.5 rounded-full ${v.cls}`}
    >
      {v.label}
    </span>
  );
}
