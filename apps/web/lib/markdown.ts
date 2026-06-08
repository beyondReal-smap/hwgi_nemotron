/**
 * 마크다운 렌더 전처리 유틸 (react-markdown 입력 정규화).
 *
 * - unwrapMarkdownFence: LLM이 출력을 ```markdown 코드펜스로 감싸면 통째로 코드블록이
 *   되어 모든 기호가 그대로 노출되는 것을 방지.
 * - fixCjkEmphasis: CommonMark의 강조(emphasis) flanking 규칙은 공백 기반 언어 기준이라
 *   한글에서 `(100.0%)**으로`처럼 닫는 `**`가 '구두점 뒤 + 한글 앞'이면 right-flanking
 *   판정에 실패해 `**`가 렌더되지 않고 그대로 노출된다. 강조 내용 양끝에 zero-width
 *   space(U+200B)를 넣어 두 구분자가 항상 flanking 조건을 만족하게 만든다(화면엔 비표시).
 */

const ZWSP = "​";

export function unwrapMarkdownFence(markdown: string): string {
  const trimmed = (markdown ?? "").trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : trimmed;
}

/**
 * `**볼드**`/`*이탤릭*` 강조 내용 양끝에 ZWSP를 삽입해 한글-구두점 인접 시 강조가
 * 렌더되지 않는 문제를 보정. 코드 구간(```블록, `인라인`)은 건드리지 않는다.
 */
export function fixCjkEmphasis(markdown: string): string {
  const md = markdown ?? "";
  // 코드 구간 보호 — split 캡처로 분리해 홀수 인덱스(코드)는 변환 제외
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // 코드 구간 그대로
      return seg
        // **볼드** — 내용에 공백/줄바꿈 없이 시작·끝, 내부에 * 없음
        .replace(/\*\*(?!\s)([^\n*]+?)(?<!\s)\*\*/g, `**${ZWSP}$1${ZWSP}**`)
        // *이탤릭* — **가 아닌 단일 *. 앞뒤가 * 가 아니어야 함
        .replace(/(?<!\*)\*(?!\s)(?!\*)([^\n*]+?)(?<!\s)\*(?!\*)/g, `*${ZWSP}$1${ZWSP}*`);
    })
    .join("");
}

/** react-markdown에 넘기기 전 권장 정규화: 펜스 제거 + CJK 강조 보정. */
export function normalizeMarkdown(markdown: string): string {
  return fixCjkEmphasis(unwrapMarkdownFence(markdown));
}
