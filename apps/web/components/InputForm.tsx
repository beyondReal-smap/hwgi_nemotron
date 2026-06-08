"use client";

import { useRef, useState } from "react";
import {
  analyzeProduct,
  analyzeProductStream,
  extractTextFromFile,
  MAX_FILE_SIZE_MB,
  SUPPORTED_EXTENSIONS,
  type AnalyzeResponse,
  type PopulationStats,
  type SellingPoints,
} from "@/lib/api";
import { HwgiProductPicker } from "@/components/HwgiProductPicker";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    // 단계별 부분 결과를 누적해 AnalyzeResponse로 조립한다. score 단계 이후부터
    // population_stats가 채워지므로 그 시점부터 onResult로 점진 렌더한다.
    const acc: Partial<AnalyzeResponse> = {};
    let serverErrorDetail: string | null = null;
    let lastReportFlush = 0; // 리포트 토큰 렌더 스로틀(ms) — 토큰마다 setState 폭주 방지
    const assemble = (): AnalyzeResponse => ({
      // selling_points/population_stats는 score 단계 이후에만 assemble되어 항상 존재한다.
      analysis_id: acc.analysis_id ?? "pending",
      selling_points: acc.selling_points as SellingPoints,
      top_personas: acc.top_personas ?? [],
      mid_personas: acc.mid_personas ?? [],
      bottom_personas: acc.bottom_personas ?? [],
      province_stats: acc.province_stats ?? [],
      district_stats: acc.district_stats ?? [],
      population_stats: acc.population_stats as PopulationStats,
      top_opinions: acc.top_opinions ?? [],
      mid_opinions: acc.mid_opinions ?? [],
      bottom_opinions: acc.bottom_opinions ?? [],
      report_md: acc.report_md ?? "",
      segments: acc.segments ?? [],
      elapsed_ms: acc.elapsed_ms ?? {},
    });

    try {
      await analyzeProductStream(text, 100, "sllm", (ev) => {
        switch (ev.event) {
          case "selling_points":
            acc.selling_points = ev.data.selling_points;
            acc.elapsed_ms = ev.data.elapsed_ms;
            break;
          case "score":
            acc.top_personas = ev.data.top_personas;
            acc.mid_personas = ev.data.mid_personas;
            acc.bottom_personas = ev.data.bottom_personas;
            acc.province_stats = ev.data.province_stats;
            acc.district_stats = ev.data.district_stats;
            acc.population_stats = ev.data.population_stats;
            acc.segments = ev.data.segments;
            acc.elapsed_ms = ev.data.elapsed_ms;
            onLoadingChange(false); // 결과 영역을 즉시 노출(이후 의견·리포트는 점진 채움)
            onResult(assemble());
            break;
          case "opinions":
            acc.top_opinions = ev.data.top_opinions;
            acc.mid_opinions = ev.data.mid_opinions;
            acc.bottom_opinions = ev.data.bottom_opinions;
            acc.elapsed_ms = ev.data.elapsed_ms;
            onResult(assemble());
            break;
          case "report_token":
            acc.report_md = (acc.report_md ?? "") + ev.data.chunk;
            // 토큰마다 리렌더는 비싸므로 ~120ms 스로틀. 마지막 report 이벤트에서 최종 확정.
            if (Date.now() - lastReportFlush > 120) {
              lastReportFlush = Date.now();
              onResult(assemble());
            }
            break;
          case "report":
            acc.report_md = ev.data.report_md; // 완성본으로 최종 확정(스로틀로 누락된 잔여 토큰 보정)
            acc.elapsed_ms = ev.data.elapsed_ms;
            onResult(assemble());
            break;
          case "done":
            acc.analysis_id = ev.data.analysis_id;
            acc.elapsed_ms = ev.data.elapsed_ms;
            onResult(assemble());
            break;
          case "error":
            serverErrorDetail = ev.data.detail;
            break;
        }
      });
      if (serverErrorDetail) onError(serverErrorDetail);
    } catch {
      // 스트리밍 실패 — 서버가 명시 에러를 보냈으면 그대로, 아니면 결과 시작 전이면 블로킹 폴백.
      if (serverErrorDetail) {
        onError(serverErrorDetail);
      } else if (!acc.population_stats) {
        try {
          const r = await analyzeProduct(text, 100);
          onResult(r);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        }
      } else {
        onError("분석 스트림이 중간에 끊겼습니다. 표시된 부분 결과는 유효합니다.");
      }
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
      {/* 제목 헤더 — 설문·탐색 등 다른 메뉴의 카드와 동일한 bg-snow 흰색 띠.
          부모 카드의 p-5 패딩을 음수 마진으로 상쇄해 띠가 카드 끝까지 닿게 한다. */}
      <header className="bg-snow border-b border-parchment -mx-5 -mt-5 px-5 py-4">
        <h2 className="text-title text-ink">상품 분석</h2>
        <p className="text-body-sm text-dusty mt-1.5">
          한화 상품을 선택하거나, 약관 파일을 업로드하거나, 본문을 붙여넣으세요.
        </p>
      </header>

      {/* 한화일반보험 카탈로그에서 불러오기 */}
      <HwgiProductPicker
        disabled={submitting || uploading}
        onError={onError}
        onPick={({ text: body, label }) => {
          setText(body);
          setUploadedName(label);
        }}
      />

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
          aria-label="파일 업로드"
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
        aria-invalid={tooShort || tooLong}
        aria-describedby={tooShort || tooLong ? "product-text-error" : undefined}
      />

      <div className="flex justify-between items-center text-body-sm text-dusty num-tabular">
        <span>
          <span className="font-medium text-graphite">{length.toLocaleString()}</span>
          <span className="text-stone"> / {MAX_LEN.toLocaleString()}자</span>
        </span>
        {tooShort && (
          <span id="product-text-error" aria-live="polite" className="text-terra font-semibold">
            최소 {MIN_LEN}자 이상
          </span>
        )}
        {tooLong && (
          <span id="product-text-error" aria-live="polite" className="text-terra font-semibold">
            최대 {MAX_LEN}자 초과
          </span>
        )}
      </div>

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
