"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseQuestionsFile,
  getQuestionTemplateUrl,
  QUESTION_UPLOAD_EXTS,
  QUESTION_UPLOAD_MAX_MB,
  type ParsedQuestion,
  type ParseResult,
  type QuestionType,
  type SurveyQuestion,
} from "@/lib/api";

/**
 * 질문 파일 업로드 모달 — 스펙 §5.5 구현.
 *
 * 흐름:
 *  1. 드래그앤드롭 또는 파일 선택 (xlsx/csv/docx)
 *  2. 서버 파싱 → 결과 미리보기 (인라인 수정 가능)
 *  3. 오류 행 하이라이트 + 메시지
 *  4. "유효 항목만" / "전체" 선택 + 병합/덮어쓰기 옵션
 *  5. 확정 → onConfirm 호출 → 상위 wizard state에 반영
 *
 * 템플릿 다운로드 링크 2종(Excel·Word) 항상 노출.
 */
export function QuestionImportModal({
  open,
  onClose,
  onConfirm,
  hasExistingQuestions,
}: {
  open: boolean;
  onClose: () => void;
  /** 확정된 질문(SurveyQuestion 변환 완료) + 병합 모드 */
  onConfirm: (
    questions: SurveyQuestion[],
    mode: "append" | "replace",
  ) => void;
  hasExistingQuestions: boolean;
}) {
  const [phase, setPhase] = useState<"upload" | "preview">("upload");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedRows, setEditedRows] = useState<Map<number, ParsedQuestion>>(new Map());
  const [validOnly, setValidOnly] = useState(true);
  const [mode, setMode] = useState<"append" | "replace">(
    hasExistingQuestions ? "append" : "replace",
  );

  // 모달 reset
  useEffect(() => {
    if (!open) {
      setPhase("upload");
      setResult(null);
      setError(null);
      setEditedRows(new Map());
      setValidOnly(true);
    }
  }, [open]);

  // ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !parsing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, parsing, onClose]);

  async function handleFile(file: File) {
    setError(null);

    // 클라이언트 검증
    const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");
    if (!QUESTION_UPLOAD_EXTS.includes(ext)) {
      setError(`지원하지 않는 형식. ${QUESTION_UPLOAD_EXTS.join(", ")}만 가능합니다`);
      return;
    }
    if (file.size > QUESTION_UPLOAD_MAX_MB * 1024 * 1024) {
      setError(`파일이 너무 큽니다 (최대 ${QUESTION_UPLOAD_MAX_MB}MB)`);
      return;
    }

    setParsing(true);
    try {
      const r = await parseQuestionsFile(file);
      setResult(r);
      setEditedRows(new Map());
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  function patchRow(row: number, patch: Partial<ParsedQuestion>) {
    if (!result) return;
    const original = result.questions.find((q) => q.row === row);
    if (!original) return;
    const current = editedRows.get(row) ?? original;
    const next = { ...current, ...patch };
    // 검증 — 텍스트 / 선택지 등
    const errors: string[] = [];
    if (!next.text.trim()) errors.push("질문 내용이 비어 있습니다");
    if (
      (next.type === "single_choice" || next.type === "multi_choice") &&
      next.options.filter((o) => o.trim()).length < 2
    ) {
      errors.push(`${next.type}은 선택지 2개 이상 필요`);
    }
    next.errors = errors;
    const newMap = new Map(editedRows);
    newMap.set(row, next);
    setEditedRows(newMap);
  }

  function effectiveRows(): ParsedQuestion[] {
    if (!result) return [];
    return result.questions.map((q) => editedRows.get(q.row) ?? q);
  }

  function handleConfirm() {
    const all = effectiveRows();
    const accepted = validOnly ? all.filter((q) => q.errors.length === 0) : all;
    if (accepted.length === 0) {
      setError("확정할 질문이 없습니다");
      return;
    }
    // SurveyQuestion으로 변환 (id·order는 상위에서 정함)
    const surveyQuestions: SurveyQuestion[] = accepted.map((q, idx) => ({
      id: `imp-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
      order: idx + 1, // 임시 — 상위에서 reorder
      type: q.type,
      text: q.text.trim(),
      options: q.options.filter((o) => o.trim()),
      scale_min: q.scale_min,
      scale_max: q.scale_max,
      scale_label_low: null,
      scale_label_high: null,
      required: q.required,
    }));
    onConfirm(surveyQuestions, mode);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qimport-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-onyx/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !parsing && onClose()}
    >
      <div className="bg-vellum border border-parchment rounded-[9.6px] w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-5 py-4 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 id="qimport-title" className="text-title text-ink">
              질문 파일 업로드
            </h2>
            <p className="text-body-sm text-dusty mt-1">
              {phase === "upload"
                ? "Excel / CSV / Word 파일을 업로드하면 질문을 자동으로 가져옵니다"
                : `${result?.summary.total ?? 0}개 인식 · 유효 ${result?.summary.valid ?? 0} · 오류 ${result?.summary.invalid ?? 0}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={parsing}
            className="text-caption text-graphite px-2 py-1 rounded border border-parchment hover:border-terra hover:text-terra transition-colors disabled:opacity-50"
          >
            ✕ 닫기
          </button>
        </header>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <p className="mb-4 text-caption text-ink bg-terra/10 border border-terra/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          {phase === "upload" ? (
            <UploadStep onFile={handleFile} parsing={parsing} />
          ) : result ? (
            <PreviewStep
              result={result}
              editedRows={editedRows}
              effective={effectiveRows()}
              onPatch={patchRow}
            />
          ) : null}
        </div>

        {/* 푸터 */}
        {phase === "preview" && result && (
          <footer className="px-5 py-4 border-t border-parchment bg-snow/40 flex items-center justify-between gap-3 flex-wrap shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-body-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={validOnly}
                  onChange={(e) => setValidOnly(e.target.checked)}
                  className="accent-terra"
                />
                <span className="text-graphite">유효한 항목만 가져오기</span>
              </label>
              {hasExistingQuestions && (
                <label className="flex items-center gap-1.5 text-body-sm">
                  <span className="text-overline text-dusty">방식</span>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "append" | "replace")}
                    className="px-2 py-1 bg-vellum border border-onyx/15 rounded text-body-sm text-ink focus:outline-none focus:ring-2 focus:ring-azure"
                  >
                    <option value="append">기존에 추가</option>
                    <option value="replace">전체 교체</option>
                  </select>
                </label>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPhase("upload")}
                className="px-3 py-2 text-body-sm text-graphite bg-snow border border-parchment rounded-[9.6px] hover:border-terra hover:text-terra transition-colors"
              >
                다시 업로드
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="px-5 py-2 text-body-sm font-medium text-snow bg-ink rounded-[9.6px] hover:bg-onyx active:bg-graphite transition-colors"
              >
                {validOnly
                  ? `${effectiveRows().filter((q) => q.errors.length === 0).length}개 가져오기`
                  : `${effectiveRows().length}개 가져오기`}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Step 1 — 업로드
// ============================================================

function UploadStep({
  onFile,
  parsing,
}: {
  onFile: (f: File) => void;
  parsing: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 드롭 영역 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-[9.6px] p-10 text-center cursor-pointer transition-colors
                    ${dragOver ? "border-terra bg-terra/5" : "border-parchment bg-snow hover:border-terra/60 hover:bg-snow/70"}
                    ${parsing ? "pointer-events-none opacity-50" : ""}`}
      >
        <p className="text-body text-ink font-medium mb-1">
          {parsing
            ? "파싱 중…"
            : dragOver
              ? "여기에 놓으세요"
              : "파일을 드래그하거나 클릭해 선택"}
        </p>
        <p className="text-caption text-dusty">
          지원: {QUESTION_UPLOAD_EXTS.join(" · ")} · 최대 {QUESTION_UPLOAD_MAX_MB}MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={QUESTION_UPLOAD_EXTS.join(",")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          className="hidden"
        />
      </div>

      {/* 템플릿 다운로드 */}
      <section className="bg-snow border border-parchment rounded-[9.6px] p-4">
        <p className="text-overline text-dusty mb-2">표준 템플릿 다운로드</p>
        <p className="text-body-sm text-graphite mb-3">
          처음 사용하신다면 표준 템플릿으로 시작하시는 것을 권장합니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={getQuestionTemplateUrl("excel")}
            download
            className="px-4 py-2 text-body-sm font-medium text-snow bg-ink rounded-[9.6px] hover:bg-onyx transition-colors"
          >
            Excel 템플릿 ↓
          </a>
          <a
            href={getQuestionTemplateUrl("word")}
            download
            className="px-4 py-2 text-body-sm font-medium text-graphite bg-snow border border-parchment rounded-[9.6px] hover:border-terra hover:text-terra transition-colors"
          >
            Word 템플릿 ↓
          </a>
        </div>
        <ul className="text-caption text-dusty mt-3 space-y-0.5 pl-4 list-disc">
          <li>Excel: 컬럼명 — 순서/질문유형/질문내용/선택지1~N/필수여부</li>
          <li>Word: 번호(1./Q1)로 질문 시작 + 불릿(-)으로 선택지</li>
          <li>유형 자동 인식: 한글 표기(단일선택/다중선택/척도/주관식)도 지원</li>
        </ul>
      </section>
    </div>
  );
}

// ============================================================
// Step 2 — 미리보기
// ============================================================

function PreviewStep({
  result,
  editedRows,
  effective,
  onPatch,
}: {
  result: ParseResult;
  editedRows: Map<number, ParsedQuestion>;
  effective: ParsedQuestion[];
  onPatch: (row: number, patch: Partial<ParsedQuestion>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-graphite">
        <span className="text-ink font-medium">{result.filename}</span>
        {" · "}
        <span className="font-mono text-graphite">{result.file_format}</span>
        {" · "}
        인식 {result.summary.total}개
        {result.summary.invalid > 0 && (
          <>
            {" · "}
            <span className="text-terra">⚠ 오류 {result.summary.invalid}</span>
          </>
        )}
      </p>

      <ul className="space-y-2">
        {effective.map((q) => (
          <RowCard
            key={q.row}
            q={q}
            edited={editedRows.has(q.row)}
            onPatch={(p) => onPatch(q.row, p)}
          />
        ))}
      </ul>
    </div>
  );
}

const TYPE_LABEL: Record<QuestionType, string> = {
  single_choice: "단일 선택",
  multi_choice: "다중 선택",
  scale: "척도",
  open_ended: "주관식",
  nps: "NPS",
};

function RowCard({
  q,
  edited,
  onPatch,
}: {
  q: ParsedQuestion;
  edited: boolean;
  onPatch: (p: Partial<ParsedQuestion>) => void;
}) {
  const hasErrors = q.errors.length > 0;
  return (
    <li
      className={`bg-snow border rounded-[9.6px] overflow-hidden ${
        hasErrors ? "border-terra/40 border-l-4 border-l-terra" : "border-parchment"
      }`}
    >
      <header className="px-4 py-2 border-b border-parchment flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-caption text-stone font-mono">행 {q.row}</span>
          <select
            value={q.type}
            onChange={(e) => onPatch({ type: e.target.value as QuestionType })}
            className="text-caption px-2 py-0.5 bg-vellum border border-onyx/15 rounded text-ink focus:outline-none focus:ring-2 focus:ring-azure"
          >
            {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-caption text-graphite cursor-pointer">
            <input
              type="checkbox"
              checked={q.required}
              onChange={(e) => onPatch({ required: e.target.checked })}
              className="accent-terra"
            />
            필수
          </label>
          {edited && (
            <span className="text-caption text-terra">· 수정됨</span>
          )}
        </div>
        {hasErrors && (
          <span className="text-caption text-terra font-medium">
            ⚠ {q.errors[0]}
          </span>
        )}
      </header>
      <div className="p-3 flex flex-col gap-2">
        <input
          type="text"
          value={q.text}
          onChange={(e) => onPatch({ text: e.target.value.slice(0, 500) })}
          placeholder="질문 내용"
          className={`w-full px-3 py-2 bg-vellum border rounded-[9.6px] text-body-sm text-ink placeholder:text-stone
                      focus:outline-none focus:ring-2 focus:ring-azure
                      ${!q.text.trim() ? "border-terra/40" : "border-onyx/15"}`}
        />
        {(q.type === "single_choice" || q.type === "multi_choice") && (
          <OptionsInline
            options={q.options}
            onChange={(opts) => onPatch({ options: opts })}
          />
        )}
        {q.type === "scale" && (
          <p className="text-caption text-dusty">척도 범위: {q.scale_min ?? 1} ~ {q.scale_max ?? 5}</p>
        )}
        {q.type === "nps" && (
          <p className="text-caption text-dusty">NPS 0-10 고정</p>
        )}
        {q.errors.length > 1 && (
          <ul className="text-caption text-terra pl-4 list-disc">
            {q.errors.slice(1).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function OptionsInline({
  options,
  onChange,
}: {
  options: string[];
  onChange: (next: string[]) => void;
}) {
  function update(i: number, v: string) {
    const next = [...options];
    next[i] = v;
    onChange(next);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o, i) => (
        <input
          key={i}
          type="text"
          value={o}
          onChange={(e) => update(i, e.target.value.slice(0, 200))}
          placeholder={`선택지 ${i + 1}`}
          className="px-2.5 py-1 bg-vellum border border-onyx/15 rounded text-caption text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-azure"
        />
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, ""])}
        className="px-2 py-1 text-caption text-graphite border border-parchment rounded hover:border-terra hover:text-terra"
      >
        + 옵션
      </button>
      {options.length > 0 && (
        <button
          type="button"
          onClick={() => onChange(options.slice(0, -1))}
          className="px-2 py-1 text-caption text-graphite border border-parchment rounded hover:border-terra hover:text-terra"
        >
          − 옵션
        </button>
      )}
    </div>
  );
}
