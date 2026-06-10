"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryObject } from "topojson-specification";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import type { RegionStat } from "@/lib/api";
import {
  SIDO_CODE_TO_SHORT,
  normalizeDistrict,
  parseRegionKey,
} from "@/lib/koreaRegions";

type Props = {
  districts: RegionStat[];
  /** 카드 헤더 제목 (옵션) */
  title?: string;
};

type DistrictProps = {
  name: string;
  code: string;
  name_eng?: string;
  base_year?: string;
};

// ============================================================
// 모듈 전역: GeoJSON / Kakao SDK 캐시 (재마운트 시 재로드 방지)
// ============================================================

let geoJsonPromise: Promise<FeatureCollection<Polygon | MultiPolygon, DistrictProps>> | null = null;
let kakaoLoaderPromise: Promise<KakaoMaps> | null = null;

type KakaoMaps = typeof window & {
  kakao: {
    maps: {
      load(cb: () => void): void;
      Map: new (container: HTMLElement, options: Record<string, unknown>) => unknown;
      LatLng: new (lat: number, lng: number) => unknown;
      LatLngBounds: new () => {
        extend: (latlng: unknown) => void;
        isEmpty: () => boolean;
      };
      Polygon: new (options: Record<string, unknown>) => {
        setMap: (map: unknown) => void;
      };
      event: {
        addListener: (target: unknown, type: string, fn: (...args: unknown[]) => void) => void;
      };
      MapTypeId: { ROADMAP: unknown };
    };
  };
};

function loadGeoJson(): Promise<
  FeatureCollection<Polygon | MultiPolygon, DistrictProps>
> {
  if (!geoJsonPromise) {
    geoJsonPromise = fetch("/geo/skorea-municipalities.topo.json")
      .then((r) => {
        if (!r.ok) throw new Error(`GeoJSON HTTP ${r.status}`);
        return r.json();
      })
      .then((topo: Topology) => {
        const key = Object.keys(topo.objects)[0];
        const obj = topo.objects[key] as GeometryObject;
        return feature(topo, obj) as FeatureCollection<
          Polygon | MultiPolygon,
          DistrictProps
        >;
      });
  }
  return geoJsonPromise;
}

