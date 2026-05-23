# Part 3: Frontend + Integration — Phase 4-5

> master: [../master.md](../master.md)
> 선행 Part: part2 | 후속 Part: -
> 담당 Phase: 4-5 | 변경 파일: 약 8개 | 상태: 확정

## 배포 방침 (확정)

- **로컬 데모 한정** — Vercel/Fly.io/Render 배포는 v2 이후로 미룸
- 데모 환경: `pnpm --filter web dev` (localhost:3000) + `uv run uvicorn` (localhost:8000)

## 목표 (필수)

- **Phase 4**: Next.js 단일 페이지에서 상품설명서·약관 입력 → 결과 대시보드(점수 카드, 페르소나 리스트, 지역 차트, 리포트)를 표시한다.
- **Phase 5**: E2E 흐름을 검증하고 데모 시나리오(샘플 상품 3종) + README + 간단 배포를 마무리한다.

## 전제 조건 (필수 — 선행 Part 산출물)

- [ ] part2 완료 (`POST /api/analyze` 응답 30초 내 + 스키마 안정)
- [ ] `AnalyzeResponse` 스키마 확정 (변경 시 프론트 타입 함께 업데이트)
- [ ] `apps/web` Next.js 14 + Tailwind 스캐폴딩 완료 (part1)
- [ ] CORS 허용 도메인에 `http://localhost:3000` 포함

## 작업 목록 (필수)

### Phase 4 — UI 구현

- [ ] `apps/web/lib/api.ts` — FastAPI 호출 클라이언트 + `AnalyzeResponse` 타입
- [ ] `apps/web/components/InputForm.tsx` — 상품설명서·약관 textarea + 분석 버튼 + 진행 상태
- [ ] `apps/web/components/ScoreCard.tsx` — 상위 페르소나 평균 점수·총 후보 수
- [ ] `apps/web/components/PersonaList.tsx` — 상위 20명 카드 리스트 (점수, 지역, 직업, persona 요약)
- [ ] `apps/web/components/RegionChart.tsx` — Recharts 시도 막대그래프 + 시군구 drill-down
- [ ] `apps/web/components/ReportPanel.tsx` — `react-markdown`으로 리포트 렌더링
- [ ] `apps/web/app/page.tsx` — 좌(입력) / 우(결과) 2-column 레이아웃
- [ ] 로딩·에러 상태 처리 (skeleton, retry 버튼)

### Phase 5 — 통합·데모·문서

- [ ] 샘플 상품 3종 시드 텍스트 (`docs/samples/`): 여행자보험 / 어린이보험 / 종신보험
- [ ] E2E 수동 시나리오 1회 (각 샘플 → 결과 확인)
- [ ] `README.md` — 빠른 시작 (env, 마이그레이션, 적재, 실행)
- [ ] `agent-guide/SESSION.md`에 완료 기록

## 변경 예시 (필수, 핵심 시그니처만)

> 계획서는 청사진. 전체 구현 복붙 금지.

### `apps/web/lib/api.ts` — 신규

```typescript
// part2의 AnalyzeResponse Pydantic 스키마와 1:1 대응
export type PersonaHit = {
  uuid: string;
  score: number;
  persona: string;
  province: string;
  district: string;
  sex: string;
  age: number;
  occupation: string;
};

export type RegionStat = {
  name: string;
  count: number;
  avg_score: number;
  top_persona_uuid: string | null;
};

export type SellingPoints = {
  summary: string;
  key_benefits: string[];
  target_age_min: number | null;
  target_age_max: number | null;
  target_keywords: string[];
  persona_category_weights: Record<string, number>;
};

export type AnalyzeResponse = {
  analysis_id: string;
  selling_points: SellingPoints;
  top_personas: PersonaHit[];
  province_stats: RegionStat[];
  district_stats: RegionStat[];
  report_md: string;
  elapsed_ms: Record<string, number>;
};

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export async function analyzeProduct(
  productText: string,
  topK = 20,
): Promise<AnalyzeResponse> {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_text: productText, top_k: topK }),
  });
  if (!res.ok) throw new Error(`analyze failed: ${res.status}`);
  return res.json();
}
```

### `apps/web/app/page.tsx` — 신규 (레이아웃)

```tsx
"use client";
import { useState } from "react";
import { InputForm } from "@/components/InputForm";
import { ScoreCard } from "@/components/ScoreCard";
import { PersonaList } from "@/components/PersonaList";
import { RegionChart } from "@/components/RegionChart";
import { ReportPanel } from "@/components/ReportPanel";
import type { AnalyzeResponse } from "@/lib/api";

export default function Page() {
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <main className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 p-6 min-h-screen">
      <aside className="space-y-4">
        <InputForm onResult={setResult} onLoadingChange={setLoading} />
      </aside>
      <section className="space-y-4">
        {loading && <ResultSkeleton />}
        {!loading && result && (
          <>
            <ScoreCard result={result} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <PersonaList personas={result.top_personas} />
              <RegionChart
                provinceStats={result.province_stats}
                districtStats={result.district_stats}
              />
            </div>
            <ReportPanel markdown={result.report_md} />
          </>
        )}
      </section>
    </main>
  );
}
```

### `apps/web/components/InputForm.tsx` — 신규 (핵심 시그니처)

