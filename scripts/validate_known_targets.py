"""Known-target 백테스트.

정답이 명시된 약관 N건을 POST /api/analyze에 넣고,
상위 페르소나 분포가 기대 조건과 일치하는지 자동 평가한다.

이 검증은 합성 페르소나 데이터셋 자체가 신뢰 가능하다는 가정 하에,
**모델이 약관의 명시적 타겟 조건을 얼마나 정확히 잡는지**를 측정한다.

실행:
    python3 scripts/validate_known_targets.py
    → docs/VALIDATION.md 생성
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import httpx

# FastAPI 직접 호출 (Next.js rewrites 우회 → /health 등 비 /api 경로도 사용 가능)
API_BASE = os.environ.get("PERSONAFIT_API_BASE", "http://127.0.0.1:5102")
TOP_K = 20  # 상위 N명 기준으로 평가
TIMEOUT = 60.0  # /api/analyze 한 건 최대 대기 시간

OUTPUT_MD = Path("docs/VALIDATION.md")


# ============================================================
# 검증 케이스 정의
# ============================================================

@dataclass
class Check:
    """단일 체크: 상위 페르소나에 대해 람다 평가 → 통과 비율 계산."""
    name: str
    predicate: Callable[[dict], bool]
    min_ratio: float  # 통과 행 비율 ≥ 이 값이면 합격


@dataclass
class Case:
    name: str
    product_text: str
    checks: list[Check] = field(default_factory=list)
    notes: str = ""


def in_range(field_name: str, lo: int, hi: int) -> Callable[[dict], bool]:
    return lambda p: lo <= p.get(field_name, -1) <= hi


def equals(field_name: str, value: str) -> Callable[[dict], bool]:
    return lambda p: p.get(field_name) == value


def in_set(field_name: str, values: set[str]) -> Callable[[dict], bool]:
    return lambda p: p.get(field_name) in values


def contains_keyword(field_name: str, keyword: str) -> Callable[[dict], bool]:
    return lambda p: keyword in (p.get(field_name) or "")


def contains_any(field_name: str, keywords: list[str]) -> Callable[[dict], bool]:
    """필드 값에 keywords 중 하나라도 포함되면 True."""
    return lambda p: any(k in (p.get(field_name) or "") for k in keywords)


CASES: list[Case] = [
    Case(
        name="여성 전용 암보험",
        notes="가입자격을 만 20~69세 여성으로 한정 → 상위 20명이 여성에 집중되어야 함",
        product_text="""
[여성 전용 암보험 약관]
상품명: 여성 케어 암보험 Plus
가입자격: 만 20세 이상 69세 이하의 여성만 가입 가능 (남성 가입 불가).

[주요 보장]
- 여성 특화 암(유방암, 자궁암, 난소암) 진단 시 일시금 3,000만원
- 일반 암 진단비 2,000만원
- 갑상선암·기타 소액암 500만원
- 입원 의료비 1일 5만원 (최대 180일)
- 갱년기·여성 호르몬 관련 외래 진료비 연 100만원

[활용 타겟]
- 30-50대 여성 직장인 및 전업 주부
- 가족력으로 여성암 위험이 있는 분
- 정기 검진을 받고자 하는 분
""".strip(),
        checks=[
            Check("성별 = 여자", equals("sex", "여자"), min_ratio=0.90),
            Check("연령 20-69세", in_range("age", 20, 69), min_ratio=0.85),
        ],
    ),
    Case(
        name="시니어 전용 간편보험",
        notes="만 60세 이상만 가입. 고령자 우대 → 60+ 비중 높아야 함",
        product_text="""
[시니어 안심 간편 건강보험]
가입자격: 만 60세 이상 85세 이하의 대한민국 거주자.

[주요 보장]
- 간편고지형: 최근 5년간 입원·수술 이력만 고지
- 노인성 질환(치매·뇌졸중·심혈관) 진단비 1,000만원
- 골절·관절수술 비용 최대 500만원
- 입원 위로금 1일 3만원 (최대 120일)
- 사망 보장 1,000만원 (자녀 상속 자금)

