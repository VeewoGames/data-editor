import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function stripLeadingMetadataComments(value: string) {
  let next = value;
  while (true) {
    const stripped = next.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
    if (stripped === next) return next;
    next = stripped;
  }
}

export function ReadonlyMarkdownRendererImpl({ value }: { value: string }) {
  return (
    <div className="readonly-markdown-renderer markdown-document" role="group" aria-label="只读 Markdown 渲染器">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripLeadingMetadataComments(value)}</ReactMarkdown>
    </div>
  );
}
