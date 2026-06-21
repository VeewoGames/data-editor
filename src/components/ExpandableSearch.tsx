import { useEffect, useRef, useState, type KeyboardEventHandler, type MutableRefObject, type Ref } from "react";
import { icons } from "./icons";

type ExpandableSearchProps = {
  value: string;
  placeholder: string;
  className?: string;
  inputClassName?: string;
  alwaysExpanded?: boolean;
  iconAriaLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
  onEscape?: () => void;
  onChange: (value: string) => void;
};

export function ExpandableSearch({
  value,
  placeholder,
  className = "",
  inputClassName = "",
  alwaysExpanded = false,
  iconAriaLabel = "展开搜索",
  inputRef,
  onEscape,
  onChange,
}: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(Boolean(value));
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const open = alwaysExpanded || expanded || Boolean(value);

  useEffect(() => {
    if (expanded) localInputRef.current?.focus();
  }, [expanded]);

  const assignInputRef = (node: HTMLInputElement | null) => {
    localInputRef.current = node;
    if (!inputRef) return;
    if (typeof inputRef === "function") {
      inputRef(node);
      return;
    }
    (inputRef as MutableRefObject<HTMLInputElement | null>).current = node;
  };

  const handleInputKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (value) {
      onEscape?.();
      return;
    }
    if (!alwaysExpanded) setExpanded(false);
  };

  function handleClear() {
    onChange("");
    setExpanded(true);
    localInputRef.current?.focus();
  }

  return (
    <label className={["expandable-search", open ? "open" : "", className].filter(Boolean).join(" ")}>
      <button
        className="expandable-search-icon"
        type="button"
        aria-label={iconAriaLabel}
        onClick={() => setExpanded(true)}
      >
        <icons.search size={16} />
      </button>
      {open ? (
        <input
          ref={assignInputRef}
          className={inputClassName}
          value={value}
          onBlur={() => {
            if (!alwaysExpanded && !value) setExpanded(false);
          }}
          onKeyDown={handleInputKeyDown}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      ) : null}
      {open && value ? (
        <button
          className="expandable-search-clear"
          type="button"
          aria-label="清空搜索"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClear}
        >
          <icons.close size={16} />
        </button>
      ) : null}
    </label>
  );
}
