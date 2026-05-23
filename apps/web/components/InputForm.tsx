"use client";

import { useEffect, useRef, useState } from "react";
import {
  analyzeProduct,
  extractTextFromFile,
  loadLLMProvider,
  MAX_FILE_SIZE_MB,
  saveLLMProvider,
  SUPPORTED_EXTENSIONS,
  type AnalyzeResponse,
  type LLMProvider,
} from "@/lib/api";
import { LLMProviderToggle } from "@/components/LLMProviderToggle";

type Props = {
  onResult: (r: AnalyzeResponse) => void;
  onLoadingChange: (b: boolean) => void;
  onError: (msg: string | null) => void;
};

const MIN_LEN = 20;
const MAX_LEN = 20000;
const ACCEPT_ATTR = SUPPORTED_EXTENSIONS.join(",");

export function InputForm({ onResult, onLoadingChange, onError }: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [provider, setProvider] = useState<LLMProvider>("anthropic");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 마운트 시 localStorage에서 사용자 선택 복원
  useEffect(() => {
    setProvider(loadLLMProvider());
  }, []);

  function handleProviderChange(p: LLMProvider) {
    setProvider(p);
    saveLLMProvider(p);
  }

  const length = text.length;
  const tooShort = length > 0 && length < MIN_LEN;
  const tooLong = length > MAX_LEN;
  const canSubmit =
    length >= MIN_LEN && length <= MAX_LEN && !submitting && !uploading;

  async function handleFile(file: File) {
    onError(null);
    setUploadedName(null);

    // 클라이언트 측 검증
    const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      onError(
        `지원하지 않는 형식: ${ext}. 지원: ${SUPPORTED_EXTENSIONS.join(", ")}`,
      );
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      onError(
        `파일이 ${MAX_FILE_SIZE_MB}MB를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
      );
      return;
    }

    setUploading(true);
    try {
      const res = await extractTextFromFile(file);
      setText(res.text);
      setUploadedName(res.filename);
      if (res.truncated) {
        onError(
          `파일이 길어 앞 ${MAX_LEN.toLocaleString()}자만 사용합니다 (전체 ${res.char_count.toLocaleString()}자)`,
        );
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ""; // 같은 파일 재선택 가능하게
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    onLoadingChange(true);
    onError(null);

    try {
      const r = await analyzeProduct(text, 100, provider);
      onResult(r);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
      onLoadingChange(false);
    }
  }

  function clearText() {
    setText("");
    setUploadedName(null);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <header>
        <h2 className="text-title text-ink">상품 분석</h2>
        <p className="text-body-sm text-dusty mt-1.5">
          약관 파일을 업로드하거나 본문을 붙여넣으세요.
        </p>
      </header>

      {/* 파일 업로드 영역 */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`border border-dashed rounded-[9.6px] px-5 py-5 text-center transition-colors ${
          isDragOver
            ? "border-terra bg-terra/10"
            : "border-parchment hover:border-onyx/30 bg-snow"
        } ${uploading ? "opacity-60" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={handleFileInput}
          disabled={uploading || submitting}
          className="hidden"
        />
        <div className="flex items-center justify-center gap-2 text-body">
          <span className="h-2 w-2 rounded-full bg-terra" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || submitting}
            className="text-ink hover:text-terra font-semibold underline disabled:no-underline disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure rounded"
          >
            파일 선택
          </button>
          <span className="text-dusty">또는 여기로 드래그</span>
        </div>
        <p className="text-caption text-stone mt-2">
          {SUPPORTED_EXTENSIONS.join(" · ")} · 최대 {MAX_FILE_SIZE_MB}MB
        </p>
        {uploading && (
          <p className="text-body-sm font-medium text-terra mt-2">
            텍스트 추출 중...
          </p>
        )}
        {uploadedName && !uploading && (
          <p className="text-body-sm font-medium text-graphite mt-2 num-tabular truncate">
            {uploadedName} · {length.toLocaleString()}자
          </p>
        )}
      </div>

      {/* 텍스트 입력 */}
      <div className="flex items-center justify-between">
        <label className="text-body-sm font-semibold text-graphite" htmlFor="product-text">
          본문 직접 입력
        </label>
        {text.length > 0 && (
          <button
            type="button"
            onClick={clearText}
            className="text-body-sm text-dusty hover:text-ink underline focus:outline-none focus-visible:ring-2 focus-visible:ring-azure rounded"
          >
            지우기
          </button>
        )}
      </div>
      <textarea
        id="product-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (uploadedName) setUploadedName(null);
        }}
        className="border border-onyx/20 rounded-[9.6px] px-4 py-3 h-[240px] resize-none bg-snow text-body text-ink
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-azure focus:border-onyx/30
                   placeholder:text-stone"
        placeholder="상품설명서·약관 본문 (20자 이상 20000자 이하)..."
        disabled={submitting || uploading}
      />

      <div className="flex justify-between items-center text-body-sm text-dusty num-tabular">
        <span>
          <span className="font-medium text-graphite">{length.toLocaleString()}</span>
          <span className="text-stone"> / {MAX_LEN.toLocaleString()}자</span>
        </span>
        {tooShort && (
          <span className="text-terra font-semibold">
            최소 {MIN_LEN}자 이상
          </span>
        )}
        {tooLong && (
          <span className="text-terra font-semibold">
            최대 {MAX_LEN}자 초과
          </span>
        )}
      </div>

      <LLMProviderToggle
        value={provider}
        onChange={handleProviderChange}
        disabled={submitting || uploading}
      />

      <button
        type="submit"
        disabled={!canSubmit}
        className="bg-ink text-snow rounded-[9.6px] py-3.5 text-heading font-semibold
                   disabled:opacity-40 disabled:cursor-not-allowed
                   hover:bg-onyx active:bg-graphite
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-azure focus-visible:ring-offset-2 focus-visible:ring-offset-vellum
                   transition-colors"
        aria-busy={submitting}
      >
        {submitting ? (
          <span className="inline-flex items-center justify-center gap-2">
            <ButtonSpinner />
            <span>분석 중...</span>
          </span>
        ) : (
          "타겟 분석 시작"
        )}
      </button>
    </form>
  );
}

/** 버튼 인라인 로딩 스피너 — text-snow 색 상속, motion-reduce 호환. */
function ButtonSpinner() {
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
