"""설문 차트 리포트 총평 — 통계 집계 + LLM 호출 + 캐시 저장.

설문이 모두 완료된 시점(survey_run.py) 또는 백필 스크립트에서 호출. 결과는
data/surveys/<id>/commentary.json에 저장되어 GET /surveys/{id}/report 응답에 포함된다.

routes/survey_report.py에 유사한 집계 함수가 있지만, 의도적으로 별도 구현해서
서비스 레이어가 routes를 의존하지 않도록 격리. 향후 통계 빌더를 services로 통합할 때
이쪽 로직을 흡수하는 방향이 자연스럽다.
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Any

import numpy as np

from models.survey import ResponseSession, Survey
from services import survey_repo
from services.llm import DEFAULT_PROVIDER, LLMProvider, generate_overall_commentary
from services.store import get_store

logger = logging.getLogger("personafit.commentary")


# ============================================================
# 통계 집계 (commentary 전용 — 가벼운 dict 출력)
# ============================================================

def _choice_distribution(answers: list, options: list[str]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for a in answers:
        v = a.answer_value
        if isinstance(v, list):
            for x in v:
                counter[str(x)] += 1
        else:
            counter[str(v)] += 1
    result: dict[str, int] = {opt: counter.get(opt, 0) for opt in options}
    for k, v in counter.items():
        if k not in result:
            result[k] = v
    return result


def _scale_stats(
    answers: list, scale_min: int, scale_max: int,
    label_low: str | None, label_high: str | None,
) -> tuple[list[dict], float, float]:
    values: list[int] = []
    for a in answers:
        try:
            v = int(a.answer_value)
            if scale_min <= v <= scale_max:
                values.append(v)
        except (TypeError, ValueError):
            continue
    histogram: list[dict] = []
    for score in range(scale_min, scale_max + 1):
        cnt = sum(1 for v in values if v == score)
        label = None
        if score == scale_min and label_low:
            label = label_low
        elif score == scale_max and label_high:
            label = label_high
        histogram.append({"score": score, "count": cnt, "label": label})
    if values:
        mean = float(sum(values) / len(values))
        sorted_v = sorted(values)
        n = len(sorted_v)
        median = float(sorted_v[n // 2] if n % 2 else (sorted_v[n // 2 - 1] + sorted_v[n // 2]) / 2)
    else:
        mean = 0.0
        median = 0.0
    return histogram, mean, median


def _open_ended_samples(answers: list, max_samples: int = 8) -> tuple[list[dict], float, int]:
    """주관식 답변에서 길이 통계 + 상위 confidence 샘플."""
    lengths = [len(str(a.answer_value)) for a in answers]
    avg_len = float(sum(lengths) / len(lengths)) if lengths else 0.0
    max_len = max(lengths) if lengths else 0
    top = sorted(answers, key=lambda a: a.confidence, reverse=True)[:max_samples]
    samples = [{"answer": str(a.answer_value), "confidence": a.confidence} for a in top]
    return samples, avg_len, max_len


def build_commentary_stats(survey: Survey, sessions: list[ResponseSession]) -> dict[str, Any]:
    """LLM 컨텍스트용 통계 dict. llm._format_context_for_commentary 키 스키마와 일치."""
    completed = [s for s in sessions if s.status == "completed"]
    failed = [s for s in sessions if s.status == "failed"]
    completed_uuids = [s.persona_uuid for s in completed]

    durations: list[float] = []
    total_tokens = 0
    for s in sessions:
        total_tokens += s.total_tokens or 0
        if s.status == "completed" and s.started_at and s.completed_at:
            durations.append((s.completed_at - s.started_at).total_seconds())
    avg_sec = round(sum(durations) / len(durations), 2) if durations else None

    # 응답자 분포 — store에서 인구통계 조회
    sex_counts: dict[str, int] = {}
    age_bins: list[dict] = []
    province_top: list[tuple[str, int]] = []
    if completed_uuids:
        store = get_store()
        rows = store.df[store.df["uuid"].isin(completed_uuids)]
        if not rows.empty:
            sex_counts = {k: int(v) for k, v in rows["sex"].value_counts().to_dict().items()}
            edges = list(range(0, 101, 10))
            labels = [f"{edges[i]}-{edges[i+1]-1}" for i in range(len(edges) - 1)]
            idx = np.clip(rows["age"].to_numpy() // 10, 0, len(labels) - 1).astype(int)
            counts = np.bincount(idx, minlength=len(labels))
            age_bins = [
                {"label": lbl, "count": int(c)} for lbl, c in zip(labels, counts) if c > 0
            ]
            prov = rows["province"].value_counts().head(5)
            province_top = [(str(k), int(v)) for k, v in prov.to_dict().items()]

    # 질문별 통계
    questions_stat: list[dict] = []
    for q in survey.questions:
        answers_data: list = []
        confidences: list[float] = []
        for s in completed:
            for a in s.answers:
                if a.question_id == q.id:
                    answers_data.append(a)
                    confidences.append(a.confidence)
        total = len(answers_data)
        avg_conf = float(sum(confidences) / total) if total else 0.0
        item: dict[str, Any] = {
            "order": q.order,
            "type": q.type,
            "text": q.text,
            "total_responses": total,
            "avg_confidence": round(avg_conf, 3),
        }
        if total == 0:
            questions_stat.append(item)
            continue

        if q.type in ("single_choice", "multi_choice"):
            item["choice_distribution"] = _choice_distribution(answers_data, q.options or [])
        elif q.type == "scale":
            hist, mean, median = _scale_stats(
                answers_data,
                q.scale_min if q.scale_min is not None else 1,
                q.scale_max if q.scale_max is not None else 5,
                q.scale_label_low, q.scale_label_high,
            )
            item["scale_histogram"] = hist
            item["scale_mean"] = round(mean, 2)
            item["scale_median"] = round(median, 2)
        elif q.type == "nps":
            hist, mean, median = _scale_stats(answers_data, 0, 10, None, None)
            item["scale_histogram"] = hist
            item["scale_mean"] = round(mean, 2)
            item["scale_median"] = round(median, 2)
        else:  # open_ended
            samples, avg_len, max_len = _open_ended_samples(answers_data, max_samples=8)
            item["open_ended_samples"] = samples
            item["open_ended_length_avg"] = round(avg_len, 1)
            item["open_ended_length_max"] = max_len
        questions_stat.append(item)

    return {
        "survey": {
            "title": survey.title,
            "objective": getattr(survey, "objective", None),
            "question_count": len(survey.questions),
            "persona_count": len(survey.persona_uuids or []),
            "status": survey.status,
        },
        "summary": {
            "total_completed": len(completed),
            "total_failed": len(failed),
            "total_tokens": total_tokens,
            "avg_response_seconds": avg_sec,
        },
        "distribution": {
            "sex": sex_counts,
            "age_bins": age_bins,
            "province_top": province_top,
        },
        "questions": questions_stat,
    }


# ============================================================
# 생성 + 저장 진입점
# ============================================================

def generate_and_persist(
    survey_id: str,
    provider: LLMProvider = DEFAULT_PROVIDER,
) -> str | None:
    """survey_id의 통계를 집계해 총평을 생성하고 disk에 캐시. 실패 시 None.

    best-effort 호출용 — 예외를 swallow하고 로그만 남긴다. 호출자는 reload 시점에
    survey_repo.load_commentary로 결과를 읽으면 된다.
    """
    try:
        survey = survey_repo.get_survey(survey_id)
        if survey is None:
            logger.warning("commentary: survey %s 없음", survey_id)
            return None
        sessions = survey_repo.list_sessions(survey_id)
        completed = [s for s in sessions if s.status == "completed"]
        if not completed:
            logger.info("commentary: survey %s 완료 세션 0건 — 생성 생략", survey_id)
            return None

        stats = build_commentary_stats(survey, sessions)
        text = generate_overall_commentary(stats, provider=provider)
        if not text:
            logger.warning("commentary: survey %s LLM 빈 응답", survey_id)
            return None

        survey_repo.save_commentary(survey_id, text=text, provider=str(provider))
        logger.info("commentary 저장 완료: survey=%s, %d자", survey_id, len(text))
        return text
    except Exception as e:
        # best-effort — 리포트 자체는 commentary 없이도 동작
        logger.exception("commentary 생성 실패 survey=%s: %s", survey_id, e)
        return None
