"use client";

import { useEffect, useRef } from "react";

type Tone = "default" | "danger" | "warning";

type Props = {
  /** 열림 상태. 부모 제어. */
  open: boolean;
  /** 다이얼로그 헤더. */
  title: string;
  /** 본문 — 짧은 문장 또는 ReactNode. */
  description?: React.ReactNode;
  /** 확인 버튼 라벨. */
  confirmLabel?: string;
  /** 색상 톤. danger=terra(에러), warning=amber(경고), default=ink(정보). */
  tone?: Tone;
  /** 닫기 콜백 — backdrop·Esc·확인 버튼 모두 동일 호출. */
  onClose: () => void;
};

/**
 * 한화 톤 정보성 알림 모달 — window.alert() 대체.
 * ConfirmModal의 단일 버튼 버전. 확인 버튼만 노출.
 *
 * 접근성:
 * - role="alertdialog" (정보·경고 알림)
 * - Escape로 닫기 / backdrop 클릭으로 닫기
 * - 자동 포커스 + scroll lock
 */
export function AlertModal({
  open,
  title,
  description,
  confirmLabel = "확인",
  tone = "default",
  onClose,
}: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useRef(
    `alert-modal-${Math.random().toString(36).slice(2, 9)}`,
  );

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const id = requestAnimationFrame(() => buttonRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(id);
    };
  }, [open, onClose]);

  if (!open) return null;

  const toneClasses =
    tone === "danger"
      ? {
          icon: "bg-terra/15 border-terra/30 text-terra",
          button: "bg-terra text-vellum hover:bg-terra/90 active:bg-terra/80",
        }
      : tone === "warning"
        ? {
            icon: "bg-amber-100 border-amber-300 text-amber-700",
            button: "bg-ink text-snow hover:bg-onyx active:bg-graphite",
          }
        : {
            icon: "bg-azure/30 border-azure text-ink",
            button: "bg-ink text-snow hover:bg-onyx active:bg-graphite",
          };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId.current}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <div
        onClick={onClose}
        aria-hidden
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-[fadeIn_120ms_ease-out] motion-reduce:animate-none"
      />

      <div
        className="relative bg-vellum border border-parchment rounded-[12px] shadow-2xl
                   w-full sm:w-[min(440px,calc(100vw-2rem))] max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] overflow-auto
                   animate-[modalIn_140ms_ease-out] motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-5">
          <div
            className={`mb-3 inline-flex items-center justify-center w-10 h-10 rounded-full border ${toneClasses.icon}`}
          >
            {tone === "default" ? <IconInfo /> : <IconAlert />}
          </div>
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
                        flex items-center justify-end
                        pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            ref={buttonRef}
            type="button"
            onClick={onClose}
            className={`min-h-[44px] px-5 py-2 rounded-[9.6px] text-body-sm font-semibold transition-colors
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-azure focus-visible:ring-offset-2 focus-visible:ring-offset-snow
                        ${toneClasses.button}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.96) translateY(4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

function IconAlert() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
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

function IconInfo() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
