/**
 * 신뢰 안내 패널 — "이 결과, 믿어도 되나요?"에 선제적으로 답한다.
 *
 * 평가자·의사결정자가 반드시 던지는 질문(합성 데이터의 대표성)을 화면에서
 * 먼저 해소: ① 데이터 출처 ② 타겟 정확도 검증 결과 ③ 정직한 한계.
 * 전부 정적 콘텐츠(LLM 0콜) — 수치 출처는 README "모델 검증" 섹션과 동일.
 */

const TRUST_ITEMS: { title: string; body: string; note?: string }[] = [
  {
    title: "데이터 출처",
    body: "NVIDIA가 공개한 합성 한국인 페르소나 100만 명(Nemotron-Personas-Korea)을 사용합니다. 통계청(KOSIS)·대법원·국민건강보험공단 등 공식 통계 분포에 맞춰 생성된 데이터입니다.",
    note: "CC BY 4.0 — 상업적 이용 가능 라이선스",
  },
  {
    title: "타겟 정확도 검증",
    body: "정답 타겟이 명시된 보험 약관 11종(여성 전용·시니어·군인·제주 거주자 등)으로 미리 검증한 결과, 11건 모두에서 의도한 타겟을 정확히 찾아냈습니다.",
    note: "케이스 11/11 · 세부 체크 22/22 통과 (100%)",
  },
  {
    title: "정직한 한계",
    body: "결과는 합성 페르소나의 반응 경향이며, 실제 가입률·전환율을 보장하지 않습니다. 본조사나 캠페인 집행 전에 방향을 빠르게 검증하는 예행연습 도구로 활용하세요.",
  },
];

export function TrustPanel() {
  return (
    <details className="group border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <summary className="cursor-pointer list-none bg-snow px-4 py-3 sm:px-5 sm:py-4 flex items-center justify-between gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure">
        <div>
          <h2 className="text-title text-ink">이 결과, 믿어도 되나요?</h2>
          <p className="text-body-sm text-dusty mt-1">
            데이터 출처와 검증 결과, 그리고 한계까지 투명하게 공개합니다.
          </p>
        </div>
        <span
          aria-hidden
          className="shrink-0 text-dusty transition-transform group-open:rotate-180 motion-reduce:transition-none"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-parchment grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-parchment">
        {TRUST_ITEMS.map((item) => (
          <div key={item.title} className="px-4 py-3 sm:px-5 sm:py-4">
            <p className="text-overline text-dusty">{item.title}</p>
            <p className="text-body-sm text-graphite leading-6 mt-1.5">
              {item.body}
            </p>
            {item.note && (
              <p className="text-caption font-semibold text-ink mt-2 num-tabular">
                {item.note}
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