[활용 타겟]
- 자녀들이 부모님 건강을 걱정하는 시니어
- 만성질환을 가진 60-80대
- 노후 의료비 부담을 줄이고 싶은 분
""".strip(),
        checks=[
            Check("연령 60-85세", in_range("age", 60, 85), min_ratio=0.75),
        ],
    ),
    Case(
        name="신혼·유자녀 가구 종합보험",
        notes="배우자·자녀 가구 우대 → family_type 분포에 자녀/배우자 포함 ↑",
        product_text="""
[신혼 가족 보장 보험]
상품명: 우리 가족 든든케어
가입자격: 만 25세 이상 49세 이하 기혼자.

[주요 보장]
- 부부 동시 가입 시 50% 보험료 할인
- 자녀 양육 단계별 자금 지원 (어린이집·초등·중고등 입학금)
- 배우자 사망 시 잔여 자녀 학자금 1억원 보장
- 가족 의료비 통합 한도 (외래 연 500만원)
- 자녀 출산 시 일시금 200만원 추가

[활용 타겟]
- 결혼 후 1-5년차 신혼 부부
- 영유아·초등학생 자녀를 키우는 30-40대
- 자녀 교육·양육비 부담 큰 맞벌이 가구
""".strip(),
        checks=[
            Check("연령 25-49세", in_range("age", 25, 49), min_ratio=0.70),
            Check(
                "가구형태에 자녀/배우자 포함",
                in_set("family_type", {
                    "배우자·자녀와 거주",
                    "배우자와 거주",
                    "자녀와 거주 (한부모)",
                    "배우자·자녀·어머니와 거주",
                    "배우자·자녀·아버지와 거주",
                    "배우자·자녀·부모와 거주",
                }),
                min_ratio=0.70,
            ),
        ],
    ),
    Case(
        name="청년 사회초년생 저축보험",
        notes="20대 청년 타겟 → age 19-29 비중 ↑",
        product_text="""
[청년 첫 저축 보험]
가입자격: 만 19세 이상 29세 이하의 청년만 가입 가능.

[주요 보장 + 혜택]
- 월 5만원부터 시작하는 소액 저축형 보험
- 5년 만기 후 환급률 110% 보증
- 첫 직장 입사·이직 시 보험료 3개월 납입 유예
- 청년 우대 금리 (시중 평균 +0.5%p)
- 입원·수술 시 1일 2만원 위로금

[활용 타겟]
- 첫 직장 사회초년생 (20-29세)
- 학생·아르바이트하면서 미래 자금 만들고 싶은 청년
- 결혼·내 집 마련 자금을 5년 안에 만들고 싶은 분
""".strip(),
        checks=[
            Check("연령 19-29세", in_range("age", 19, 29), min_ratio=0.75),
        ],
    ),
    Case(
        name="고학력 전문직 종신보험",
        notes="전문직(의사·변호사·교수 등) + 대학원 학력 타겟",
        product_text="""
[전문직 프리미엄 종신보험]
가입자격: 만 30세 이상 60세 이하 전문직 종사자.
대상 직종: 의사, 한의사, 치과의사, 변호사, 회계사, 세무사, 변리사, 대학교수, 박사급 연구원.

[주요 보장]
- 사망 보장 5억원 ~ 30억원 (직종별 차등)
- 중대질병 진단 시 사망보험금 50% 선지급
- 노후 장기간병 특약 (월 200만원, 최대 60개월)
- 자녀 유학·결혼 자금 만기 환급
- 상속세 절세 설계 자문 무료 제공

[활용 타겟]
- 고소득 전문직 30-60대
- 대학원·박사 학위 보유자
- 자녀·배우자에게 충분한 상속을 남기고 싶은 분
- 노후 의료비·간병비 부담을 미리 준비하려는 분
""".strip(),
        checks=[
            Check("연령 30-60세", in_range("age", 30, 60), min_ratio=0.70),
            Check(
                "교육수준 = 대학원/4년제 (석박사 포함)",
                in_set("education_level", {"대학원", "4년제 대학교"}),
                min_ratio=0.60,
            ),
        ],
    ),
    Case(
        name="미혼 1인가구 청년 보험",
        notes=(
            "marital_status='미혼' + family_type='혼자 거주' + 20-39세 복합 케이스. "
            "marital_status 필드가 SellingPoints 스키마에 없으므로 부족 가능"
        ),
        product_text="""
