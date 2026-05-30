"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getProductBody,
  listProducts,
  type ProductSummary,
} from "@/lib/api";

type Props = {
  /** 약관 본문 텍스트 + 표시 라벨이 준비되면 호출됨 */
  onPick: (args: { text: string; label: string; productId: string }) => void;
  /** 부모 폼이 다른 작업으로 비활성 상태일 때 셀렉터도 잠금 */
  disabled?: boolean;
  /** 에러 메시지를 부모 폼의 ErrorBanner로 위임 */
  onError: (msg: string | null) => void;
};

/**
 * 한화일반보험 카탈로그(30개)에서 상품을 골라 약관 본문을 textarea로 주입.
 * - 약관 PDF가 등록되지 않은 상품은 disabled 표시 (data/products/pdfs/<id>.pdf 안내)
 * - 카테고리(자동차/화재·배상·기업/장기·건강·연금)별로 옵션 그룹화
 */
export function HwgiProductPicker({ onPick, disabled, onError }: Props) {
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingBody, setLoadingBody] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  // 한 번만 카탈로그 fetch
  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    listProducts()
      .then((cat) => {
        if (!cancelled) setProducts(cat.products);
      })
      .catch((e) => {
        if (!cancelled) {
          // 503 (카탈로그 없음) 등은 조용히 처리 — 셀렉터만 비활성
          console.warn("상품 카탈로그 로드 실패:", e);
          setProducts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 카테고리별 그룹화
  const groups = useMemo(() => {
    if (!products) return [];
    const byCat = new Map<string, ProductSummary[]>();
    for (const p of products) {
      if (!byCat.has(p.category)) byCat.set(p.category, []);
      byCat.get(p.category)!.push(p);
    }
    return Array.from(byCat.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "ko"),
    );
  }, [products]);

  const availableCount = products?.filter((p) => p.body_available).length ?? 0;
  const totalCount = products?.length ?? 0;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setSelectedId(id);
    if (!id) return;
    const product = products?.find((p) => p.id === id);
    if (!product) return;

    if (!product.body_available) {
      onError(
        `약관 PDF가 등록되지 않았습니다. data/products/pdfs/${id}.pdf 에 PDF 파일을 두면 자동으로 불러옵니다.`,
      );
      setSelectedId("");
      return;
    }

    onError(null);
    setLoadingBody(true);
    try {
      const body = await getProductBody(id);
      onPick({
        text: body.text,
        label: `${product.official_name} (${product.id})`,
        productId: id,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      setSelectedId("");
    } finally {
      setLoadingBody(false);
    }
  }

  const isDisabled = disabled || loadingList || loadingBody;

  return (
    <div className="border border-parchment rounded-[9.6px] bg-snow px-5 py-4">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <label
          htmlFor="hwgi-product"
          className="text-body-sm font-semibold text-graphite"
        >
          한화일반보험 상품에서 불러오기
        </label>
        {products && totalCount > 0 && (
          <span className="text-caption text-stone num-tabular">
            약관 등록 {availableCount} / 전체 {totalCount}
          </span>
        )}
      </div>

      {/* native select 화살표는 브라우저가 우측 끝에 강제로 그리므로 위치 조정 불가.
          appearance-none으로 native 제거 후 커스텀 chevron을 우측에서 안쪽으로 들여 배치. */}
      <div className="relative">
        <select
          id="hwgi-product"
          value={selectedId}
          onChange={handleChange}
          disabled={isDisabled || groups.length === 0}
          className="w-full appearance-none border border-onyx/20 rounded-[9.6px] pl-3 pr-10 py-2.5 bg-vellum text-body text-ink
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-azure focus:border-onyx/30
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">
            {loadingList
              ? "카탈로그 불러오는 중..."
              : groups.length === 0
                ? "카탈로그 없음 (크롤러 실행 필요)"
                : "상품을 선택하세요"}
          </option>
          {groups.map(([cat, items]) => (
            <optgroup key={cat} label={cat}>
              {items.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  disabled={!p.body_available}
                >
                  {p.official_name}
                  {p.body_available
                    ? p.body_chars
                      ? ` · ${p.body_chars.toLocaleString()}자`
                      : ""
                    : " · 약관 미등록"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-stone"
        >
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {loadingBody && (
        <p className="text-body-sm font-medium text-terra mt-2">
          약관 본문 불러오는 중...
        </p>
      )}
    </div>
  );
}
