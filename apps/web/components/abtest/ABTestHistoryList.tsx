"use client";

import { useEffect, useState } from "react";
import {
  deleteABTest,
  listABTests,
  type ABTestSummary,
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

/**
 * /abtest 페이지 — 이력 모드의 목록.
 * 카드형 리스트. 선택 시 상세 조회.
 */
export function ABTestHistoryList({ onSelect, reloadKey = 0 }: Props) {
  const [items, setItems] = useState<ABTestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** 삭제 확인 대상 id — null이면 모달 닫힘. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listABTests(50, 0)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
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
      await deleteABTest(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  // 삭제 모달용 — 대상 항목의 라벨을 description에 노출하기 위해 lookup
  const confirmTarget = confirmDeleteId
    ? items.find((it) => it.id === confirmDeleteId) ?? null
    : null;

  if (loading) {
    return (
      <div className="text-center py-12 text-dusty text-body-sm">
        이력을 불러오는 중…
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-[9.6px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
      >
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-body text-graphite mb-1">아직 진행한 A/B 테스트가 없습니다.</p>
        <p className="text-body-sm text-dusty">
          상단의 &lsquo;새 A/B 테스트&rsquo; 탭에서 첫 비교 분석을 시작해보세요.
        </p>
      </div>
    );
  }

  return (
    <>
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.id}>
          <button
            type="button"
            onClick={() => onSelect(it.id)}
            className="w-full text-left rounded-[9.6px] border border-parchment bg-vellum hover:bg-snow/40 hover:border-graphite/30
                       transition-colors p-4 group focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
            aria-label={`${it.baseline_label} vs ${it.challenger_label} 분석 상세 보기`}
          >
            {/* 상단 메타 라인 */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-caption text-dusty">
                {formatDate(it.created_at)}
              </span>
              <ModeBadge mode={it.input_mode} />
              <ChallengerKindBadge kind={it.challenger_kind} />
              <RecommendationBadge value={it.recommended_variant} />
              {it.total_ms > 0 && (
                <span className="text-caption text-dusty">
                  · {(it.total_ms / 1000).toFixed(1)}s
                </span>
              )}
              <span className="ml-auto text-overline text-dusty">
                {it.llm_provider === "anthropic" ? "Claude" : "sLLM"}
              </span>
            </div>

            {/* 비교 — 기준안 vs 도전안 */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 sm:gap-3 items-center">
              <div className="min-w-0">
                <p className="text-overline text-graphite mb-0.5 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink"></span>
                  당사 안 (기준)
                </p>
                <p className="text-body font-semibold text-ink truncate" title={it.baseline_label}>
                  {it.baseline_label}
                </p>
              </div>
              <span className="hidden sm:inline-flex shrink-0 text-overline text-dusty justify-self-center">
                vs
              </span>
              <div className="min-w-0">
                <p className="text-overline text-graphite mb-0.5">
                  {it.challenger_kind === "internal"
                    ? "당사 다른 상품"
                    : "타사 상품"}
                </p>
                <p
                  className={`text-body font-semibold truncate ${
                    it.challenger_kind === "external" ? "text-terra" : "text-graphite"
                  }`}
                  title={it.challenger_label}
                >
                  {it.challenger_label}
                </p>
              </div>
            </div>

            {/* 추천안 한 줄 */}
            <p className="mt-2.5 text-body-sm text-graphite">
              <span className="text-dusty">추천: </span>
              <span className="text-ink font-medium">{it.recommended_label}</span>
            </p>

            {/* 하단 액션 */}
            <div className="mt-3 pt-2.5 border-t border-parchment flex justify-end">
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => requestDelete(it.id, e)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    requestDelete(it.id, e as unknown as React.MouseEvent);
                  }
                }}
                className={`text-caption text-dusty hover:text-rose-600 hover:underline cursor-pointer
                            ${deletingId === it.id ? "opacity-50 cursor-wait" : ""}`}
              >
                {deletingId === it.id ? "삭제 중…" : "삭제"}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>

    {/* 삭제 확인 모달 */}
    <ConfirmModal
      open={confirmDeleteId !== null}
      title="이력을 삭제할까요?"
      description={
        confirmTarget ? (
          <>
            <span className="block text-graphite">
              <span className="text-ink font-medium">{confirmTarget.baseline_label}</span>
              {" vs "}
              <span className="text-ink font-medium">{confirmTarget.challenger_label}</span>
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

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-snow text-graphite text-overline font-medium border border-parchment">
      {INPUT_MODE_LABEL[mode] ?? mode}
    </span>
  );
}

function ChallengerKindBadge({ kind }: { kind: "internal" | "external" }) {
  if (kind === "internal") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-azure/20 text-ink text-overline font-medium border border-azure/30">
        내부 비교
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-terra/15 text-terra text-overline font-medium border border-terra/30">
      경쟁 분석
    </span>
  );
}

function RecommendationBadge({ value }: { value: "A" | "B" | "split" }) {
  if (value === "split") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-snow text-graphite text-overline font-medium border border-parchment">
        분기 운영
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-ink text-vellum text-overline font-semibold">
      {value} 우위
    </span>
  );
}
