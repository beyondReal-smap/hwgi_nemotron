/**
 * 한국 행정구역명 정규화 유틸.
 *
 * 백엔드 데이터는 "경기-광명시"·"서울-서초구"·"서울-강남구"처럼 단축 시도명을 쓰고
 * GeoJSON 데이터(southkorea-maps / vworld 등)는 보통 "경기도", "서울특별시" 같은
 * 정식 명칭을 쓰기 때문에 매칭 시 정규화가 필요하다.
 *
 * 매칭 키: normalizeProvince(시도) + "-" + normalizeDistrict(시군구)
 */

/** 단축 시도명 → 정식 시도명 (GeoJSON ctp_kor_nm 기준) */
export const PROVINCE_SHORT_TO_FULL: Record<string, string> = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원특별자치도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전북특별자치도",
  전남: "전라남도",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
};

/** 정식 시도명 → 단축 (양방향 매칭용) */
export const PROVINCE_FULL_TO_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(PROVINCE_SHORT_TO_FULL).map(([s, f]) => [f, s]),
);

/**
 * KSCD 시도 코드 (5자리 sig_cd의 앞 2자리) → 단축 시도명.
 * 시군구 GeoJSON(skorea-municipalities-2018-topo-simple) feature.properties.code 와 매칭.
 */
export const SIDO_CODE_TO_SHORT: Record<string, string> = {
  "11": "서울",
  "21": "부산",
  "22": "대구",
  "23": "인천",
  "24": "광주",
  "25": "대전",
  "26": "울산",
  "29": "세종",
  "31": "경기",
  "32": "강원",
  "33": "충북",
  "34": "충남",
  "35": "전북",
  "36": "전남",
  "37": "경북",
  "38": "경남",
  "39": "제주",
};

/** 정식·단축 어느 쪽이 들어와도 단축 시도명으로 정규화 */
export function toShortProvince(name: string): string {
  if (PROVINCE_SHORT_TO_FULL[name]) return name;
  return PROVINCE_FULL_TO_SHORT[name] ?? name;
}

/** "성남시 분당구"처럼 띄어쓰기 포함된 시군구를 GeoJSON에 맞춰 비교 가능한 키로 */
export function normalizeDistrict(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

/**
 * 백엔드 region name("경기-광명시")을 (단축시도, 시군구)로 분해.
 * 시군구에 "-"가 들어가는 케이스는 현재 데이터셋에 없음.
 */
export function parseRegionKey(name: string): {
  province: string;
  district: string;
} {
  const idx = name.indexOf("-");
  if (idx < 0) return { province: name, district: "" };
  return { province: name.slice(0, idx), district: name.slice(idx + 1) };
}

/**
 * 매칭용 통합 키 — GeoJSON·백엔드 양쪽 모두 같은 키로 lookup.
 * 형식: "단축시도|정규화시군구" (예: "경기|광명시")
 */
export function buildRegionMatchKey(province: string, district: string): string {
  return `${toShortProvince(province)}|${normalizeDistrict(district)}`;
}