```tsx
type Props = {
  onResult: (r: AnalyzeResponse) => void;
  onLoadingChange: (b: boolean) => void;
};

export function InputForm({ onResult, onLoadingChange }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    onLoadingChange(true); setError(null);
    try {
      const r = await analyzeProduct(text, 20);
      onResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      onLoadingChange(false);
    }
  }

  return (
    <form className="flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h1 className="text-xl font-semibold">PersonaFit</h1>
      <p className="text-sm text-gray-500">상품설명서·약관을 붙여넣으세요 (20자 이상)</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="border rounded p-3 h-[60vh] font-mono text-sm"
        placeholder="상품설명서와 약관 본문..."
      />
      <button type="submit"
              disabled={text.length < 20}
              className="bg-black text-white rounded py-2 disabled:opacity-40">
        타겟 분석 시작
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </form>
  );
}
```

### `apps/web/components/RegionChart.tsx` — 신규 (Recharts)

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type Props = {
  provinceStats: RegionStat[];
  districtStats: RegionStat[];
};

export function RegionChart({ provinceStats, districtStats }: Props) {
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);

  // 1) 시도 전체 막대그래프
  // 2) 시도 클릭 → districtStats 중 해당 시도 prefix(`서울-`)만 필터링하여 표시
  return (
    <div className="border rounded p-3">
      <h2 className="font-semibold mb-2">지역별 분포</h2>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={selectedProvince ? districtStats : provinceStats}
                  onClick={(e) => !selectedProvince && setSelectedProvince(e?.activeLabel ?? null)}>
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" />
        </BarChart>
      </ResponsiveContainer>
      {selectedProvince && (
        <button onClick={() => setSelectedProvince(null)}
                className="text-sm underline">← 전체 시도 보기</button>
      )}
    </div>
  );
}
```

### `apps/web/components/PersonaList.tsx` — 신규

```tsx
export function PersonaList({ personas }: { personas: PersonaHit[] }) {
  return (
    <ul className="border rounded divide-y max-h-[420px] overflow-auto">
      {personas.map((p) => (
        <li key={p.uuid} className="p-3 hover:bg-gray-50">
          <div className="flex justify-between text-sm">
            <span>{p.province} · {p.district} · {p.sex} {p.age}세</span>
            <span className="font-mono">{p.score.toFixed(1)}</span>
          </div>
          <div className="text-xs text-gray-500">{p.occupation}</div>
          <p className="text-sm mt-1 line-clamp-2">{p.persona}</p>
        </li>
      ))}
    </ul>
  );
}
```

### `apps/web/components/ReportPanel.tsx` — 신규

```tsx
import ReactMarkdown from "react-markdown";

export function ReportPanel({ markdown }: { markdown: string }) {
  return (
    <article className="border rounded p-4 prose prose-sm max-w-none">
      <ReactMarkdown>{markdown}</ReactMarkdown>
    </article>
  );
}
```

### `docs/samples/travel-insurance.txt` — 신규 (예시)

```text
[해외여행자보험 약관 발췌]
보장기간: 출국일 0시 ~ 입국일 24시 (최대 90일)
보장: 해외 의료비, 휴대품 손해, 항공기 지연 위로금
가입자격: 만 19세 이상 80세 이하
...
```

> 동일 형식으로 `children-insurance.txt`, `whole-life.txt` 작성.

### `README.md` — 신규 (핵심 섹션만)

```markdown
# PersonaFit

상품설명서·약관 → 반응할 타겟 페르소나·반응도·공략 지역 산출 도구.

## Quickstart

\`\`\`bash
# 1) 의존성
pnpm install
cd apps/api && uv sync

# 2) 환경변수
cp .env.example .env  # 후 실제 키 입력

# 3) DB 마이그레이션 + 데이터 적재 (1회만)
supabase db push
python scripts/sample_and_load.py
python scripts/embed_personas.py

# 4) 실행
pnpm --filter web dev                          # http://localhost:3000
cd apps/api && uv run uvicorn main:app --reload  # http://localhost:8000
\`\`\`

## 데이터 출처

- nvidia/Nemotron-Personas-Korea (CC BY 4.0)
```

## 검증 (필수)

```bash
# Phase 4
pnpm --filter web dev          # 정상 부팅, 페이지 200
# 브라우저: 텍스트 입력 → "타겟 분석 시작" → 로딩 → 결과 4섹션 표시 확인

# Phase 5 (데모 시나리오)
# 샘플 3종 각각 분석 → 다음 항목 시각 확인
#  - 여행자보험   → travel_persona 가중치 ↑, 30-40대 우세, 서울/경기 ↑
#  - 어린이보험   → family_persona 가중치 ↑, "배우자·자녀와 거주" 비중 ↑
#  - 종신보험     → 40-60대, family_persona 가중치 ↑

# 빌드
pnpm --filter web build        # 에러 0
cd apps/api && uv run python -c "import main"   # 임포트 에러 0
```

### 데모 체크리스트

- [ ] 입력 폼에 paste → 30초 내 결과 표시
- [ ] 시도 차트 클릭 → 시군구 drill-down 작동
- [ ] 리포트 마크다운에 헤더·불릿 정상 렌더링
- [ ] 새로고침 후 재분석 → 동일 결과 (idempotent — 동일 텍스트면 동일 임베딩 → 동일 후보)
- [ ] Supabase `analyses` 테이블에 3건 이상 저장됨

## 완료 기준 (필수 — 작업 종료)

- [ ] 모든 작업 목록 완료
- [ ] 데모 체크리스트 5개 모두 통과
- [ ] README의 Quickstart로 새 환경 셋업 가능 (실제 따라 한번 시도)
- [ ] master의 Phase 맵에서 Phase 4, 5 상태를 ✅로 갱신
- [ ] `agent-guide/SESSION.md`에 세션 완료 기록
- [ ] 계획서 디렉토리(`work-plan_260520_personafit-mvp/`)를 `agent-guide/.archive/`로 이동
