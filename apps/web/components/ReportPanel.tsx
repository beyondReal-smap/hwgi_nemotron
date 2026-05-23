import ReactMarkdown from "react-markdown";

type Props = {
  markdown: string;
};

export function ReportPanel({ markdown }: Props) {
  const normalizedMarkdown = unwrapMarkdownFence(markdown);

  return (
    <section className="border border-parchment rounded-[9.6px] bg-vellum overflow-hidden">
      <header className="bg-snow border-b border-parchment border-l-4 border-l-ink px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-title text-ink">
          FP·기획자용 인사이트 리포트
        </h2>
        <p className="text-body-sm text-dusty mt-1">
          Claude Haiku가 위 데이터를 바탕으로 작성한 영업·기획 가이드
        </p>
      </header>
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <div
          className="prose max-w-none text-[14px] sm:text-[15px] leading-7 break-words
                     prose-headings:text-ink prose-headings:tracking-tight
                     prose-h2:text-[18px] sm:prose-h2:text-[20px] prose-h2:font-semibold prose-h2:mt-6 sm:prose-h2:mt-7 prose-h2:mb-3 prose-h2:pb-2 prose-h2:border-b prose-h2:border-parchment
                     prose-h3:text-[15px] prose-h3:font-semibold prose-h3:mt-5 prose-h3:mb-2
                     prose-p:my-3 prose-p:text-graphite prose-p:leading-7
                     prose-ul:my-3 prose-li:my-1.5 prose-li:text-graphite
                     prose-ol:my-3 prose-ol:text-graphite prose-li:leading-7
                     prose-strong:text-ink prose-strong:font-semibold
                     prose-code:text-ink prose-code:bg-azure/40 prose-code:px-1 prose-code:rounded prose-code:text-[0.9em]
                     prose-pre:bg-snow prose-pre:text-graphite prose-pre:border prose-pre:border-parchment prose-pre:rounded-[9.6px]
                     prose-pre:whitespace-pre-wrap prose-pre:text-[13px]
                     prose-code:before:content-[''] prose-code:after:content-['']"
        >
          <ReactMarkdown>{normalizedMarkdown}</ReactMarkdown>
        </div>
      </div>
    </section>
  );
}

function unwrapMarkdownFence(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);

  return match ? match[1].trim() : trimmed;
}
