"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  deleteAllAnalyses,
  deleteAnalysis,
  listAnalyses,
  type AnalysisSummary,
} from "@/lib/api";

/** 삭제 확인 모달의 대상 상태. */
type PendingDelete =
  | { type: "single"; item: AnalysisSummary }
  | { type: "all" }
  | null;

type Props = {
  /** 현재 선택된 분석 id (선택 항목 강조용). null이면 어떤 항목도 선택 안 됨. */
  selectedId: string | null;
  /** 사용자가 항목을 선택했을 때 호출. */
  onSelect: (id: string) => void;
  /** 항목이 삭제되었을 때 호출 (id 전달). 부모가 선택 상태/결과 정리. */
  onDeleted?: (id: string) => void;
  /** 전체 삭제되었을 때 호출. */
  onDeletedAll?: () => void;
};

/**
 * 분석 이력 리스트 (좌측 컬럼용).
 *
 * 기능:
 * - 헤더: 총 N건 + 전체 삭제 + 새로고침
 * - 본문: 카드형 항목, 선택 시 좌측 4px terra 막대 + 배경 강조
 * - 각 행 호버 시 우측에 X 삭제 버튼 노출
 * - 삭제는 confirm 필수 (destructive action), 전체 삭제는 더욱 강력한 경고
 */
