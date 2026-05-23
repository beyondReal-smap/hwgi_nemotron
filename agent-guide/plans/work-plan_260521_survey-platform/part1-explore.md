# Part 1: 페르소나 탐색 — Phase 1

> master: [../master.md](../master.md)
> 선행 Part: - | 후속 Part: part2
> 담당 Phase: 1 | 변경 파일: 6개 | 상태: 초안

## 목표

- `/personas` 라우트에서 자연어 + 메타데이터 필터로 페르소나 그룹을 선별, 카드/테이블 토글로 결과를 보고, 상세 모달에서 프로필을 확인하고, "세그먼트로 저장" 액션을 트리거할 수 있는 UI/API 완성 (저장 실제 동작은 part2).

## 전제 조건

- [ ] 기존 `apps/api/services/persona_search.py` 동작 확인 (자연어 검색 + 임계값 카운트)
- [ ] 기존 `apps/api/services/store.py`의 `filter_candidates()` 시그니처 확인 (sex/age/family_type/education/occupation 메타 필터)
- [ ] 한화 디자인 토큰(`vellum/ink/terra/azure/parchment/snow/dusty/graphite/stone`) 및 `SectionCard` 헤더 패턴 숙지

## 작업 목록

- [ ] 백엔드 `GET /api/dataset/personas/filter` 엔드포인트 추가 (메타 필터 + 페이지네이션 + 분포 통계)
- [ ] 프론트 `lib/api.ts`에 `filterPersonas` / `PersonaFilter` 타입 추가
- [ ] `/personas/page.tsx` 컨테이너 — sticky 헤더, 좌 필터 사이드바, 우 결과 영역
- [ ] `PersonaFilterPanel.tsx` — 연령대/성별/지역/직업군/가구유형 + 자연어 입력
- [ ] `PersonaCardGrid.tsx` — 카드 뷰(persona text 발췌) / 테이블 뷰 토글, 다중 선택
- [ ] `PersonaDetailModal.tsx` — 프로필 카드 (인구통계, 6 페르소나 카테고리, 풀 텍스트)
- [ ] `SiteHeader.tsx` 네비에 "탐색" 항목 추가 (IconUsers 신규)
- [ ] "세그먼트로 저장" CTA — 버튼만 노출, 클릭 시 모달(part2에서 실제 저장 wire-up)

## 변경 예시 (핵심 시그니처만)

**`apps/api/routes/dataset.py` — 수정**
```python
class PersonaFilterRequest(BaseModel):
    age_min: int | None = Field(None, ge=0, le=120)
    age_max: int | None = Field(None, ge=0, le=120)
    sex: list[Literal["남자", "여자"]] = Field(default_factory=list)
    provinces: list[str] = Field(default_factory=list)
    family_types: list[str] = Field(default_factory=list)
    education_levels: list[str] = Field(default_factory=list)
    occupations: list[str] = Field(default_factory=list)
    query: str | None = Field(None, max_length=500, description="자연어 쿼리 (옵션, 임베딩 매칭)")
    page: int = Field(1, ge=1)
    page_size: int = Field(24, ge=1, le=100)

class PersonaFilterResponse(BaseModel):
    total: int                              # 필터 일치 총 건수
    page_personas: list[PersonaCard]        # 현재 페이지 카드들
    distribution: dict                      # {"sex": {...}, "age_bins": [...], "province": {...}}
    has_query: bool                         # 자연어 사용 여부 → 정렬 기준 표시용

@router.post("/personas/filter", response_model=PersonaFilterResponse)
def personas_filter(req: PersonaFilterRequest) -> PersonaFilterResponse:
    """메타 필터 + 옵션 자연어 검색. 일치 분포까지 함께 반환."""
    # 1) store.filter_candidates(req)로 후보 인덱스 추출
    # 2) req.query 있으면 그 인덱스 대상으로 cosine_topk 정렬, 없으면 random sample
    # 3) page 슬라이스 + 분포 집계(numpy)
```

**`apps/web/lib/api.ts` — 수정**
```typescript
export type PersonaCard = {
  uuid: string;
  sex: "남자" | "여자";
  age: number;
  province: string;
  district: string;
  occupation: string;
  family_type: string | null;
  persona: string;          // 발췌
  similarity?: number;      // 자연어 쿼리가 있을 때만
};

export async function filterPersonas(req: PersonaFilterRequest): Promise<PersonaFilterResponse>;
```

**`apps/web/app/personas/page.tsx` — 신규**
```tsx
// 레이아웃: SectionCard 헤더 + 12-col grid
// 좌측 4col: PersonaFilterPanel (sticky)
// 우측 8col: 분포 미니 카드(3개) + PersonaCardGrid + 페이지네이션 + 선택 카운터 + "세그먼트 저장" CTA
//
// 상태 훅: filter(요청 객체), selected(Set<uuid>), view("card"|"table"), modal(uuid|null)
// useEffect로 filter 변경 시 debounce 300ms 후 filterPersonas() 호출
```

**`apps/web/components/PersonaFilterPanel.tsx` — 신규**
```tsx
// SectionCard 1개 + 그 안에 필터 블록 5종
// - 자연어 입력 (textarea)
// - 연령대 슬라이더 (0~100)
// - 성별 체크박스 (남/여)
// - 지역 multi-select (provinces 17개)
// - 가구유형/학력/직업 — react-select 또는 자체 체크박스 그룹
// onChange로 상위 컨테이너에 filter 객체 전달
```

**`apps/web/components/PersonaCardGrid.tsx` — 신규**
```tsx
// view="card": grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4
//   카드: 좌상단 체크박스, 인구통계 라인, persona 발췌 4줄 line-clamp-4, 우상단 similarity %(있을 때)
// view="table": <table> 페이지네이션 가능
// 다중 선택 → 상단 sticky 액션 바에 "N명 선택됨 · 세그먼트 저장"
```

**`apps/web/components/SiteHeader.tsx` — 수정**
```tsx
+ <NavLink href="/personas" active={!!isPersonas} icon={<IconUsers />} label="탐색" />
```

## 검증

```bash
# 백엔드 import 검증
cd apps/api && .venv/bin/python -c "from routes.dataset import personas_filter; print('OK')"

# 프론트 타입·빌드
cd apps/web && npx tsc --noEmit && pnpm build

# API 스모크 (필터)
curl -s -X POST http://localhost:5101/api/dataset/personas/filter \
  -H "Content-Type: application/json" \
  -d '{"age_min":30,"age_max":39,"sex":["여자"],"query":"워킹맘 수도권","page":1,"page_size":12}' | jq '.total, .distribution.sex, (.page_personas|length)'
```

## 완료 기준

- [ ] `/personas` 페이지 200 응답, 필터 변경 시 300ms 디바운스 후 결과 갱신
- [ ] 자연어 쿼리 입력 시 카드에 similarity % 표시, 임계값 카운트 패널 노출(자연어 검색 기존 UX와 일관)
- [ ] 카드 ↔ 테이블 토글, 다중 선택, 상세 모달 모두 동작
- [ ] "세그먼트 저장" 버튼은 노출되나 실제 저장 wire-up은 part2에서 (TODO 주석 OK)
- [ ] master Phase 맵 상태 ⬜ → ✅
- [ ] 빌드 + pm2 restart 성공
