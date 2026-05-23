"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  deleteSurvey,
  listSurveys,
  type SurveyStatus,
  type SurveySummary,
} from "@/lib/api";
import { ConfirmModal } from "@/components/ConfirmModal";
import { AlertModal } from "@/components/AlertModal";

/**
 * 마법사로 만든 설문 목록 — `/surveys?mode=history`에서 표시.
 *
 * 카드: 제목 + 상태 뱃지 + 질문/페르소나 수 + 최근 갱신 + 액션(진행/결과/리포트/삭제).
 * 상태별 필터 select.
 */

const STATUS_LABELS: Record<SurveyStatus | "all", string> = {
  all: "전체",
  draft: "초안",
  running: "진행 중",
  completed: "완료",
  failed: "실패",
};

export function SurveyHistoryList() {
  const [items, setItems] = useState<SurveySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<SurveyStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 삭제 확인 대상 — null이면 모달 닫힘. */
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** AlertModal — 삭제 실패 등 정보성. */
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const r = await listSurveys(
        filter === "all" ? undefined : filter,
        50,
        0,
      );
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function requestDelete(id: string, title: string) {
    setConfirmDelete({ id, title });
  }

  async function performDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteSurvey(confirmDelete.id);
      setItems((prev) => prev.filter((s) => s.id !== confirmDelete.id));
      setTotal((t) => Math.max(0, t - 1));
      setConfirmDelete(null);
    } catch (e) {
      setAlertMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="bg-vellum border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-title text-ink">설문 이력</h2>
          <p className="text-body-sm text-dusty mt-1">
            마법사로 만든 설문 {total.toLocaleString()}개 (최근 갱신순)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as SurveyStatus | "all")}
            className="px-3 py-1.5 bg-vellum border border-onyx/15 rounded-[9.6px] text-body-sm text-ink
                       focus:outline-none focus:ring-2 focus:ring-azure"
          >
            {(["all", "draft", "running", "completed", "failed"] as const).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="text-caption text-graphite px-2 py-1 rounded border border-parchment
                       hover:border-terra hover:text-terra transition-colors disabled:opacity-50"
            aria-label="새로고침"
          >
            ↻
          </button>
        </div>
      </header>

      <div className="p-4">
        {error && (
          <div className="bg-terra/10 border border-terra/30 text-ink px-4 py-3 rounded-[9.6px] mb-4">
            <p className="font-medium mb-1">목록을 불러오지 못했습니다</p>
            <p className="text-caption text-graphite">{error}</p>
          </div>
        )}

        {loading && items.length === 0 && (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <li
                key={i}
                className="h-32 bg-snow border border-parchment rounded-[9.6px]"
              />
            ))}
          </ul>
        )}

        {!loading && items.length === 0 && (
          <div className="text-center py-12">
            <p className="text-body text-graphite mb-2">
              {filter === "all"
                ? "아직 만든 설문이 없습니다"
                : `${STATUS_LABELS[filter]} 상태의 설문이 없습니다`}
            </p>
            <p className="text-caption text-dusty">위 &lsquo;새 설문 만들기&rsquo; 탭에서 시작하세요</p>
          </div>
        )}

        {items.length > 0 && (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map((s) => (
              <SurveyCard key={s.id} survey={s} onDelete={requestDelete} />
            ))}
          </ul>
        )}
      </div>

      {/* 삭제 확인 모달 */}
      <ConfirmModal
        open={confirmDelete !== null}
        title="설문을 삭제할까요?"
        description={
          confirmDelete ? (
            <>
              <span className="block text-ink font-medium">&lsquo;{confirmDelete.title}&rsquo;</span>
              <span className="block mt-1 text-graphite">응답 데이터도 함께 사라집니다. 되돌릴 수 없습니다.</span>
            </>
          ) : (
            "응답 데이터도 함께 사라집니다."
          )
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        tone="danger"
        busy={deleting}
        onConfirm={performDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* 에러 알림 모달 (alert 대체) */}
      <AlertModal
        open={alertMessage !== null}
        title="설문 삭제에 실패했어요"
        description={alertMessage ?? ""}
        tone="danger"
        onClose={() => setAlertMessage(null)}
      />
    </section>
  );
}

