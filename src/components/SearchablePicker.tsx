import { Children, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { isListboxNavigationKey, resolveListboxNavigationIndex } from "./listbox-keyboard-navigation.mjs";
import { useListboxPointerNavigation } from "./useListboxPointerNavigation";

type SearchablePickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  trigger: ReactNode;
  searchPlaceholder: string;
  searchAriaLabel: string;
  listAriaLabel: string;
  emptyContent: ReactNode;
  contentClassName?: string;
  shellClassName?: string;
  listClassName?: string;
  children?: ReactNode;
};

export function SearchablePicker(props: SearchablePickerProps) {
  const {
    open,
    onOpenChange,
    query,
    onQueryChange,
    trigger,
    searchPlaceholder,
    searchAriaLabel,
    listAriaLabel,
    emptyContent,
    contentClassName = "",
    shellClassName = "",
    listClassName = "",
    children,
  } = props;
  const [activeIndex, setActiveIndex] = useState(-1);
  const childCount = Children.count(children);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const handleOptionPointerMove = useListboxPointerNavigation({
    itemSelector: ".searchable-picker-option:not(:disabled)",
    setActiveIndex,
  });

  function optionElements() {
    return Array.from(listElement?.querySelectorAll<HTMLElement>(":scope > button:not(:disabled), :scope > [role='option']:not(button):not([aria-disabled='true'])") ?? []);
  }

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(optionElements().length ? 0 : -1);
  }, [childCount, listElement, open, query]);

  useEffect(() => {
    const items = optionElements();
    items.forEach((item, index) => {
      item.id = `${listboxId}-option-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(item.classList.contains("is-selected")));
      item.classList.toggle("is-active-target", index === activeIndex);
    });
    const activeItem = items[activeIndex];
    if (activeItem) {
      inputRef.current?.setAttribute("aria-activedescendant", activeItem.id);
      activeItem.scrollIntoView({ block: "nearest" });
    } else {
      inputRef.current?.removeAttribute("aria-activedescendant");
    }
  }, [activeIndex, childCount, listElement, listboxId, query]);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const items = optionElements();
    if (isListboxNavigationKey(event.key)) {
      event.preventDefault();
      setActiveIndex(resolveListboxNavigationIndex({ currentIndex: activeIndex, itemCount: items.length, key: event.key }));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && items[activeIndex]) {
      event.preventDefault();
      items[activeIndex].click();
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) onQueryChange("");
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`menu-content searchable-picker-content ${contentClassName}`.trim()} sideOffset={6} align="start">
          <div className={`searchable-picker-shell ${shellClassName}`.trim()}>
            <input
              aria-controls={listboxId}
              aria-label={searchAriaLabel}
              className="searchable-picker-search"
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              ref={inputRef}
              role="combobox"
              aria-expanded={open}
              value={query}
            />
            <div
              id={listboxId}
              className={`searchable-picker-list ${listClassName}`.trim()}
              role="listbox"
              aria-label={listAriaLabel}
              ref={setListElement}
              onPointerMove={handleOptionPointerMove}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {Children.count(children) ? children : emptyContent}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
