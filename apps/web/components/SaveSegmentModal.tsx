"use client";

import { useEffect, useState } from "react";
import { createSegment, type PersonaFilterRequest, type Segment } from "@/lib/api";

/**
 * 세그먼트 저장 모달 — 이름·설명 입력 + 페르소나 스냅샷 저장.
 *
 * 저장 시점에 현재 선택된 페르소나 uuid 배열을 그대로 보존 (필터 변경에 영향받지 않음).
 * 또한 현재 필터 조건도 메타로 함께 저장 → 나중에 재현·디버그 용도.
 */
export function SaveSegmentModal({
  open,
  personaUuids,
  filter,
  onClose,
  onSaved,
}: {
  open: boolean;
  personaUuids: string[];
  filter: PersonaFilterRequest;
  onClose: () => void;
  onSaved: (seg: Segment) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 열릴 때 초기화
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  // ESC 닫기 + body scroll-lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("이름을 입력해주세요");
      return;
    }
    if (personaUuids.length === 0) {
      setError("저장할 페르소나가 없습니다");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const seg = await createSegment({
        name: name.trim(),
        description: description.trim(),
        filter: {
          age_min: filter.age_min ?? null,
          age_max: filter.age_max ?? null,
          sex: filter.sex ?? [],
          provinces: filter.provinces ?? [],
          family_types: filter.family_types ?? [],
          education_levels: filter.education_levels ?? [],
          occupations: filter.occupations ?? [],
          query: filter.query ?? null,
          sampling: "random_n",
          sample_size: personaUuids.length,
        },
        persona_uuids: personaUuids,
      });
      onSaved(seg);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-segment-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-onyx/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      {/* 모바일: bottom sheet (rounded-t-2xl, max-h-[92dvh]). sm+ : 중앙 카드 */}
      <form
        onSubmit={handleSubmit}
        className="bg-vellum border border-parchment rounded-t-[16px] sm:rounded-[9.6px]
                   w-full sm:max-w-md max-h-[92dvh] sm:max-h-[90vh] overflow-hidden flex flex-col
                   shadow-2xl sm:shadow-none"
      >
        {/* 모바일 시트 grabber */}
        <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0" aria-hidden>
          <span className="block w-9 h-1 rounded-full bg-stone/40" />
        </div>

        {/* 헤더 — SectionCard 패턴 */}
        <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-4 py-3 sm:px-5 sm:py-4 shrink-0">
          <h2 id="save-segment-title" className="text-title text-ink">
            세그먼트로 저장
          </h2>
          <p className="text-body-sm text-dusty mt-1">
            <span className="font-mono text-terra">{personaUuids.length}</span>명의 페르소나를
            그룹으로 저장합니다
          </p>
        </header>

        <div className="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto">
          <div>
            <label className="text-overline text-dusty">이름 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 30대 워킹맘 수도권"
              maxLength={100}
              disabled={saving}
              autoFocus
              className="mt-1 w-full min-h-[44px] px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                         text-[16px] sm:text-body-sm text-ink placeholder:text-stone
                         focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30
                         disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-overline text-dusty">설명 (선택)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이 세그먼트의 특징이나 사용 목적"
              rows={3}
              maxLength={500}
              disabled={saving}
              className="mt-1 w-full px-3 py-2 bg-snow border border-onyx/15 rounded-[9.6px]
                         text-[16px] sm:text-body-sm text-ink placeholder:text-stone
                         focus:outline-none focus:ring-2 focus:ring-azure focus:border-onyx/30
                         disabled:opacity-50 resize-none"
            />
            <p className="text-caption text-stone mt-1 text-right tabular-nums">
              {description.length}/500
            </p>
          </div>

          {error && (
            <p className="text-caption text-ink bg-terra/10 border border-terra/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          {/* 필터 메타 미리보기 */}
          {(filter.query || (filter.sex?.length ?? 0) > 0 || (filter.provinces?.length ?? 0) > 0) && (
            <div className="bg-snow/60 border border-parchment rounded-[9.6px] p-3">
              <p className="text-overline text-dusty mb-1.5">함께 저장될 필터 조건</p>
              <ul className="text-caption text-graphite space-y-0.5">
                {filter.query && <li>· 자연어: &ldquo;{filter.query}&rdquo;</li>}
                {filter.age_min !== null && filter.age_max !== null && (
                  <li>· 연령: {filter.age_min}-{filter.age_max}세</li>
                )}
                {(filter.sex?.length ?? 0) > 0 && <li>· 성별: {filter.sex?.join(", ")}</li>}
                {(filter.provinces?.length ?? 0) > 0 && (
                  <li>· 지역: {filter.provinces?.slice(0, 3).join(", ")}
                    {(filter.provinces?.length ?? 0) > 3 && ` 외 ${(filter.provinces?.length ?? 0) - 3}개`}
                  </li>
                )}
                {(filter.occupations?.length ?? 0) > 0 && (
                  <li>· 직업: {filter.occupations?.join(", ")}</li>
                )}
              </ul>
            </div>
          )}
        </div>

        <footer className="px-4 py-3 sm:px-5 border-t border-parchment bg-snow/40 flex justify-end gap-2 shrink-0
                           pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] px-4 py-2 text-body-sm text-graphite bg-snow border border-parchment rounded-[9.6px]
                       hover:border-terra hover:text-terra transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="min-h-[44px] px-4 py-2 text-body-sm font-medium text-snow bg-ink rounded-[9.6px]
                       hover:bg-onyx active:bg-graphite transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </footer>
      </form>
    </div>
  );
}
