import { useEffect, useRef, useState } from "react";
import { icons } from "./icons";

type ExpandableSearchProps = {
  value: string;
  placeholder: string;
  className?: string;
  alwaysExpanded?: boolean;
  onChange: (value: string) => void;
};

export function ExpandableSearch({ value, placeholder, className = "", alwaysExpanded = false, onChange }: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(Boolean(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = alwaysExpanded || expanded || Boolean(value);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  return (
    <label className={["expandable-search", open ? "open" : "", className].filter(Boolean).join(" ")}>
      <button
        className="expandable-search-icon"
        type="button"
        aria-label="展开搜索"
        onClick={() => setExpanded(true)}
      >
        <icons.search size={16} />
      </button>
      {open ? (
        <input
          ref={inputRef}
          value={value}
          onBlur={() => {
            if (!alwaysExpanded && !value) setExpanded(false);
          }}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      ) : null}
    </label>
  );
}
