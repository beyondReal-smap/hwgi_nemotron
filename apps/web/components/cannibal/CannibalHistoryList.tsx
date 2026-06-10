"use client";

import { useEffect, useState } from "react";
import {
  deleteCannibal,
  listCannibals,
  type CannibalSummary,
} from "@/lib/api";
import { ConfirmModal } from "@/components/ConfirmModal";

type Props = {
  /** 선택 시 부모에게 id 전달 → 상세 화면 전환 */
  onSelect: (id: string) => void;
  /** 새로고침 트리거(외부에서 증가시키면 다시 fetch) */
  reloadKey?: number;
};

const INPUT_MODE_LABEL: Record<string, string> = {
  terms: "약관",
  marketing: "카피",
  concept: "컨셉",
};
const COHORT_LABEL: Record<string, string> = {
  core: "핵심층",
  target: "타겟층",
  interest: "관심층",
};

/**
 * /cannibal 페이지 — 이력 모드의 목록. 카드형 리스트, 선택 시 상세 조회.
 * ABTestHistoryList와 동일 구조(겹침 분석 필드에 맞춤).
 */
export function CannibalHistoryList({ onSelect, reloadKey = 0 }: Props) {
  const [items, setItems] = useState<CannibalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCannibals(50, 0)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function requestDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmDeleteId(id);
  }

  async function performDelete() {
    const id = confirmDeleteId;
    if (!id) return;
    setDeletingId(id);
    try {
      await deleteCannibal(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  const confirmTarget = confirmDeleteId
    ? items.find((it) => it.id === confirmDeleteId) ?? null
    : null;

  if (loading) {
    return (
      <ul
        className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
        aria-busy="true"
        aria-live="polite"
      >
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="h-[140px] rounded-[9.6px] border border-parchment bg-vellum animate-pulse"
          />
        ))}
        <li className="sm:col-span-2 text-center text-body-sm text-dusty pt-1">
          이력을 불러오는 중…
        </li>
      </ul>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-[9.6px] border border-terra/30 bg-terra/10 px-4 py-3 text-body-sm text-ink"
      >
        <span className="font-semibold text-terra">목록 로드 실패</span>
        <span className="text-graphite"> · {error}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-body text-graphite mb-1">아직 진행한 겹침 분석이 없습니다.</p>
        <p className="text-body-sm text-dusty">
          상단의 &lsquo;새 겹침 분석&rsquo; 탭에서 첫 비교를 시작해보세요.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onSelect(it.id)}
              className="flex flex-col h-full w-full text-left rounded-[9.6px] border border-parchment bg-vellum hover:bg-snow/40 hover:border-graphite/30
                         transition-colors p-4 group focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              aria-label={`${it.labels.join(", ")} 겹침 분석 상세 보기`}
            >
              {/* 상단 메타 라인 */}
              <div className="flex items-center gap-2 flex-wrap mb-2.5">
                <span className="text-caption text-dusty">
                  {formatDate(it.created_at)}
                </span>
                <Badge>{INPUT_MODE_LABEL[it.input_mode] ?? it.input_mode}</Badge>
                <Badge>{COHORT_LABEL[it.cohort_level] ?? it.cohort_level}</Badge>
                <span className="text-caption text-dusty">· {it.item_count}개 안</span>
                {it.total_ms > 0 && (
                  <span className="text-caption text-dusty">
                    · {(it.total_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>

              {/* 안 라벨 칩 */}
              <div className="flex flex-wrap gap-1.5">
                {it.labels.map((l, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 rounded-[6px] bg-snow border border-parchment text-body-sm text-ink"
                    title={l}
                  >
                    {l}
                  </span>
                ))}
              </div>

              {/* 하단 액션 */}
              <div className="mt-auto pt-2.5 border-t border-parchment flex justify-end">
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => requestDelete(it.id, e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      requestDelete(it.id, e as unknown as React.MouseEvent);
                    }
                  }}
                  className={`text-caption text-dusty hover:text-terra hover:underline cursor-pointer
                              ${deletingId === it.id ? "opacity-50 cursor-wait" : ""}`}
                >
                  {deletingId === it.id ? "삭제 중…" : "삭제"}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <ConfirmModal
        open={confirmDeleteId !== null}
        title="이력을 삭제할까요?"
        description={
          confirmTarget ? (
            <>
              <span className="block text-ink font-medium">
                {confirmTarget.labels.join(", ")}
              </span>
              <span className="block mt-2 text-dusty">
                {formatDate(confirmTarget.created_at)} 진행 · 되돌릴 수 없습니다.
              </span>
            </>
          ) : (
            "되돌릴 수 없습니다."
          )
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        tone="danger"
        busy={deletingId !== null}
        onConfirm={performDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, "0");
    const D = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${Y}-${M}-${D} ${h}:${m}`;
  } catch {
    return iso;
  }
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-snow text-graphite text-overline font-medium border border-parchment">
      {children}
    </span>
  );
}