[혼라이프 든든 보험]
상품명: 1인 가구 청년 종합 보장 보험
가입자격: 만 20세 이상 39세 이하 미혼, 1인 가구로 거주하는 분.

[주요 보장]
- 응급 입원 시 1일 5만원 위로금 (혼자 사는 분의 의료비 부담 완화)
- 가전·가구 손해 보장 (단독 거주 중 화재·도난 시 300만원)
- 정신건강 상담·우울증 외래 진료비 연 50만원
- 갑작스러운 실직 시 보험료 6개월 납입 유예
- 사망 시 부모님께 상속되는 5,000만원 보장

[활용 타겟]
- 결혼하지 않고 혼자 사는 20-30대
- 첫 직장에서 자취 중인 사회초년생
- 비혼주의 또는 결혼 준비 중인 청년
""".strip(),
        checks=[
            Check("연령 20-39세", in_range("age", 20, 39), min_ratio=0.70),
            Check(
                "결혼 상태 = 미혼",
                equals("marital_status", "미혼"),
                min_ratio=0.70,
            ),
            Check(
                "가구형태 = 혼자 거주(별거 포함)",
                in_set("family_type", {"혼자 거주", "혼자 거주 (배우자 별거)"}),
                min_ratio=0.60,
            ),
        ],
    ),
    Case(
        name="은퇴자·무직 노후 보험",
        notes=(
            "직업 occupation 컬럼이 '무직' 자유텍스트 + 60+ 연령. "
            "직업 부분 매칭 (KSCO 분류) 작동 검증"
        ),
        product_text="""
[은퇴 노후 안심 보험]
가입자격: 만 60세 이상 85세 이하 무직·은퇴자.

[주요 보장 + 영업 포인트]
- 직장 의료보험 종료 후 공백을 메우는 실손 의료비
- 노인 만성질환(고혈압·당뇨·관절염) 외래 진료비 연 200만원
- 입원 1일 5만원 위로금
- 노후 장기 요양등급(1~3급) 판정 시 월 80만원, 최대 60개월
- 자녀에게 부담을 주지 않는 사망 보장 3,000만원

[활용 타겟]
- 정년 퇴직 후 새로운 직업이 없는 60대
- 자영업 폐업 후 무직 상태의 시니어
- 평생 전업 주부였던 어르신
- 자녀에게 의료비·간병비 부담을 주기 싫은 어르신
""".strip(),
        checks=[
            Check("연령 60-85세", in_range("age", 60, 85), min_ratio=0.75),
            Check(
                "비경제활동(무직/전직/구직중/은퇴) 표현",
                contains_any("occupation", ["무직", "전직", "구직중", "퇴직", "은퇴"]),
                min_ratio=0.60,
            ),
        ],
    ),
    Case(
        name="남성 전용 전립선암 보험",
        notes="첫 여성 전용 케이스의 미러 — 100% 남성이어야 함 (방향성·일관성 확인)",
        product_text="""
[남성 전립선 케어 보험]
가입자격: 만 40세 이상 75세 이하의 남성만 가입 가능.

[주요 보장]
- 전립선암 진단 시 일시금 3,000만원
- 전립선비대증·요로감염 치료비 보장
- 남성 갱년기·호르몬 검사 비용 연 50만원
- 일반 암 진단비 2,000만원
- 입원 1일 5만원 (최대 120일)

