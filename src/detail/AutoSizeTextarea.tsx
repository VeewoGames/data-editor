import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

type AutoSizeTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function AutoSizeTextarea({
  onChange,
  onInput,
  rows: _rows,
  style,
  ...props
}: AutoSizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function syncHeight(node: HTMLTextAreaElement | null = textareaRef.current) {
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
  }

  useLayoutEffect(() => {
    syncHeight();
  }, [props.defaultValue, props.value]);

  return (
    <textarea
      {...props}
      onChange={(event) => {
        syncHeight(event.currentTarget);
        onChange?.(event);
      }}
      onInput={(event) => {
        syncHeight(event.currentTarget);
        onInput?.(event);
      }}
      ref={(node) => {
        textareaRef.current = node;
        syncHeight(node);
      }}
      rows={1}
      style={{ ...style, overflowY: "hidden" }}
    />
  );
}
