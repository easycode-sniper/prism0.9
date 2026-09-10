"use client";

// Type-to-search over a list, following the WAI-ARIA combobox pattern
// (input + listbox, aria-activedescendant for the highlight) so the
// keyboard works the way a keyboard is supposed to.
//
// THIS WAS TruckCombobox. It was extracted when the dashboard needed the
// same control over drivers AND trucks: a second copy of 240 lines of
// popup, keyboard and focus handling is exactly the drift that left this
// codebase with three different statusColor functions. TruckCombobox is
// now a thin wrapper over this and behaves as it always did.
//
// Built rather than installed because the app has no component library
// and two dropdowns still do not justify starting one.
//
// DEPTH IS A SURFACE STEP, NOT A SHADOW: the popup is --panel-3 over the
// panel's --panel-2 with a --line hairline, per the design system's
// no-drop-shadows rule. The .glass--float exception is for panels over
// live map tiles, which this is not.

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboOption {
  /** What onChange hands back. Must be unique across the whole list. */
  id: string;
  /** The leading text, and what the search matches first. */
  label: string;
  /** Dim trailing text — a driver's name beside a truck id, a count of
   *  what is behind an option. Also searched, because the operator may
   *  know the row by that half. */
  hint?: string | null;
  /** Optional heading this option sits under. Options are shown in the
   *  order given; a group heading is drawn before the first option that
   *  carries it. */
  group?: string;
  /** Rendered after the hint in the app's dim colour, for a short note
   *  about the option itself rather than about what it contains. */
  note?: string | null;
}

interface Props {
  options: ComboOption[];
  /** The selected id, or "" when nothing is chosen. */
  value: string;
  onChange(id: string): void;
  placeholder?: string;
  /** Accessible name for the popup list. */
  listLabel?: string;
  /** Shown when there are no options at all — which is not the same as a
   *  search that matched nothing. Telling someone "no match" for a query
   *  they never typed reads as a broken filter. */
  loadingText?: string;
  /** Shown when a query matched nothing. */
  noMatchText?: (query: string) => string;
  style?: React.CSSProperties;
}

export default function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search…",
  listLabel = "Options",
  loadingText = "Loading…",
  noMatchText = (q) => `No match for “${q}”`,
  style,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.id === value) ?? null;

  // What the input shows when it is not being typed into. Derived rather
  // than pushed into state on selection: the parent owns `value`, and a
  // copy here would drift the moment the parent cleared it.
  const display = open ? query : selected ? selected.label : "";

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  // Close on an outside click. Pointerdown rather than click so the popup
  // is gone before a click on something behind it lands.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold. Query
  // by id rather than indexing children: group headings are children too,
  // so children[highlight] stopped being the highlighted option the
  // moment grouping was added.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`#${CSS.escape(`${listId}-${highlight}`)}`);
    (el as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }, [highlight, open, listId]);

  function choose(o: ComboOption) {
    onChange(o.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Opening on an arrow press rather than only on typing: that is how
      // a native select behaves, and it is the one gesture someone
      // reaches for when they want to browse rather than search.
      e.preventDefault();
      if (!open) { setOpen(true); setHighlight(0); return; }
      if (matches.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlight((h) => (h + step + matches.length) % matches.length);
      return;
    }
    if (e.key === "Enter") {
      if (!open || matches.length === 0) return;
      // Only inside the popup. Left to bubble when closed, so Enter still
      // submits from the form row rather than being swallowed.
      e.preventDefault();
      choose(matches[highlight]);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "Tab") setOpen(false);
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-sm)",
    padding: "6px 10px",
    color: "var(--text)",
    fontSize: ".82rem",
    fontFamily: "var(--font-mono)",
    width: "240px",
    // Never wider than the room it has. A fixed width plus a sibling
    // button overflowed a 320px viewport, and because the dashboard
    // wrapper scrolls vertically its overflow-x computes to auto and
    // swallowed the spill — the document reported no overflow while the
    // control sat off the right edge. Same trap as the drivers form.
    maxWidth: "100%",
    ...style,
  };

  // ROOT SIZING: width:100% with max-width:fit-content, NOT
  // width:fit-content. The input carries max-width:100%, and against a
  // fit-content parent that is circular — the parent is sized BY the
  // input, so 100% resolves to the input's own fixed width and it never
  // shrinks. This pair makes the root min(available, its content), which
  // the input can then resolve against. Measured: with the old form the
  // dashboard's picker sat 62px off the right edge at a 320px viewport,
  // and the page wrapper's overflow-y:auto hid it from any document-level
  // overflow check.
  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%", maxWidth: "fit-content" }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches.length > 0 ? `${listId}-${highlight}` : undefined}
        // Off, because the browser's own history dropdown covers this one
        // and offers whatever was typed into any similar field.
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={display}
        style={inputStyle}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => { setQuery(""); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
      />

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 4px)",
            left: 0,
            // Wider than the input when the content needs it. At 240px an
            // id plus a name wraps to two lines, which gives the list
            // ragged row heights and makes it read as a paragraph rather
            // than a set of choices. The popup is absolutely positioned,
            // so growing it costs the row nothing.
            minWidth: "100%",
            width: "max-content",
            // 360 where there is room, otherwise the viewport less a
            // gutter: at 320px a flat 360 put the popup's left edge 52px
            // off screen, which hides the start of every name in it.
            maxWidth: "min(360px, calc(100vw - 32px))",
            maxHeight: "260px",
            overflowY: "auto",
            background: "var(--panel-3)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
            padding: "4px",
            margin: 0,
            listStyle: "none",
          }}
        >
          {matches.length === 0 ? (
            // Two different emptinesses — see loadingText.
            <li style={{ padding: "6px 8px", fontSize: ".78rem", color: "var(--text-dim)" }}>
              {options.length === 0 ? loadingText : noMatchText(query)}
            </li>
          ) : (
            matches.map((o, i) => {
              const heading = o.group && o.group !== matches[i - 1]?.group ? o.group : null;
              return (
                <li key={o.id} style={{ listStyle: "none" }}>
                  {heading && (
                    // role="presentation" so it stays out of the listbox's
                    // option count — a heading is not a choice, and a
                    // screen reader announcing "3 of 9" must mean options.
                    <div
                      role="presentation"
                      className="t-faint"
                      style={{
                        padding: "6px 8px 3px",
                        fontSize: ".62rem",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {heading}
                    </div>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={o.id === value}
                    // Pointerdown, not click: the input's blur would
                    // otherwise close the popup before the click resolved.
                    onPointerDown={(e) => { e.preventDefault(); choose(o); }}
                    onMouseEnter={() => setHighlight(i)}
                    style={{
                      padding: "5px 8px",
                      borderRadius: "4px",
                      fontSize: ".8rem",
                      fontFamily: "var(--font-mono)",
                      cursor: "pointer",
                      // One line per option, always. A label long enough
                      // to exceed maxWidth is clipped rather than wrapped
                      // — the label is the identifier and it leads.
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: o.id === value ? "var(--text)" : "var(--text-dim)",
                      // Achromatic, like every other control in the app —
                      // the palette's five hues are spoken for by vehicle
                      // state and none of them means "highlighted".
                      background: i === highlight ? "rgba(255, 252, 225, 0.06)" : "transparent",
                    }}
                  >
                    {o.label}
                    {o.hint && (
                      <span style={{ color: "var(--text-dim)", marginLeft: 6 }}>— {o.hint}</span>
                    )}
                    {o.note && (
                      <span className="t-faint" style={{ marginLeft: 6, fontSize: ".72rem" }}>
                        {o.note}
                      </span>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