[활용 타겟]
- 40대 이상 남성 (전립선 질환 위험군)
- 가족력으로 비뇨기 질환 위험이 있는 분
- 정기 검진을 받고자 하는 중장년 남성
""".strip(),
        checks=[
            Check("성별 = 남자", equals("sex", "남자"), min_ratio=0.90),
            Check("연령 40-75세", in_range("age", 40, 75), min_ratio=0.85),
        ],
    ),
    Case(
        name="현역 군인 전용 보험",
        notes=(
            "데이터셋의 military_status='현역' 비중이 매우 낮음 (~1-2%). "
            "또한 SellingPoints 스키마에 military_status 필드 없음 — 룰 필터 불가, 임베딩+직업 매칭만"
        ),
        product_text="""
[국군 장병 안심 보험]
가입자격: 현역 복무 중인 만 19세 이상 30세 이하 남성 군인.

[주요 보장]
- 군 복무 중 부상·사고 시 의료비 일시금 3,000만원
- 훈련·작전 중 사망 시 1억원 (가족 보장)
- 제대 후 사회복귀 시 보험료 1년 유예
- 전역 후 군 정신건강(PTSD) 외래 진료비 보장
- 군 장병 무이자 대출 우대 금리

[활용 타겟]
- 현역 복무 중인 사병·간부
- 군 입대를 앞둔 청년 (부모님이 가입)
- 직업 군인(장교·부사관)
- 제대 예정자
""".strip(),
        checks=[
            Check("성별 = 남자", equals("sex", "남자"), min_ratio=0.80),
            Check("연령 19-30세", in_range("age", 19, 30), min_ratio=0.50),
            Check(
                "현역 또는 군 관련",
                lambda p: (
                    p.get("military_status") == "현역"
                    or any(k in (p.get("occupation") or "") for k in ["군인", "장교", "부사관", "병사"])
                ),
                min_ratio=0.30,
            ),
        ],
    ),
    Case(
        name="제주도 거주자 한정 보험",
        notes=(
            "province='제주' 거주자 전용 상품. "
            "SellingPoints 스키마에 target_provinces 필드 없음 — 룰 필터 불가, 임베딩만으로 잡아야 함"
        ),
        product_text="""
[제주 도민 안심 자연재해 보험]
가입자격: 제주특별자치도에 1년 이상 거주 중인 만 20세 이상 70세 이하.

[주요 보장]
- 태풍·홍수·해일 등 자연재해 피해 보상 (가전·가구 최대 500만원)
- 제주도 내 병원 의료비 실손 (서울·수도권 원정 진료비 포함)
- 농작물·어업 피해 일시금 보장 (감귤·해녀업 등)
- 관광객 안전사고 배상책임 1억원
- 제주 도민 우대 보험료 15% 할인

[활용 타겟]
- 제주에 정착한 도민 (귀촌·은퇴 이주 포함)
- 감귤 농가, 해녀, 어업 종사자
- 제주 관광업·숙박업 운영자
- 자연재해 위험이 큰 해안 거주자
""".strip(),
        checks=[
            Check("연령 20-70세", in_range("age", 20, 70), min_ratio=0.80),
            Check(
                "province = 제주",
                equals("province", "제주"),
                min_ratio=0.50,
            ),
        ],
    ),
    Case(
        name="간호사 직군 전용 보험",
        notes=(
            "occupation 부분 매칭이 작동하는지 검증. "
            "데이터셋에 '일반 간호사', '간호조무사' 등 표현 존재. KSCO 명확한 케이스"
        ),
        product_text="""
[간호 전문직 종사자 보험]
가입자격: 만 22세 이상 60세 이하 간호사·간호조무사·요양보호사 면허 보유자.

[주요 보장]
- 야간·교대 근무 스트레스 진료비 (정신건강 외래 100만원)
- 환자 응대 중 상해 위로금 (1일 3만원, 최대 60일)
- 주삿바늘 자상 감염 검사·치료비 전액
- 간호사 면허 유지 교육비 지원 (연 50만원)
- 직장·외래·종합병원 의료인 단체 가입 시 보험료 20% 할인