// ============================================================
// 단일 카드
// ============================================================

function SurveyCard({
  survey,
  onDelete,
}: {
  survey: SurveySummary;
  onDelete: (id: string, title: string) => void;
}) {
  return (
    <li className="bg-snow border border-parchment rounded-[9.6px] overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-parchment flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={primaryActionHref(survey)}
            className="text-body font-medium text-ink hover:text-terra transition-colors line-clamp-2"
          >
            {survey.title}
          </Link>
        </div>
        <StatusBadge status={survey.status} />
      </header>

      <div className="p-4 flex-1 flex flex-col gap-2">
        {survey.objective && (
          <p className="text-caption text-graphite line-clamp-2">{survey.objective}</p>
        )}
        <dl className="text-caption text-dusty space-y-0.5 mt-auto">
          <div className="flex gap-2">
            <dt className="shrink-0">대상</dt>
            <dd className="text-ink font-mono tabular-nums">
              {survey.persona_count.toLocaleString()}명
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0">질문</dt>
            <dd className="text-ink font-mono tabular-nums">{survey.question_count}개</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0">갱신</dt>
            <dd className="text-graphite">{formatDate(survey.updated_at)}</dd>
          </div>
        </dl>
      </div>

      <footer className="px-4 py-2 border-t border-parchment bg-snow/60 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5">
          <ActionLinks survey={survey} />
        </div>
        <button
          type="button"
          onClick={() => onDelete(survey.id, survey.title)}
          className="text-caption text-graphite hover:text-terra transition-colors"
          aria-label={`${survey.title} 삭제`}
        >
          삭제
        </button>
      </footer>
    </li>
  );
}

function primaryActionHref(s: SurveySummary): string {
  if (s.status === "completed" || s.status === "failed") {
    return `/surveys/${s.id}/responses`;
  }
  return `/surveys/${s.id}/progress`;
}

function ActionLinks({ survey }: { survey: SurveySummary }) {
  // 상태별로 노출되는 액션이 달라짐
  const links: { href: string; label: string }[] = [];
  if (survey.status === "draft") {
    // 초안: 진행 페이지로 가서 트리거 가능
    links.push({ href: `/surveys/${survey.id}/progress`, label: "진행" });
  } else if (survey.status === "running") {
    links.push({ href: `/surveys/${survey.id}/progress`, label: "진행 보기" });
  } else {
    // completed / failed
    links.push({ href: `/surveys/${survey.id}/responses`, label: "응답" });
    links.push({ href: `/surveys/${survey.id}/report`, label: "리포트" });
    links.push({ href: `/surveys/${survey.id}/progress`, label: "진행" });
  }
  return (
    <>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="text-caption text-graphite px-2 py-0.5 rounded border border-parchment
                     hover:border-terra hover:text-terra transition-colors"
        >
          {l.label}
        </Link>
      ))}
    </>
  );
}

function StatusBadge({ status }: { status: SurveyStatus }) {
  const map: Record<SurveyStatus, { label: string; cls: string }> = {
    draft: { label: "초안", cls: "bg-parchment text-graphite" },
    running: { label: "진행 중", cls: "bg-terra/20 text-terra border border-terra/40" },
    completed: { label: "완료", cls: "bg-azure/30 text-graphite border border-azure" },
    failed: { label: "실패", cls: "bg-terra/15 text-terra border border-terra/40" },
  };
  const v = map[status];
  return (
    <span className={`inline-flex items-center text-caption font-medium px-2 py-0.5 rounded-full shrink-0 ${v.cls}`}>
      {v.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (minutes < 1) return "방금";
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
