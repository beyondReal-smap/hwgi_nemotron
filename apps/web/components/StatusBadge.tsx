/**
 * 설문 상태 배지 — SurveyProgress·SurveyHistoryList가 공유.
 *
 * 시맨틱 상태색 + 아이콘을 함께 써서 **색만으로 의미를 전달하지 않는다**(색맹 대응):
 *  - draft     : 회색 점        (초안)
 *  - running   : info 펄스 점    (진행 중)
 *  - completed : success 체크    (완료)
 *  - failed    : danger 엑스     (실패)
 * 텍스트는 ink로 두어 대비를 확보하고, 색은 옅은 배경·보더·아이콘으로 표현한다.
 */
import type { SurveyStatus } from "@/lib/api";

const META: Record<
  SurveyStatus,
  { label: string; cls: string; Icon: () => JSX.Element }
> = {
  draft: {
    label: "초안",
    cls: "bg-stone/15 text-graphite border-stone/35",
    Icon: IconDot,
  },
  running: {
    label: "진행 중",
    cls: "bg-info/12 text-ink border-info/45",
    Icon: IconPulse,
  },
  completed: {
    label: "완료",
    cls: "bg-success/12 text-ink border-success/50",
    Icon: IconCheck,
  },
  failed: {
    label: "실패",
    cls: "bg-danger/12 text-ink border-danger/50",
    Icon: IconX,
  },
};

export function StatusBadge({
  status,
  className = "",
}: {
  status: SurveyStatus;
  className?: string;
}) {
  const v = META[status];
  const Icon = v.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-caption font-medium px-2.5 py-0.5 rounded-full border ${v.cls} ${className}`}
    >
      <Icon />
      {v.label}
    </span>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="w-3 h-3 shrink-0 text-success"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 6.2l2.2 2.3L9.5 3.4" />
    </svg>
  );
}

function IconX() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="w-3 h-3 shrink-0 text-danger"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function IconPulse() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full rounded-full bg-info/60 animate-ping motion-reduce:hidden" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
    </span>
  );
}

function IconDot() {
  return (
    <span className="inline-block h-2 w-2 rounded-full bg-stone shrink-0" aria-hidden />
  );
}