[활용 타겟]
- 종합병원·요양병원 간호사
- 간호조무사·요양보호사
- 의원·치과 보조 간호 인력
- 방문 간호·재가 요양 종사자
""".strip(),
        checks=[
            Check("연령 22-60세", in_range("age", 22, 60), min_ratio=0.75),
            Check(
                "직업에 '간호' 포함",
                contains_keyword("occupation", "간호"),
                min_ratio=0.40,
            ),
        ],
    ),
]


# ============================================================
# 평가 실행
# ============================================================

def call_analyze(product_text: str) -> dict[str, Any]:
    """POST /api/analyze 호출."""
    with httpx.Client(timeout=TIMEOUT) as client:
        r = client.post(
            f"{API_BASE}/api/analyze",
            json={"product_text": product_text, "top_k": TOP_K},
        )
        r.raise_for_status()
        return r.json()


def evaluate_check(personas: list[dict], check: Check) -> tuple[float, int, int, bool]:
    """check 통과 비율 계산.

    Returns:
        (ratio, passed, total, accepted)
    """
    total = len(personas)
    if total == 0:
        return 0.0, 0, 0, False
    passed = sum(1 for p in personas if check.predicate(p))
    ratio = passed / total
    accepted = ratio >= check.min_ratio
    return ratio, passed, total, accepted


def run_case(case: Case) -> dict[str, Any]:
    """단일 케이스 실행 + 결과 dict."""
    print(f"\n▶ {case.name}")
    print(f"   ({case.notes})")

    try:
        response = call_analyze(case.product_text)
    except Exception as e:
        print(f"   ❌ 분석 호출 실패: {e}")
        return {
            "case": case.name,
            "notes": case.notes,
            "error": str(e),
            "checks": [],
            "passed_checks": 0,
            "total_checks": len(case.checks),
            "case_passed": False,
        }

    personas = response.get("top_personas", [])
    sp = response.get("selling_points", {})

    print(f"   summary: {sp.get('summary', '')[:60]}")
    print(f"   top_personas: {len(personas)}명")

    check_results = []
    for check in case.checks:
        ratio, passed, total, accepted = evaluate_check(personas, check)
        emoji = "✅" if accepted else "❌"
        print(
            f"   {emoji} {check.name}: {passed}/{total} = {ratio:.0%} "
            f"(기준 ≥{check.min_ratio:.0%})"
        )
        check_results.append({
            "name": check.name,
            "passed": passed,
            "total": total,
            "ratio": ratio,
            "min_ratio": check.min_ratio,
            "accepted": accepted,
        })

    passed_checks = sum(1 for c in check_results if c["accepted"])
    return {
        "case": case.name,
        "notes": case.notes,
        "summary": sp.get("summary", ""),
        "elapsed_ms": response.get("elapsed_ms", {}),
        "top_personas_count": len(personas),
        "checks": check_results,
        "passed_checks": passed_checks,
        "total_checks": len(case.checks),
        "case_passed": passed_checks == len(case.checks),
    }


# ============================================================
# 마크다운 리포트
# ============================================================

def render_markdown(results: list[dict]) -> str:
    total_cases = len(results)
    passed_cases = sum(1 for r in results if r.get("case_passed"))
    total_checks = sum(r.get("total_checks", 0) for r in results)
    passed_checks = sum(r.get("passed_checks", 0) for r in results)

    lines: list[str] = []
    lines.append("# PersonaFit 모델 검증 리포트 — Known-target 백테스트")
    lines.append("")
    lines.append(f"> 생성: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | "
                 f"API: `{API_BASE}` | top_k={TOP_K}")
    lines.append("")
    lines.append("## 검증 방법")
    lines.append("")
    lines.append("- 정답 타겟이 약관에 **명시적**으로 적힌 케이스 5종을 입력")
    lines.append("- 모델이 반환한 상위 20명의 인구통계 속성이 명시 조건과 일치하는지 측정")
    lines.append("- 케이스마다 1~2개 자동 체크 (성별/연령/가구형태/학력 분포 비율)")
    lines.append("- 각 체크는 `통과 비율 ≥ 기준 비율`이면 ✅, 아니면 ❌")
    lines.append("")
    lines.append("## 종합 결과")
    lines.append("")
    lines.append(f"| 지표 | 값 |")
    lines.append(f"|------|-----|")
    lines.append(f"| 케이스 통과 | **{passed_cases} / {total_cases}** ({passed_cases / total_cases:.0%}) |")
    lines.append(f"| 체크 통과 | **{passed_checks} / {total_checks}** ({passed_checks / total_checks:.0%}) |")
    lines.append("")
    lines.append("## 케이스별 결과")
    lines.append("")

    for r in results:
        emoji = "✅" if r.get("case_passed") else "❌"
        lines.append(f"### {emoji} {r['case']}")
        lines.append("")
        if r.get("error"):
            lines.append(f"> ⚠️ 오류: {r['error']}")
            lines.append("")
            continue
        lines.append(f"- **노트**: {r['notes']}")
        lines.append(f"- **모델 요약**: {r.get('summary', '')}")
        elapsed = r.get("elapsed_ms", {}) or {}
        lines.append(f"- **분석 소요**: {elapsed.get('total', 0)}ms")
        lines.append("")
        lines.append("| 체크 | 통과 | 기준 | 결과 |")
        lines.append("|------|------|------|------|")
        for c in r["checks"]:
            mark = "✅" if c["accepted"] else "❌"
            lines.append(
                f"| {c['name']} | {c['passed']}/{c['total']} = {c['ratio']:.0%} "
                f"| ≥{c['min_ratio']:.0%} | {mark} |"
            )
        lines.append("")

    lines.append("## 해석 가이드")
    lines.append("")
    lines.append("- ✅ 케이스 통과 = 모델이 약관의 **명시적 타겟 조건을 정확히 잡았다**")
    lines.append("- ❌ 체크 실패 시 가능한 원인:")
    lines.append("  - 룰 필터가 너무 강하게 작동해서 후보가 부족해진 경우")
    lines.append("  - 임베딩 유사도가 인구통계 조건과 약하게 상관")
    lines.append("  - 데이터셋 자체에 해당 셀이 충분하지 않은 경우 (예: 군인은 1% 미만)")
    lines.append("")
    lines.append("## 본 검증의 한계")
    lines.append("")
    lines.append("- 본 검증은 **합성 페르소나 데이터셋** 내에서 모델 작동 일관성만 측정")
    lines.append("- 실제 가입률·구매 의도와의 상관관계는 **이 검증으로 측정 불가**")
    lines.append("- 다음 단계 검증 옵션:")
    lines.append("  1. 통계청/보험연구원 실제 가입자 분포와 비교 (외부 데이터)")
    lines.append("  2. 도메인 전문가(FP·기획자) 정성 평가")
    lines.append("  3. 실제 마케팅 A/B 테스트 (보험사 협조 필수)")
    lines.append("")

    return "\n".join(lines)


# ============================================================
# main
# ============================================================

def main() -> None:
    print(f"🔬 Known-target 백테스트 시작")
    print(f"   API: {API_BASE}")
    print(f"   케이스 수: {len(CASES)}")

    # 헬스체크
    try:
        with httpx.Client(timeout=5.0) as client:
            client.get(f"{API_BASE}/health").raise_for_status()
    except Exception as e:
        sys.exit(f"❌ API 서버 미응답 ({API_BASE}): {e}\n   pm2 list로 personafit-api 상태 확인")

    results = [run_case(case) for case in CASES]

    # 마크다운 + JSON 저장
    OUTPUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_MD.write_text(render_markdown(results), encoding="utf-8")
    json_path = OUTPUT_MD.with_suffix(".json")
    json_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    passed_cases = sum(1 for r in results if r.get("case_passed"))
    total_checks = sum(r.get("total_checks", 0) for r in results)
    passed_checks = sum(r.get("passed_checks", 0) for r in results)

    print(f"\n{'=' * 60}")
    print(f"📊 종합 결과")
    print(f"{'=' * 60}")
    print(f"  케이스: {passed_cases}/{len(results)} 통과")
    print(f"  체크:   {passed_checks}/{total_checks} 통과")
    print(f"\n💾 리포트: {OUTPUT_MD}")
    print(f"💾 원시 JSON: {json_path}")


if __name__ == "__main__":
    main()
