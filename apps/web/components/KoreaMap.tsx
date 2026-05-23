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

// ============================================================
// 메인 컴포넌트
// ============================================================

export function KoreaMap({ districts, title = "🗺️ 시군구 분포 지도" }: Props) {
  const appkey = process.env.NEXT_PUBLIC_KAKAO_MAP_APPKEY ?? "";
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    name: string;
    count: number;
    avg: number;
  } | null>(null);

  // 백엔드 데이터 → 매칭 키 lookup table
  const { countMap, scoreMap, maxCount, totalCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    const scores: Record<string, number> = {};
    let max = 0;
    let total = 0;
    for (const d of districts) {
      const { province, district } = parseRegionKey(d.name);
      const key = `${province}|${normalizeDistrict(district)}`;
      counts[key] = d.count;
      scores[key] = d.avg_score;
      if (d.count > max) max = d.count;
      total += d.count;
    }
    return { countMap: counts, scoreMap: scores, maxCount: max, totalCount: total };
  }, [districts]);

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
        // 대한민국 중심 + 적절한 zoom (level 13 ≈ 전국 한 화면)
        const map = new kakao.maps.Map(containerRef.current, {
          center: new kakao.maps.LatLng(36.5, 127.85),
          level: 13,
          mapTypeId: kakao.maps.MapTypeId.ROADMAP,
          draggable: true,
          scrollwheel: true,
        });

        // 각 feature → polygon
        for (const f of geo.features) {
          const props = f.properties;
          const sido = SIDO_CODE_TO_SHORT[props.code.slice(0, 2)] ?? "";
          const districtNameNorm = normalizeDistrict(props.name);
          const key = `${sido}|${districtNameNorm}`;
          const count = countMap[key] ?? 0;
          const avg = scoreMap[key] ?? 0;
          const color = colorForCount(count, maxCount);

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
              setHoverInfo({ name: label, count, avg });
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
  }, [appkey, countMap, scoreMap, maxCount]);

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-terra px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title text-ink">{title}</h2>
          <p className="text-body-sm text-dusty num-tabular">
            타겟층 {totalCount.toLocaleString()}명 · {districts.length}개 시군구
          </p>
        </div>
        <p className="text-body-sm text-dusty mt-1">
          색이 진할수록 반응 페르소나 수가 많습니다 (terra). 모바일은 터치, PC는 마우스 오버 시 상세
          수치가 표시됩니다.
        </p>
      </header>

      <div className="relative h-[360px] sm:h-[460px] lg:h-[520px]">
        {/* 지도 컨테이너 */}
        <div ref={containerRef} className="absolute inset-0 bg-snow" />

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
              반응 페르소나{" "}
              <span className="font-semibold text-terra">
                {hoverInfo.count.toLocaleString()}명
              </span>
              {hoverInfo.avg > 0 && (
                <>
                  {" · "}평균 {hoverInfo.avg.toFixed(1)}점
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {/* 색상 legend */}
      <div className="border-t border-parchment px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2 sm:gap-3 text-caption text-dusty num-tabular">
        <span className="text-overline text-stone">밀도</span>
        <LegendSwatch color="#f5dccf" label="낮음" />
        <LegendSwatch color="#f0c2af" />
        <LegendSwatch color="#e89a82" />
        <LegendSwatch color="#d97757" />
        <LegendSwatch color="#c45f3e" label={`높음 (≤ ${maxCount.toLocaleString()}명)`} />
        <span className="mx-2 inline-block w-px h-3 bg-parchment" />
        <LegendSwatch color="#dedcd1" label="데이터 없음" />
      </div>
    </section>
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
