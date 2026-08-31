import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TextCellTruncationHintProps = {
  text: string;
  enabled: boolean;
  suppressed: boolean;
  ariaHidden?: boolean;
};

export function TextCellTruncationHint({ text, enabled, suppressed, ariaHidden }: TextCellTruncationHintProps) {
  const [hovered, setHovered] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 0 });
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const measureTruncation = () => {
    const anchor = anchorRef.current;
    setTruncated(Boolean(anchor && anchor.scrollWidth - anchor.clientWidth > 1));
  };

  useEffect(() => {
    measureTruncation();
    const anchor = anchorRef.current;
    if (!anchor || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureTruncation);
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [text, enabled]);

  const eligible = enabled && !suppressed && hovered && truncated && text !== "";

  useEffect(() => {
    setVisible(false);
    if (!eligible) return;
    const timer = window.setTimeout(() => setVisible(true), 1000);
    return () => window.clearTimeout(timer);
  }, [eligible]);

  useEffect(() => {
    if (!visible) return;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0;
      const tooltipHeight = tooltipRef.current?.offsetHeight ?? 0;
      const maxLeft = Math.max(12, window.innerWidth - tooltipWidth - 12);
      const maxTop = Math.max(12, window.innerHeight - tooltipHeight - 12);
      const preferredTop = anchorRect.top - tooltipHeight - 6;
      const fallbackTop = anchorRect.bottom + 6;
      setPosition({
        left: Math.min(Math.max(anchorRect.left, 12), maxLeft),
        top: preferredTop >= 12 ? preferredTop : Math.min(Math.max(fallbackTop, 12), maxTop),
      });
    };
    const cancelForScroll = () => {
      setHovered(false);
      setVisible(false);
    };
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", cancelForScroll, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", cancelForScroll, true);
    };
  }, [visible]);

  return (
    <>
      <span
        aria-hidden={ariaHidden}
        onPointerEnter={() => {
          measureTruncation();
          setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        ref={anchorRef}
      >
        {text}
      </span>
      {visible && typeof document !== "undefined"
        ? createPortal(
          <div
            className="column-header-full-title-tooltip cell-truncation-tooltip"
            ref={tooltipRef}
            style={{ left: `${position.left}px`, top: `${position.top}px` }}
          >
            {text}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
