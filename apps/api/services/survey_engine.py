"""단일 (persona × question) → Answer 생성 엔진.

흐름:
  1. 캐시 키 계산 → hit이면 즉시 반환 (tokens=0)
  2. miss이면 store에서 페르소나 프로필 추출
  3. LLM 호출 (tool_use로 answer/reasoning/confidence 강제)
  4. Answer 생성 → 캐시 저장 → 반환

캐시 키에 포함 안 되는 옵션:
  - reasoning 포함 여부 (포함=true면 prompt에 reasoning 요구. 캐시 hit 시 reasoning은 그대로 사용)
  - scale_label / options 텍스트 변경 (사용자가 설문 편집 시 별도 무효화 권장)
"""

from __future__ import annotations

import asyncio

from models.survey import Answer, Question
from services import answer_cache
from services.llm import generate_persona_answer
from services.store import get_store


def _build_profile(row) -> str:
    """페르소나 1행 → LLM에 전달할 자연어 프로필 텍스트.

    포함 항목 (페르소나가 일관된 답변을 생성하도록 가능한 모든 정보 전달):
      - 인구통계 헤더 (성별·나이·지역·직업·가구·혼인·학력·전공·주거·병역)
      - 종합 persona
      - 6개 카테고리 persona (professional/sports/arts/travel/culinary/family)
      - skills_and_expertise, hobbies_and_interests, career_goals_and_ambitions

    각 텍스트는 비어 있으면 자동 생략.
    토큰 비용 증가가 있지만 일관성·신뢰도 향상이 더 중요한 트레이드오프.
    """
    def _g(col: str) -> str:
        v = row.get(col, "")
        if v is None:
            return ""
        s = str(v).strip()
        return "" if s.lower() in ("nan", "none") else s

    sex = _g("sex")
    age = _g("age")
    province = _g("province")
    district = _g("district")
    occupation = _g("occupation") or "직업 정보 없음"
    family_type = _g("family_type")
    marital = _g("marital_status")
    edu = _g("education_level")
    field = _g("bachelors_field")
    housing = _g("housing_type")
    military = _g("military_status")

    header_lines = [
        f"- 성별·나이: {sex} {age}세",
        f"- 거주: {province} {district}".rstrip(),
        f"- 직업: {occupation}",
    ]
    if family_type:
        header_lines.append(f"- 가구 유형: {family_type}")
    if marital:
        header_lines.append(f"- 혼인 상태: {marital}")
    if edu:
        header_lines.append(f"- 학력: {edu}")
    if field and field != "해당없음":
        header_lines.append(f"- 전공 계열: {field}")
    if housing:
        header_lines.append(f"- 주거 형태: {housing}")
    if military and military != "비현역":
        header_lines.append(f"- 병역: {military}")

    parts: list[str] = ["[인구통계]"]
    parts.extend(header_lines)
    parts.append("")

    # 종합 페르소나 (필수)
    persona = _g("persona")
    if persona:
        parts += ["[종합 페르소나]", persona, ""]

    # 6 카테고리 페르소나
    category_labels = [
        ("professional_persona", "직업 페르소나"),
        ("sports_persona", "스포츠 페르소나"),
        ("arts_persona", "예술 페르소나"),
        ("travel_persona", "여행 페르소나"),
        ("culinary_persona", "요리 페르소나"),
        ("family_persona", "가족 페르소나"),
    ]
    for col, label in category_labels:
        text = _g(col)
        if text:
            parts += [f"[{label}]", text, ""]

    # 자유 텍스트 컬럼
    extras = [
        ("skills_and_expertise", "전문성·기술"),
        ("hobbies_and_interests", "취미·관심사"),
        ("career_goals_and_ambitions", "경력 목표"),
    ]
    for col, label in extras:
        text = _g(col)
        if text:
            parts += [f"[{label}]", text, ""]

    return "\n".join(parts).strip()


async def answer_one(
    *,
    persona_uuid: str,
    question: Question,
    survey_objective: str,
    provider: str,
    model: str,
    temperature: float,
) -> tuple[Answer, int]:
    """단일 (persona × question) → Answer + tokens_used.

    캐시 hit이면 LLM 호출 없이 즉시 반환 (tokens=0).
    """
    key = answer_cache.cache_key(persona_uuid, question.id, model, temperature)
    cached = answer_cache.get(key)
    if cached is not None:
        return cached, 0

    # 페르소나 프로필 추출 (인메모리 store 조회)
    store = get_store()
    rows = store.df[store.df["uuid"] == persona_uuid]
    if rows.empty:
        raise ValueError(f"persona not found: {persona_uuid}")
    row = rows.iloc[0]
    profile = _build_profile(row)

    # LLM 호출은 동기 함수 → 이벤트 루프 안 막도록 to_thread
    result, tokens = await asyncio.to_thread(
        generate_persona_answer,
        profile=profile,
        survey_objective=survey_objective,
        question_text=question.text,
        question_type=question.type,
        options=question.options or None,
        scale_min=question.scale_min,
        scale_max=question.scale_max,
        scale_label_low=question.scale_label_low,
        scale_label_high=question.scale_label_high,
        provider=provider,
        model=model,
        temperature=temperature,
    )

    answer = Answer(
        question_id=question.id,
        answer_value=result["answer"],
        reasoning=result.get("reasoning", "")[:200],
        confidence=float(result.get("confidence", 0.0)),
    )
    answer_cache.put(key, answer)
    return answer, tokens
