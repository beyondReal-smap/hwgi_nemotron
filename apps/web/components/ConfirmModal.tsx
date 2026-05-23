"use client";

import { useEffect, useRef } from "react";

type Tone = "default" | "danger";

type Props = {
  /** 열림 상태. 부모가 제어. */
  open: boolean;
  /** 다이얼로그 헤더. */
  title: string;
  /** 본문 — 짧은 문장 또는 ReactNode. */
  description?: React.ReactNode;
  /** 확인 버튼 라벨. */
  confirmLabel?: string;
  /** 취소 버튼 라벨. */
  cancelLabel?: string;
  /** 색상 톤. danger = terra(파괴적 작업). */
  tone?: Tone;
  /** 처리 중이면 두 버튼 disable + confirm 텍스트 갈음. */
  busy?: boolean;
  /** 확인 시 호출. */
  onConfirm: () => void;
  /** 취소 또는 backdrop/Esc로 닫혔을 때 호출. */
  onCancel: () => void;
};

/**
 * 한화 톤 confirmation 모달.
 *
 * 접근성:
 * - role="dialog" + aria-modal="true" + aria-labelledby
 * - Escape 키로 닫기 (busy 중엔 무시)
 * - backdrop 클릭으로 닫기
 * - 열릴 때 confirm 버튼에 자동 포커스
 * - body scroll-lock (열려 있는 동안 뒤 페이지 스크롤 차단)
 *
 * UX:
 * - tone="danger"는 terra 채움 confirm 버튼, "default"는 ink 채움
 * - confirm 버튼이 우측(주 행동)
 */
export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "확인",
  cancelLabel = "취소",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useRef(
    `confirm-modal-${Math.random().toString(36).slice(2, 9)}`,
  );

  // Escape 키 처리 + body scroll lock + 열림 시 confirm 포커스
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 다음 frame에 confirm 버튼 포커스 (마운트 직후)
    const id = requestAnimationFrame(() => confirmRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(id);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmTone =
    tone === "danger"
      ? "bg-terra text-vellum hover:bg-terra/90 active:bg-terra/80"
      : "bg-ink text-snow hover:bg-onyx active:bg-graphite";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId.current}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      {/* Backdrop — 클릭 시 cancel (busy 중엔 무시) */}
      <div
        onClick={busy ? undefined : onCancel}
        aria-hidden
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-[fadeIn_120ms_ease-out] motion-reduce:animate-none"
      />

      {/* 다이얼로그 박스 — 모바일에서는 full width(좌우 12px), sm+ 부터 440 max */}
      <div
        className="relative bg-vellum border border-parchment rounded-[12px] shadow-2xl
                   w-full sm:w-[min(440px,calc(100vw-2rem))] max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] overflow-auto
                   animate-[modalIn_140ms_ease-out] motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-5">
          {tone === "danger" && (
            <div className="mb-3 inline-flex items-center justify-center w-10 h-10 rounded-full bg-terra/15 border border-terra/30">
              <IconAlert />
            </div>
          )}
          <h2 id={titleId.current} className="text-heading text-ink">
            {title}
          </h2>
          {description && (
            <div className="text-body-sm text-graphite mt-3 leading-relaxed whitespace-pre-line">
              {description}
            </div>
          )}
        </div>

        <div className="px-4 py-3 sm:px-6 sm:py-4 bg-snow border-t border-parchment
                        flex items-center justify-end gap-2
                        pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-[44px] px-4 py-2 rounded-[9.6px] text-body-sm font-medium text-graphite
                       hover:bg-vellum hover:text-ink
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-azure
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`min-h-[44px] px-4 py-2 rounded-[9.6px] text-body-sm font-semibold transition-colors
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-azure focus-visible:ring-offset-2 focus-visible:ring-offset-snow
                        disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 ${confirmTone}`}
          >
            {busy && <Spinner />}
            <span>{busy ? "처리 중..." : confirmLabel}</span>
          </button>
        </div>
      </div>

      {/* 진입 애니메이션 keyframes */}
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(4px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function IconAlert() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5 text-terra"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
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
