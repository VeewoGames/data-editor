# Option Field Popover Autofocus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure single-select and multi-select option popovers place keyboard focus in the search input immediately after opening.

**Architecture:** Reuse the shared `OptionFieldEditor` open lifecycle instead of branching single-select and multi-select separately. Lock the behavior with one focused Playwright regression that covers both detail-panel select and table/detail multi-select surfaces.

**Tech Stack:** React, Radix Popover, Playwright

---

### Task 1: Lock and implement shared autofocus behavior

**Files:**
- Modify: `tests/data-editor.spec.ts`
- Modify: `src/table/OptionFieldEditor.tsx`

- [ ] **Step 1: Write the failing test**

Add a Playwright regression near the existing option-field popover tests that:

```ts
test("option field popover focuses the search input on open for shared select and multi-select editors", async ({ page }) => {
  // open a multi-select popover and assert .multi-select-input is focused
  // open a detail-panel select popover and assert .multi-select-input is focused
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/data-editor.spec.ts --grep "option field popover focuses the search input on open for shared select and multi-select editors"`
Expected: FAIL because the newly opened popover does not reliably focus `.multi-select-input`.

- [ ] **Step 3: Write minimal implementation**

Keep the existing shared `OptionFieldEditor` flow and make open-time focus explicit in the popover lifecycle so the search input wins focus after mount/reset:

```ts
onOpenAutoFocus={(event) => {
  event.preventDefault();
  focusWithoutScroll(inputRef.current);
}}
```

If needed, defer once with `queueMicrotask` from the same lifecycle hook so it runs after the content is mounted.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/data-editor.spec.ts --grep "option field popover focuses the search input on open for shared select and multi-select editors"`
Expected: PASS

- [ ] **Step 5: Run targeted regression coverage**

Run: `npm test -- tests/data-editor.spec.ts --grep "detail panel multi-select removal keeps the popover ready for continued input|detail panel reuses table select and multi-select editors|option field editor popover uses shared shell and scroll section from table cell"`
Expected: PASS
