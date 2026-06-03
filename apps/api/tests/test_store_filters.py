from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.store import FilterParams, PersonaStore


def _store() -> PersonaStore:
    df = pd.DataFrame([
        {
            "uuid": "p1",
            "age": 35,
            "sex": "여자",
            "province": "서울",
            "district": "서울-영등포구",
        },
        {
            "uuid": "p2",
            "age": 35,
            "sex": "여자",
            "province": "서울",
            "district": "서울-강남구",
        },
        {
            "uuid": "p3",
            "age": 35,
            "sex": "남자",
            "province": "서울",
            "district": "서울-영등포구",
        },
    ])
    return PersonaStore(df, np.ones((len(df), 2), dtype=np.float32))


def test_district_filter_accepts_bare_district_name() -> None:
    result = _store().filter_indices(FilterParams(
        age_min=30,
        age_max=39,
        sex=["여자"],
        additional_filters={"district": ["영등포구"]},
    ))

    assert result.tolist() == [0]


def test_district_filter_accepts_space_separated_region() -> None:
    result = _store().filter_indices(FilterParams(
        provinces=["서울시"],
        additional_filters={"district": ["서울 영등포구"]},
    ))

    assert result.tolist() == [0, 2]