function loadKakaoSdk(appkey: string): Promise<KakaoMaps> {
  if (kakaoLoaderPromise) return kakaoLoaderPromise;
  kakaoLoaderPromise = new Promise<KakaoMaps>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Kakao SDK는 클라이언트에서만 로드"));
      return;
    }
    const w = window as unknown as KakaoMaps;
    if (w.kakao?.maps) {
      w.kakao.maps.load(() => resolve(w));
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appkey}&autoload=false`;
    script.onload = () => {
      const w2 = window as unknown as KakaoMaps;
      if (!w2.kakao?.maps) {
        reject(new Error("Kakao SDK 로드 완료지만 kakao.maps 없음"));
        return;
      }
      w2.kakao.maps.load(() => resolve(w2));
    };
    script.onerror = () =>
      reject(new Error("Kakao SDK 스크립트 로드 실패 (appkey/도메인 등록 확인)"));
    document.head.appendChild(script);
  });
  return kakaoLoaderPromise;
}

// ============================================================
// 색상 매핑 — count → terra 진하기
// ============================================================

function colorForCount(count: number, max: number): string {
  if (max <= 0 || count <= 0) return "#dedcd1"; // parchment (데이터 없음)
  const ratio = Math.min(1, count / max);
  // 5단계 quantize: 진한 terra → 연한 vellum 톤
  if (ratio >= 0.8) return "#c45f3e"; // 진한 terra
  if (ratio >= 0.55) return "#d97757"; // terra
  if (ratio >= 0.3) return "#e89a82"; // 연한 terra
  if (ratio >= 0.1) return "#f0c2af"; // 더 연한 terra
  return "#f5dccf"; // 가장 옅음
}

// 색에 의존하지 않는 밀도 카테고리 텍스트 (DV-002: color-not-only-data)
function densityLabelForCount(count: number, max: number): string {
  if (max <= 0 || count <= 0) return "데이터 없음";
  const ratio = Math.min(1, count / max);
  if (ratio >= 0.55) return "높음";
  if (ratio >= 0.3) return "중간";
  return "낮음";
}

// 농도(per-capita) 모드 — '인구 대비 반응 집중도(lift)'로 칠한다. 모집단 표본이 작은
// 소지역은 분모 아티팩트(농도 과장)가 크므로 임계 미만은 색칠에서 제외(정직성).
const MIN_POP_DENSITY = 300;

function colorForLift(lift: number | null, pop: number | null): string {
  if (lift == null || pop == null || pop < MIN_POP_DENSITY) return "#dedcd1"; // 표본 부족/없음
  if (lift >= 2.0) return "#c45f3e"; // 전국 대비 2배+ 집중
  if (lift >= 1.5) return "#d97757";
  if (lift >= 1.15) return "#e89a82";
  if (lift >= 0.85) return "#f0c2af"; // 전국 평균 수준
  return "#f5dccf"; // 과소
}

function densityLabelForLift(lift: number | null, pop: number | null): string {
  if (lift == null || pop == null || pop < MIN_POP_DENSITY) return "표본 부족";
  if (lift >= 1.5) return "매우 진함";
  if (lift >= 1.15) return "진함";
  if (lift >= 0.85) return "평균";
  return "옅음";
}

// ============================================================
// 메인 컴포넌트
// ============================================================

export function KoreaMap({ districts, title = "시군구 분포 지도" }: Props) {
  const appkey = process.env.NEXT_PUBLIC_KAKAO_MAP_APPKEY ?? "";
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"count" | "density">("count");
  const [hoverInfo, setHoverInfo] = useState<{
    name: string;
    count: number;
    avg: number;
    lift: number | null;
    pop: number | null;
  } | null>(null);
  // 지도 인스턴스를 ref로 1회 유지 — 모드 토글 시 폴리곤만 재색칠(지도 재생성 깜빡임 방지)
  const mapRef = useRef<unknown>(null);

  // 백엔드 데이터 → 매칭 키 lookup table
  const {
    countMap,
    scoreMap,
    liftMap,
    popMap,
    maxCount,
    maxLift,
    totalCount,
    hasLift,
  } = useMemo(() => {
    const counts: Record<string, number> = {};
    const scores: Record<string, number> = {};
    const lifts: Record<string, number | null> = {};
    const pops: Record<string, number | null> = {};
    let max = 0;
    let maxL = 0;
    let total = 0;
    let anyLift = false;
    for (const d of districts) {
      const { province, district } = parseRegionKey(d.name);
      const key = `${province}|${normalizeDistrict(district)}`;
      counts[key] = d.count;
      scores[key] = d.avg_score;
      const lift = d.lift_ratio ?? null;
      const pop = d.population_count ?? null;
      lifts[key] = lift;
      pops[key] = pop;
      if (d.count > max) max = d.count;
      if (lift != null && pop != null && pop >= MIN_POP_DENSITY) {
        anyLift = true;
        if (lift > maxL) maxL = lift;
      }
      total += d.count;
    }
    return {
      countMap: counts,
      scoreMap: scores,
      liftMap: lifts,
      popMap: pops,
      maxCount: max,
      maxLift: maxL,
      totalCount: total,
      hasLift: anyLift,
    };
  }, [districts]);

  // lift 데이터가 없으면(overview 등 비-분석 호출) 농도 모드 비활성 → 항상 인원 모드
  const effectiveMode = hasLift ? mode : "count";

  // 스크린리더 요약용: 인원 많은 순 정렬 (원본 불변)
  const srSummary = useMemo(
    () => [...districts].sort((a, b) => b.count - a.count),
    [districts],
  );

  useEffect(() => {
    if (!appkey) {
      setStatus("error");
      setErrorMsg(
        "NEXT_PUBLIC_KAKAO_MAP_APPKEY 환경변수가 없습니다. .env에 카카오 JavaScript 키를 설정한 뒤 web을 재배포해주세요.",
      );
      return;
    }
    if (!containerRef.current) return;

    let cancelled = false;
    let polygons: { setMap: (m: unknown) => void }[] = [];

    (async () => {
      try {
        const [geo, sdk] = await Promise.all([loadGeoJson(), loadKakaoSdk(appkey)]);
        if (cancelled || !containerRef.current) return;

        const { kakao } = sdk;
        // 대한민국 중심 + 적절한 zoom (level 13 ≈ 전국 한 화면).
        // 지도는 1회만 생성하고 ref로 재사용 — 인원/농도 토글 시 폴리곤만 다시 칠해
        // 지도 재생성에 따른 깜빡임/메모리 누적을 막는다.
        let map = mapRef.current;
        if (!map) {
          map = new kakao.maps.Map(containerRef.current, {
            center: new kakao.maps.LatLng(36.5, 127.85),
            level: 13,
            mapTypeId: kakao.maps.MapTypeId.ROADMAP,
            draggable: true,
            scrollwheel: true,
          });
          mapRef.current = map;
        }

        // 각 feature → polygon
        for (const f of geo.features) {
          const props = f.properties;
          const sido = SIDO_CODE_TO_SHORT[props.code.slice(0, 2)] ?? "";
          const districtNameNorm = normalizeDistrict(props.name);
          const key = `${sido}|${districtNameNorm}`;
          const count = countMap[key] ?? 0;
          const avg = scoreMap[key] ?? 0;
          const lift = liftMap[key] ?? null;
          const pop = popMap[key] ?? null;
          const color =
            effectiveMode === "density"
              ? colorForLift(lift, pop)
              : colorForCount(count, maxCount);

          const polys = (
            f.geometry.type === "Polygon"
              ? [f.geometry.coordinates]
              : f.geometry.coordinates
          ) as number[][][][];

          for (const rings of polys) {
            // 외곽만 사용 (구멍 무시 — 한국 행정구역엔 거의 없음)
            const path = rings[0].map(
              ([lng, lat]) => new kakao.maps.LatLng(lat, lng),
            );

            const polygon = new kakao.maps.Polygon({
              path,
              strokeWeight: 1,
              strokeColor: "#73726c",
              strokeOpacity: 0.5,
              fillColor: color,
              fillOpacity: 0.75,
            });
            polygon.setMap(map);
            polygons.push(polygon);

            // hover 효과 — Polygon mouseover/out 이벤트
            const label = `${sido} ${props.name}`;
            kakao.maps.event.addListener(polygon, "mouseover", () => {
              setHoverInfo({ name: label, count, avg, lift, pop });
            });
            kakao.maps.event.addListener(polygon, "mouseout", () => {
              setHoverInfo(null);
            });
          }
        }

        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const p of polygons) p.setMap(null);
      polygons = [];
    };
  }, [appkey, countMap, scoreMap, liftMap, popMap, maxCount, maxLift, effectiveMode]);

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title text-ink">{title}</h2>
          <p className="text-body-sm text-dusty num-tabular">
            타겟층 {totalCount.toLocaleString()}명 · {districts.length}개 시군구
          </p>
        </div>
        {hasLift && (
          <div
            className="mt-2.5 inline-flex rounded-[9.6px] border border-parchment bg-vellum p-0.5"
            role="tablist"
            aria-label="지도 표시 모드"
          >
            <ModeTab
              active={effectiveMode === "count"}
              onClick={() => setMode("count")}
              label="인원"
            />
            <ModeTab
              active={effectiveMode === "density"}
              onClick={() => setMode("density")}
              label="농도"
            />
          </div>
        )}
        <p className="text-body-sm text-dusty mt-2">
          {effectiveMode === "density"
            ? "색이 진할수록 인구 수에 비해 응답이 많은 지역입니다 — 인구가 적어도 응답이 많은 숨은 지역을 찾을 수 있습니다 (인구가 너무 적은 지역은 제외)."
            : "색이 진할수록 반응 페르소나 수가 많습니다 (terra). 모바일은 터치, PC는 마우스 오버 시 상세 수치가 표시됩니다."}
        </p>
      </header>

      <div className="relative h-[360px] sm:h-[460px] lg:h-[520px]">
        {/* 지도 컨테이너 */}
        <div
          ref={containerRef}
          className="absolute inset-0 bg-snow"
          role="img"
          aria-label="전국 시군구 분포 지도. 색이 진할수록 반응 페르소나 많음"
          aria-describedby="korea-map-sr-summary"
        />

        {/* 스크린리더용 데이터 요약 (DV-001/DV-003: Kakao 폴리곤은 키보드 포커스 미지원 → 텍스트 대체) */}
        <div id="korea-map-sr-summary" className="sr-only">
          <p>
            전국 시군구 반응 페르소나 분포. 총 {totalCount.toLocaleString()}명, {districts.length}
            개 시군구. 시군구별 인원(많은 순):
          </p>
          <ul>
            {srSummary.map((d) => (
              <li key={d.name}>
                {d.name}: {d.count.toLocaleString()}명, 밀도 {densityLabelForCount(d.count, maxCount)}
                {d.avg_score > 0 ? `, 평균 ${d.avg_score.toFixed(1)}점` : ""}
              </li>
            ))}
          </ul>
        </div>

        {/* 로딩 / 에러 오버레이 */}
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-vellum/70 backdrop-blur-sm">
            <p className="text-body-sm text-dusty">지도를 불러오는 중...</p>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-vellum/95 p-6">
            <div className="max-w-md text-center">
              <p className="text-heading text-ink mb-2">지도를 표시할 수 없습니다</p>
              <p className="text-body-sm text-graphite leading-relaxed">
                {errorMsg ??
                  "Kakao Maps SDK 로드에 실패했습니다. appkey와 도메인 등록을 확인해주세요."}
              </p>
            </div>
          </div>
        )}

        {/* hover tooltip */}
        {hoverInfo && status === "ready" && (
          <div
            className="absolute top-3 left-3 bg-snow border border-parchment rounded-[9.6px] px-3 py-2 shadow-sm pointer-events-none z-10"
            role="status"
          >
            <p className="text-body-sm font-semibold text-ink">{hoverInfo.name}</p>
            <p className="text-caption text-graphite num-tabular mt-0.5">
              {effectiveMode === "density" ? (
                <>
                  인구 대비 농도{" "}
                  <span className="font-semibold text-terra">
                    {hoverInfo.lift != null ? `×${hoverInfo.lift.toFixed(1)}` : "—"}
                  </span>
                  {" · "}
                  {densityLabelForLift(hoverInfo.lift, hoverInfo.pop)}
                  {hoverInfo.pop != null && (
                    <>
                      {" · "}모집단 {hoverInfo.pop.toLocaleString()}명
                    </>
                  )}
                  {" · "}타겟 {hoverInfo.count.toLocaleString()}명
                </>
              ) : (
                <>
                  반응 페르소나{" "}
                  <span className="font-semibold text-terra">
                    {hoverInfo.count.toLocaleString()}명
                  </span>
                  {" · "}밀도 {densityLabelForCount(hoverInfo.count, maxCount)}
                  {hoverInfo.avg > 0 && (
                    <>
                      {" · "}평균 {hoverInfo.avg.toFixed(1)}점
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {/* 색상 legend */}
      <div className="border-t border-parchment px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2 sm:gap-3 text-caption text-dusty num-tabular">
        <span className="text-overline text-stone">
          {effectiveMode === "density" ? "농도" : "밀도"}
        </span>
        <LegendSwatch color="#f5dccf" label={effectiveMode === "density" ? "과소" : "낮음"} />
        <LegendSwatch color="#f0c2af" />
        <LegendSwatch color="#e89a82" />
        <LegendSwatch color="#d97757" />
        <LegendSwatch
          color="#c45f3e"
          label={
            effectiveMode === "density"
              ? `높음 (×${maxLift.toFixed(1)})`
              : `높음 (≤ ${maxCount.toLocaleString()}명)`
          }
        />
        <span className="mx-2 inline-block w-px h-3 bg-parchment" />
        <LegendSwatch
          color="#dedcd1"
          label={effectiveMode === "density" ? "표본 부족/없음" : "데이터 없음"}
        />
      </div>
    </section>
  );
}

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1 rounded-[7px] text-body-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-azure ${
        active
          ? "bg-terra text-snow shadow-sm"
          : "text-graphite hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function LegendSwatch({ color, label }: { color: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-4 h-3 rounded-[2px] border border-parchment"
        style={{ backgroundColor: color }}
      />
      {label && <span>{label}</span>}
    </span>
  );
}
