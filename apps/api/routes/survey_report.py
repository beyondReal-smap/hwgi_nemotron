"""GET /api/surveys/:id/report — 차트 리포트용 집계 데이터.

질문 유형별 집계:
  - single_choice/nps/multi_choice: 선택지별 응답 수
  - scale: 점수별 응답 수 + 평균/중앙값
  - open_ended: 대표 응답 5건 (confidence 상위) + 글자수 분포

응답자 분포: sex/age_bins/province (overview 패턴 재사용)

CSV export: GET /api/surveys/:id/report.csv (별도 엔드포인트)
"""

from __future__ import annotations

import csv
import io
import os
from collections import Counter

import numpy as np
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from models.survey import Question, QuestionType, Survey
from services import survey_repo
from services.commentary import generate_and_persist
from services.store import get_store

router = APIRouter(prefix="/api/surveys", tags=["survey_report"])


# ============================================================
# 응답 스키마
# ============================================================


class OpenEndedSample(BaseModel):
    persona_uuid: str
    sex: str
    age: int
    province: str
    occupation: str
    answer: str
    reasoning: str
    confidence: float


class QuestionReport(BaseModel):
    question_id: str
    order: int
    type: QuestionType
    text: str
    total_responses: int           # 답변이 있는 세션 수
    avg_confidence: float

    # 유형별 (해당 필드만 채움)
    choice_distribution: dict[str, int] | None = None
    scale_histogram: list[dict] | None = None        # [{score, count, label?}]
    scale_mean: float | None = None
    scale_median: float | None = None
    open_ended_samples: list[OpenEndedSample] | None = None
    open_ended_length_avg: float | None = None
    open_ended_length_max: int | None = None


class RespondentDistribution(BaseModel):
    sex: dict[str, int]
    age_bins: list[dict]    # [{label, count}]
    province: dict[str, int]


class ReportSummary(BaseModel):
    total_completed: int
    total_failed: int
    total_tokens: int
    avg_response_seconds: float | None


class ReportResponse(BaseModel):
    survey: Survey
    summary: ReportSummary
    respondent_distribution: RespondentDistribution
    questions: list[QuestionReport]
    overall_commentary: str | None = None  # 설문 완료 시 LLM이 작성한 마크다운 총평 (캐시 hit 시만)


# ============================================================
# 헬퍼
# ============================================================


def _aggregate_choice(answers: list, options: list[str]) -> dict[str, int]:
    """객관식 — 선택지별 카운트. multi_choice는 배열을 풀어서 카운트."""
    counter: Counter[str] = Counter()
    for a in answers:
        v = a.answer_value
        if isinstance(v, list):
            for x in v:
                counter[str(x)] += 1
        else:
            counter[str(v)] += 1
    # 옵션 순서대로 정렬 (0건도 포함)
    result: dict[str, int] = {}
    for opt in options:
        result[opt] = counter.get(opt, 0)
    # 옵션에 없는 응답도 보존 (LLM이 다른 값을 낸 케이스 대비)
    for k, v in counter.items():
        if k not in result:
            result[k] = v
    return result


def _aggregate_scale(
    answers: list, scale_min: int, scale_max: int,
    label_low: str | None, label_high: str | None,
) -> tuple[list[dict], float, float]:
    """척도형 — 점수별 카운트 + 평균/중앙값."""
    values: list[int] = []
    for a in answers:
        try:
            v = int(a.answer_value)
            if scale_min <= v <= scale_max:
                values.append(v)
        except (TypeError, ValueError):
            continue

    histogram = []
    for score in range(scale_min, scale_max + 1):
        cnt = sum(1 for v in values if v == score)
        label = None
        if score == scale_min and label_low:
            label = label_low
        elif score == scale_max and label_high:
            label = label_high
        histogram.append({"score": score, "count": cnt, "label": label})

    if not values:
        return histogram, 0.0, 0.0
    arr = np.array(values)
    return histogram, float(arr.mean()), float(np.median(arr))