export function HistoryList({
  selectedId,
  onSelect,
  onDeleted,
  onDeletedAll,
}: Props) {
  const [items, setItems] = useState<AnalysisSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 단건 삭제 진행 중인 id (낙관적 비활성화). */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** 전체 삭제 진행 중 여부. */
  const [deletingAll, setDeletingAll] = useState(false);
  /** 삭제 확인 모달 상태. null이면 닫힘. */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAnalyses(50, 0);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 삭제 트리거 — 실제 호출은 모달 confirm 시점에 진행
  function requestDelete(item: AnalysisSummary) {
    if (deletingId || deletingAll) return;
    setPendingDelete({ type: "single", item });
  }

  function requestDeleteAll() {
    if (deletingId || deletingAll || items.length === 0) return;
    setPendingDelete({ type: "all" });
  }

  async function confirmPendingDelete() {
    if (!pendingDelete) return;

    if (pendingDelete.type === "single") {
      const item = pendingDelete.item;
      setDeletingId(item.id);
      setError(null);
      try {
        await deleteAnalysis(item.id);
        setItems((prev) => prev.filter((it) => it.id !== item.id));
        setTotal((t) => Math.max(0, t - 1));
        onDeleted?.(item.id);
        setPendingDelete(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPendingDelete(null);
      } finally {
        setDeletingId(null);
      }
    } else {
      setDeletingAll(true);
      setError(null);
      try {
        await deleteAllAnalyses();
        setItems([]);
        setTotal(0);
        onDeletedAll?.();
        setPendingDelete(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPendingDelete(null);
      } finally {
        setDeletingAll(false);
      }
    }
  }

  const busy = deletingAll || !!deletingId;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-parchment px-5 py-4 shrink-0">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-title text-ink">분석 이력</h2>
          <p className="text-body-sm text-dusty num-tabular">
            총 {total.toLocaleString()}건 · 최신순
          </p>
        </div>
        <div className="flex items-center gap-3 mt-2.5">
          <button
            type="button"
            onClick={refresh}
            disabled={busy || loading}
            className="text-body-sm font-medium text-graphite hover:text-ink underline focus:outline-none focus-visible:ring-2 focus-visible:ring-azure rounded disabled:opacity-40"
          >
            새로고침
          </button>
          <span className="text-stone" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={requestDeleteAll}
            disabled={busy || items.length === 0}
            className="text-body-sm font-semibold text-terra hover:text-ink underline focus:outline-none focus-visible:ring-2 focus-visible:ring-azure rounded disabled:opacity-40 disabled:no-underline"
          >
            {deletingAll ? "전체 삭제 중..." : "전체 삭제"}
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="px-5 py-3 text-body-sm text-ink bg-terra/10 border-b border-terra/20"
        >
          {error}
        </div>
      )}

      {loading && (
        <div
          className="p-4 space-y-2"
          aria-busy="true"
          aria-live="polite"
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 bg-snow border border-parchment rounded-[9.6px] animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="p-8 text-center text-body text-dusty">
          분석 이력이 없습니다. 새 분석을 시작해 보세요.
        </div>
      )}

      {!loading && items.length > 0 && (
        <ul className="divide-y divide-parchment overflow-auto flex-1 min-h-0">
          {items.map((item) => (
            <HistoryRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              deleting={deletingId === item.id}
              disabled={busy && deletingId !== item.id}
              onClick={() => onSelect(item.id)}
              onDelete={() => requestDelete(item)}
            />
          ))}
        </ul>
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        tone="danger"
        title={
          pendingDelete?.type === "all"
            ? "전체 분석 이력을 삭제할까요?"
            : "이 분석 이력을 삭제할까요?"
        }
        description={renderConfirmBody(pendingDelete, total)}
        confirmLabel={
          pendingDelete?.type === "all"
            ? `전체 ${total.toLocaleString()}건 삭제`
            : "삭제"
        }
        cancelLabel="취소"
        busy={busy}
        onConfirm={confirmPendingDelete}
        onCancel={() => {
          if (busy) return;
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

/** 모달 본문 — 단건/전체에 따라 다른 안내 문구. */
function renderConfirmBody(
  pending: PendingDelete,
  total: number,
): React.ReactNode {
  if (!pending) return null;

  if (pending.type === "all") {
    return (
      <>
        <span className="block text-ink font-medium mb-1.5">
          {total.toLocaleString()}건의 분석 이력
        </span>
        연관된 설문 시뮬레이션도 모두 함께 삭제됩니다.
        <span className="block mt-2 text-terra font-medium">
          이 작업은 되돌릴 수 없습니다.
        </span>
      </>
    );
  }

  const item = pending.item;
  return (
    <>
      <span className="block text-ink font-medium mb-1.5 line-clamp-3">
        “{item.summary || "(요약 없음)"}”
      </span>
      {item.simulation_count > 0 && (
        <span className="block">
          연관된 설문 시뮬레이션{" "}
          <span className="text-ink font-medium">
            {item.simulation_count}건
          </span>
          도 함께 삭제됩니다.
        </span>
      )}
      <span className="block mt-2 text-terra font-medium">
        이 작업은 되돌릴 수 없습니다.
      </span>
    </>
  );
}

function HistoryRow({
  item,
  selected,
  deleting,
  disabled,
  onClick,
  onDelete,
}: {
  item: AnalysisSummary;
  selected: boolean;
  deleting: boolean;
  disabled: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const scoreTone =
    item.max_score >= 80
      ? "bg-terra/10 text-ink border-terra/30"
      : item.max_score >= 65
        ? "bg-azure/50 text-ink border-azure"
        : "bg-snow text-graphite border-parchment";

  return (
    <li
      className={`group relative transition-opacity ${deleting ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={deleting || disabled}
        aria-pressed={selected}
        className={`w-full text-left px-4 py-3.5 pr-12 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-azure
                    disabled:cursor-not-allowed
                    ${
                      selected
                        ? "bg-snow border-l-4 border-terra"
                        : "hover:bg-snow/70 border-l-4 border-transparent"
                    }`}
      >
        <div className="flex items-start justify-between gap-3">
          <p
            className={`text-body font-semibold line-clamp-2 flex-1 ${
              selected ? "text-ink" : "text-graphite"
            }`}
          >
            {item.summary || "(요약 없음)"}
          </p>
          <span
            className={`text-body-sm font-mono font-semibold px-2 py-0.5 rounded-[9.6px] border shrink-0 num-tabular ${scoreTone}`}
          >
            {item.max_score.toFixed(1)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-dusty mt-2 num-tabular">
          <span>{formatDate(item.created_at)}</span>
          <span aria-hidden>·</span>
          <span>{item.top_persona_count}명</span>
          {item.top_province && (
            <>
              <span aria-hidden>·</span>
              <span>{item.top_province}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{(item.total_ms / 1000).toFixed(1)}초</span>
          {item.simulation_count > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-ink font-medium">
                📋 {item.simulation_count}건
              </span>
            </>
          )}
        </div>
      </button>

      {/* 삭제 버튼 — 호버/포커스 시 노출, 모바일은 항상 노출 */}
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting || disabled}
        aria-label={`"${item.summary || "(요약 없음)"}" 이력 삭제`}
        className={`absolute top-2.5 right-2 inline-flex items-center justify-center w-8 h-8 rounded-[9.6px]
                    text-stone hover:text-terra hover:bg-terra/10 transition-all
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-azure
                    disabled:opacity-30 disabled:cursor-not-allowed
                    sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`}
      >
        {deleting ? <Spinner /> : <IconTrash />}
      </button>
    </li>
  );
}

function IconTrash() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4 animate-spin motion-reduce:animate-none"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" strokeWidth="2" className="opacity-25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        strokeWidth="2"
        strokeLinecap="round"
        className="opacity-90"
      />
    </svg>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
