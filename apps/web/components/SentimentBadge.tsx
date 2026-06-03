/**
 * 페르소나 의견 감정(sentiment) 배지 — PersonaList·ABTestResultPanel이 공유.
 *
 * 시맨틱 상태색 + 증감 메타포 아이콘으로 색맹에서도 구분 가능하게 한다:
 *  - 긍정 : success 상향 삼각
 *  - 부정 : danger  하향 삼각
 *  - 중립 : 회색    수평 대시
 * 텍스트는 ink/graphite로 대비를 확보하고, 색은 옅은 배경·보더·아이콘으로 표현.
 */

type Variant = { cls: string; icon: (props: { size: number }) => JSX.Element };

function variantFor(sentiment: string): Variant {
  if (sentiment === "긍정")
    return { cls: "bg-success/12 text-ink border-success/45", icon: TriUp };
  if (sentiment === "부정")
    return { cls: "bg-danger/12 text-ink border-danger/45", icon: TriDown };
  // 중립 및 그 외 값
  return { cls: "bg-stone/15 text-graphite border-stone/40", icon: Dash };
}

export function SentimentBadge({
  sentiment,
  size = "md",
  className = "",
}: {
  sentiment: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const v = variantFor(sentiment);
  const Icon = v.icon;
  const sizeCls =
    size === "sm"
      ? "px-1.5 py-0.5 rounded-[5px] gap-1 text-caption font-medium"
      : "px-2.5 py-0.5 rounded-[9.6px] gap-1.5 text-caption font-semibold";
  return (
    <span
      className={`inline-flex items-center border ${sizeCls} ${v.cls} ${className}`}
    >
      <Icon size={size === "sm" ? 9 : 10} />
      {sentiment}
    </span>
  );
}

function TriUp({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 10 10"
      width={size}
      height={size}
      className="shrink-0 text-success"
      fill="currentColor"
      aria-hidden
    >
      <path d="M5 1.8l3.4 5.9H1.6z" />
    </svg>
  );
}

function TriDown({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 10 10"
      width={size}
      height={size}
      className="shrink-0 text-danger"
      fill="currentColor"
      aria-hidden
    >
      <path d="M5 8.2L1.6 2.3h6.8z" />
    </svg>
  );
}

function Dash({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 10 10"
      width={size}
      height={size}
      className="shrink-0 text-stone"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M2.2 5h5.6" />
    </svg>
  );
}
