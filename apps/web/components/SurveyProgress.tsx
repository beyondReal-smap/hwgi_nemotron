"use client";

import { useEffect, useRef, useState } from "react";
import {
  getRecentAnswers,
  retryFailedSessions,
  triggerSurveyRun,
  type RecentAnswer,
  type SurveyStatusResponse,
} from "@/lib/api";
import { ConfirmModal } from "@/components/ConfirmModal";
import { StatusBadge } from "@/components/StatusBadge";

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
  /** 강제 재시작 확인 모달. */
  const [confirmForceOpen, setConfirmForceOpen] = useState(false);

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
  function handleForceRestart() {
    setConfirmForceOpen(true);
  }

  async function performForceRestart() {
    setRetrying(true);
    setRetryError(null);
    setRetryNotice(null);
    try {
      const r = await triggerSurveyRun(status.survey_id, { force: true });
      setRetryNotice(
        `${r.reset}명 다시 시작 · 완료 ${r.completed_preserved}명 보존`,
      );
      onRetried();
      setConfirmForceOpen(false);
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  // pm2 재시작 등으로 background task가 끊긴 정황 감지:
  // status가 running인데 답변이 늘지 않으면 사용자에게 "강제 재시작" 권장.
  // 단, 설문 시작(진행 화면 진입) 직후에는 아직 토큰·완료가 0이라 이 조건을 그대로 충족한다 —
  // 첫 응답이 나오기까지 시간이 걸리므로, 진입 후 STUCK_GRACE_MS 동안은 stuck 경고를 띄우지 않는다.
  const mountedAtRef = useRef(Date.now());
  const STUCK_GRACE_MS = 60_000; // 60초
  const isStuck =
    status.survey_status === "running" &&
    status.counts.completed + status.counts.failed === 0 &&
    status.counts.running > 0 &&
    status.total_tokens === 0 &&
    Date.now() - mountedAtRef.current > STUCK_GRACE_MS;

  // 실시간 응답 라이브 피드 — '방금 답한 페르소나'가 위에서 흘러 들어오는 ticker.
  // status polling(부모, 2초)과 분리된 별도 경량 엔드포인트를 같은 주기로 폴링한다.
  // running 동안 + 완료 직후 짧은 꼬리(LIVE_TAIL_MS)까지 갱신해 마지막 응답까지 담는다.
  // 부가 기능이므로 실패는 조용히 무시(진행 화면은 영향 없음).
  const [recent, setRecent] = useState<RecentAnswer[]>([]);
  // completed_total 증가분 감지용 — 증가했을 때만 새 항목 슬라이드-인을 트리거.
  const liveTotalRef = useRef<number>(-1);
  const [liveGrew, setLiveGrew] = useState(false);
  const surveyId = status.survey_id;
  const isLive =
    status.survey_status === "running" || status.survey_status === "completed";

  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 완료 후에도 마지막 갱신을 보장하기 위한 짧은 꼬리 폴링.
    const completedAt = status.survey_status === "completed" ? Date.now() : null;
    const LIVE_POLL_MS = 2200;
    const LIVE_TAIL_MS = 4000;

    async function tick() {
      try {
        const r = await getRecentAnswers(surveyId);
        if (cancelled) return;
        if (liveTotalRef.current >= 0 && r.completed_total > liveTotalRef.current) {
          setLiveGrew(true);
        }
        liveTotalRef.current = r.completed_total;
        setRecent(r.items);
      } catch {
        // 라이브 피드는 부가 기능 — 실패는 무시(진행 화면 유지).
      }
      if (cancelled) return;
      // 완료 후 꼬리 시간이 지나면 폴링 중단.
      if (completedAt !== null && Date.now() - completedAt > LIVE_TAIL_MS) return;
      timer = setTimeout(tick, LIVE_POLL_MS);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [surveyId, status.survey_status, isLive]);

  return (
    <>
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="bg-snow border-b border-parchment px-5 py-4">
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
              <span className="font-mono text-danger">
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
          <div className="bg-warning/12 border border-warning/40 rounded-[9.6px] px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-ink flex items-center gap-1.5">
                <IconWarning />
                진행이 멈춘 것 같습니다
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
                <span className="text-terra font-medium animate-pulse motion-reduce:animate-none flex items-center gap-1">
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
                @media (prefers-reduced-motion: reduce) {
                  .shimmer-overlay { animation: none; }
                }
              `}</style>
            )}
            <div
              className="h-full bg-terra transition-all duration-300 relative overflow-hidden"
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

        {/* 실시간 응답 라이브 피드 — running 또는 완료 직후, 응답이 1건이라도 있을 때만 노출 */}
        {isLive && (
          <LiveFeed items={recent} grew={liveGrew} running={status.survey_status === "running"} />
        )}

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
            highlight={status.counts.failed > 0 ? "danger" : undefined}
          />
        </ul>

        {/* 재시도 알림 */}
        {(retryError || retryNotice) && (
          <p
            className={`text-caption px-3 py-2 rounded-[9.6px] border ${
              retryError
                ? "text-ink bg-danger/12 border-danger/40"
                : "text-ink bg-success/12 border-success/45"
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
                  className="px-3 py-2"
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

    {/* 강제 재시작 확인 모달 */}
    <ConfirmModal
      open={confirmForceOpen}
      title="강제 재시작할까요?"
      description={
        <>
          <span className="block text-graphite">진행이 멈췄을 때만 사용하세요.</span>
          <span className="block mt-2 text-graphite">
            이미 완료된 응답은 그대로 두고, 미완료·멈춘 세션만 다시 시작합니다.
          </span>
        </>
      }
      confirmLabel="강제 재시작"
      cancelLabel="취소"
      tone="danger"
      busy={retrying}
      onConfirm={performForceRestart}
      onCancel={() => setConfirmForceOpen(false)}
    />
    </>
  );
}

// ============================================================
// 보조
// ============================================================

/**
 * 실시간 응답 라이브 피드 — 막 완료된 페르소나의 마지막 답변이 위에서 fade-slide-in으로 쌓이는 ticker.
 * - items는 백엔드가 최신순(위→아래)으로 반환. key는 persona_summary + completed_at 조합으로 안정화.
 * - grew(=completed_total 증가)일 때만 맨 위 새 행에 슬라이드-인 애니메이션을 적용.
 * - prefers-reduced-motion에서는 애니메이션을 무효화(즉시 표시).
 * - 응답이 0건이면 '수집 중…' placeholder(running일 때)만 노출.
 */
function LiveFeed({
  items,
  grew,
  running,
}: {
  items: RecentAnswer[];
  grew: boolean;
  running: boolean;
}) {
  // 아직 완료 응답이 없으면: running이면 placeholder, 아니면 숨김.
  if (items.length === 0) {
    if (!running) return null;
    return (
      <section aria-label="실시간 응답">
        <h3 className="text-body font-medium text-ink mb-2 flex items-center gap-1.5">
          <LiveDot animate />
          실시간 응답
        </h3>
        <div className="bg-snow border border-parchment rounded-[9.6px] px-4 py-6 text-center">
          <p className="text-caption text-dusty">응답 수집 중…</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="실시간 응답">
      <style>{`
        @keyframes liveRowIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .live-row-in { animation: liveRowIn 320ms ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .live-row-in { animation: none; }
        }
      `}</style>
      <h3 className="text-body font-medium text-ink mb-2 flex items-center gap-1.5">
        <LiveDot animate={running} />
        실시간 응답
      </h3>
      <ul
        className="max-h-72 overflow-auto bg-snow border border-parchment rounded-[9.6px] divide-y divide-parchment"
        aria-live="polite"
        aria-relevant="additions"
      >
        {items.map((it, i) => (
          <li
            key={`${it.persona_summary}|${it.completed_at ?? "—"}|${i}`}
            // 맨 위 새 행에만 슬라이드-인(증가 감지 시). key가 바뀌면 React가 재마운트하여 재생.
            className={`px-3.5 py-2.5 ${i === 0 && grew ? "live-row-in" : ""}`}
          >
            <p className="text-caption font-medium text-marine flex items-center gap-1.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-marine shrink-0"
                aria-hidden
              />
              {it.persona_summary}
            </p>
            <p className="text-body-sm text-ink mt-1 leading-relaxed line-clamp-3">
              {it.answer_text}
            </p>
            <p className="text-caption text-dusty mt-1 line-clamp-1">
              {it.question_text}
            </p>
            {it.reasoning && (
              <p className="text-overline text-stone mt-0.5 line-clamp-2">
                {it.reasoning}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 라이브 상태 표시 점 — marine 톤. running일 때만 점멸. */
function LiveDot({ animate }: { animate: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full bg-marine shrink-0 ${
        animate ? "animate-pulse motion-reduce:animate-none" : ""
      }`}
      aria-hidden
    />
  );
}

function IconWarning() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5 shrink-0 text-warning"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2.6l6.2 10.4H1.8L8 2.6z" />
      <path d="M8 6.6v3.1M8 11.6v.02" />
    </svg>
  );
}

function Stat({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string;
  value: string;
  suffix?: string;
  highlight?: "danger" | "azure";
}) {
  const accentColor =
    highlight === "danger"
      ? "text-danger"
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