def _aggregate_open_ended(
    answers_with_session: list,    # [(answer, session, persona_row)]
    top_k: int = 5,
) -> tuple[list[OpenEndedSample], float, int]:
    """주관식 — confidence 상위 K건 + 글자수 통계."""
    # 정렬 키: confidence 내림차순
    sorted_items = sorted(
        answers_with_session, key=lambda x: x[0].confidence, reverse=True,
    )
    samples = []
    for ans, sess, row in sorted_items[:top_k]:
        samples.append(OpenEndedSample(
            persona_uuid=sess.persona_uuid,
            sex=str(row.get("sex", "")),
            age=int(row.get("age", 0)),
            province=str(row.get("province", "")),
            occupation=str(row.get("occupation", "") or ""),
            answer=str(ans.answer_value),
            reasoning=ans.reasoning,
            confidence=ans.confidence,
        ))

    lengths = [len(str(a[0].answer_value)) for a in answers_with_session]
    avg_len = float(sum(lengths) / len(lengths)) if lengths else 0.0
    max_len = max(lengths) if lengths else 0
    return samples, avg_len, max_len


def _respondent_distribution(
    completed_uuids: list[str],
) -> RespondentDistribution:
    """응답 완료자만의 인구통계 분포."""
    store = get_store()
    rows = store.df[store.df["uuid"].isin(completed_uuids)]
    if rows.empty:
        return RespondentDistribution(sex={}, age_bins=[], province={})

    sex_counts = {k: int(v) for k, v in rows["sex"].value_counts().to_dict().items()}
    province_counts = {k: int(v) for k, v in rows["province"].value_counts().to_dict().items()}

    age_bin_edges = list(range(0, 101, 10))
    bin_labels = [f"{age_bin_edges[i]}-{age_bin_edges[i+1]-1}" for i in range(len(age_bin_edges) - 1)]
    bin_indices = np.clip(rows["age"].to_numpy() // 10, 0, len(bin_labels) - 1).astype(int)
    bin_counts = np.bincount(bin_indices, minlength=len(bin_labels))
    age_bins = [{"label": lbl, "count": int(c)} for lbl, c in zip(bin_labels, bin_counts) if c > 0]

    return RespondentDistribution(sex=sex_counts, age_bins=age_bins, province=province_counts)


def _build_question_report(
    q: Question,
    sessions: list,
    completed_uuids: list[str],
) -> QuestionReport:
    """단일 질문 집계."""
    # 해당 질문에 응답한 (Answer, ResponseSession, persona_row) 수집
    store = get_store()
    rows_by_uuid = store.df[store.df["uuid"].isin(completed_uuids)].set_index("uuid")

    answers_data: list = []         # list[Answer]
    confidences: list[float] = []
    answers_with_meta: list = []    # list[(Answer, Session, persona_row)]

    for s in sessions:
        for a in s.answers:
            if a.question_id != q.id:
                continue
            answers_data.append(a)
            confidences.append(a.confidence)
            if s.persona_uuid in rows_by_uuid.index:
                answers_with_meta.append((a, s, rows_by_uuid.loc[s.persona_uuid]))

    total = len(answers_data)
    avg_conf = float(sum(confidences) / total) if total else 0.0

    report = QuestionReport(
        question_id=q.id,
        order=q.order,
        type=q.type,
        text=q.text,
        total_responses=total,
        avg_confidence=round(avg_conf, 3),
    )

    if total == 0:
        return report

    if q.type in ("single_choice", "multi_choice"):
        report.choice_distribution = _aggregate_choice(answers_data, q.options or [])
    elif q.type == "scale":
        hist, mean, median = _aggregate_scale(
            answers_data,
            q.scale_min if q.scale_min is not None else 1,
            q.scale_max if q.scale_max is not None else 5,
            q.scale_label_low,
            q.scale_label_high,
        )
        report.scale_histogram = hist
        report.scale_mean = round(mean, 2)
        report.scale_median = round(median, 2)
    elif q.type == "nps":
        hist, mean, median = _aggregate_scale(answers_data, 0, 10, None, None)
        report.scale_histogram = hist
        report.scale_mean = round(mean, 2)
        report.scale_median = round(median, 2)
    else:  # open_ended
        samples, avg_len, max_len = _aggregate_open_ended(answers_with_meta, top_k=5)
        report.open_ended_samples = samples
        report.open_ended_length_avg = round(avg_len, 1)
        report.open_ended_length_max = max_len

    return report


# ============================================================
# 엔드포인트
# ============================================================


@router.get("/{survey_id}/report", response_model=ReportResponse)
def get_report(survey_id: str) -> ReportResponse:
    """완료된 응답 전체 집계. 백엔드에서 사전 가공해 프론트 부담 제거."""
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")

    all_sessions = survey_repo.list_sessions(survey_id)
    completed_sessions = [s for s in all_sessions if s.status == "completed"]
    completed_uuids = [s.persona_uuid for s in completed_sessions]
    failed_count = sum(1 for s in all_sessions if s.status == "failed")
    total_tokens = sum(s.total_tokens for s in all_sessions)

    durations = []
    for s in completed_sessions:
        if s.started_at and s.completed_at:
            durations.append((s.completed_at - s.started_at).total_seconds())
    avg_sec = round(sum(durations) / len(durations), 2) if durations else None

    summary = ReportSummary(
        total_completed=len(completed_sessions),
        total_failed=failed_count,
        total_tokens=total_tokens,
        avg_response_seconds=avg_sec,
    )

    distribution = _respondent_distribution(completed_uuids)

    questions = [
        _build_question_report(q, completed_sessions, completed_uuids)
        for q in survey.questions
    ]

    overall_commentary = survey_repo.load_commentary(survey_id)

    return ReportResponse(
        survey=survey,
        summary=summary,
        respondent_distribution=distribution,
        questions=questions,
        overall_commentary=overall_commentary,
    )


# ============================================================
# 운영 admin — commentary 재생성 (백필·실패 복구·강제 재생성)
# 외부 노출이 부담스러우니 env ADMIN_TOKEN과 X-Admin-Token 헤더로 보호.
# ADMIN_TOKEN이 빈 환경에서는 endpoint가 항상 403 — 운영 활성화 시점에 env 설정 필요.
# ============================================================


@router.post("/{survey_id}/commentary/regenerate", status_code=202)
def regenerate_commentary(
    survey_id: str,
    background: BackgroundTasks,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    """비동기 백필. 즉시 202 반환 후 background에서 LLM 호출 + 저장."""
    expected = os.environ.get("ADMIN_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=403, detail="admin disabled (ADMIN_TOKEN unset)")
    if x_admin_token != expected:
        raise HTTPException(status_code=403, detail="invalid admin token")

    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")

    background.add_task(generate_and_persist, survey_id)
    return {"queued": True, "survey_id": survey_id}


@router.get("/{survey_id}/report.csv")
def get_report_csv(survey_id: str) -> StreamingResponse:
    """응답 raw 데이터 CSV — 1행 = 페르소나 1명."""
    survey = survey_repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="survey not found")

    all_sessions = survey_repo.list_sessions(survey_id)
    completed = [s for s in all_sessions if s.status == "completed"]
    if not completed:
        raise HTTPException(status_code=404, detail="no completed responses")

    store = get_store()
    rows_by_uuid = store.df[
        store.df["uuid"].isin([s.persona_uuid for s in completed])
    ].set_index("uuid")

    # 헤더: persona 메타 + 각 질문별 (답변·근거·확신도)
    header = [
        "persona_uuid", "sex", "age", "province", "district",
        "occupation", "family_type", "total_tokens",
    ]
    for q in survey.questions:
        prefix = f"q{q.order}"
        header += [
            f"{prefix}_answer",
            f"{prefix}_reasoning",
            f"{prefix}_confidence",
        ]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)

    for s in completed:
        if s.persona_uuid not in rows_by_uuid.index:
            continue
        r = rows_by_uuid.loc[s.persona_uuid]
        row = [
            s.persona_uuid,
            str(r.get("sex", "")),
            int(r.get("age", 0)),
            str(r.get("province", "")),
            str(r.get("district", "")),
            str(r.get("occupation", "") or ""),
            str(r.get("family_type", "") or ""),
            s.total_tokens,
        ]
        # 질문별 — 답변·근거·확신도
        answers_by_qid = {a.question_id: a for a in s.answers}
        for q in survey.questions:
            a = answers_by_qid.get(q.id)
            if a is None:
                row += ["", "", ""]
                continue
            value = a.answer_value
            if isinstance(value, list):
                value = ", ".join(str(x) for x in value)
            row += [str(value), a.reasoning, a.confidence]
        writer.writerow(row)

    buf.seek(0)
    # Excel 한글 깨짐 방지용 BOM
    csv_bytes = b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")

    # HTTP 헤더는 latin-1만 허용. 한글 파일명은 RFC 5987의 filename*=UTF-8''…로 전달.
    # filename=...에는 ASCII 안전 이름만 (survey id 기반).
    from urllib.parse import quote
    fallback_name = f"survey_{survey.id[:8]}.csv"
    encoded_title = quote(survey.title or survey.id, safe="")
    encoded_name = f"survey_{encoded_title}.csv"

    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{fallback_name}"; '
                f"filename*=UTF-8''{encoded_name}"
            ),
        },
    )
