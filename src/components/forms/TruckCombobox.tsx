"use client";

// Type-to-search over the fleet, for Rapport Geo's truck picker.
//
// It replaced a native <select>. With ~40 trucks named 00045-523-35 that
// control is technically usable and practically not: the names differ in
// the middle, native type-ahead only matches from the first character,
// and finding a truck meant scrolling a list of near-identical strings.
//
// Built rather than installed because the app has no component library
// and one dropdown does not justify starting one. It follows the
// WAI-ARIA combobox pattern (input + listbox, aria-activedescendant for
// the highlight) so the keyboard works the way a keyboard is supposed
// to, which is also what the project's own web-design-guidelines skill
// checks for.
//
// DEPTH IS A SURFACE STEP, NOT A SHADOW: the popup is --panel-3 over
// the panel's --panel-2 with a --line hairline, per the design system's
// no-drop-shadows rule. The .glass--float exception is for panels over
// live map tiles, which this is not.

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface TruckOption {
  truck_id: string;
  name: string | null;
}

interface Props {
  trucks: TruckOption[];
  /** The selected truck_id, or "" when nothing is chosen yet. */
  value: string;
  onChange(truckId: string): void;
  /** Shared with the sibling date inputs so the row lines up. */
  style?: React.CSSProperties;
}

function label(t: TruckOption): string {
  return t.name ? `${t.truck_id} — ${t.name}` : t.truck_id;
}

export default function TruckCombobox({ trucks, value, onChange, style }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = trucks.find((t) => t.truck_id === value) ?? null;

  // What the input shows when it is not being typed into. Derived rather
  // than pushed into state on selection: the parent owns `value`, and a
  // copy here would drift the moment the parent cleared it.
  const display = open ? query : selected ? label(selected) : "";

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return trucks;
    // Both halves, because the operator may know the truck by its plate
    // or by who drives it, and the id alone is not memorable.
    return trucks.filter(
      (t) =>
        t.truck_id.toLowerCase().includes(q) ||
        (t.name ?? "").toLowerCase().includes(q)
    );
  }, [trucks, query]);

  // Close on an outside click. Pointerdown rather than click so the
  // popup is gone before a click on something behind it lands.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function choose(t: TruckOption) {
    onChange(t.truck_id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Opening on an arrow press rather than only on typing: that is
      // how a native select behaves, and it is the one gesture someone
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
      // Only inside the popup. Left to bubble when closed, so Enter
      // still submits from the form row rather than being swallowed.
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
    ...style,
  };

  return (
    <div ref={rootRef} style={{ position: "relative", width: "fit-content" }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches.length > 0 ? `${listId}-${highlight}` : undefined}
        // Off, because the browser's own history dropdown covers this
        // one and offers whatever was typed into any similar field.
        autoComplete="off"
        spellCheck={false}
        placeholder="Search truck or driver…"
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
          aria-label="Trucks"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 4px)",
            left: 0,
            // Wider than the input when the content needs it. At the
            // input's 240px an id plus a driver name wraps to two lines,
            // which gives the list ragged row heights and makes it read
            // as a paragraph rather than a set of choices. The popup is
            // absolutely positioned, so growing it costs the form row
            // nothing.
            minWidth: "100%",
            width: "max-content",
            maxWidth: "360px",
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
            // Two different emptinesses. The roster is fetched on mount,
            // so an operator who reaches the control first sees an empty
            // list that is not a failed search — telling them "no truck
            // matches" for a query they never typed would read as a
            // broken filter.
            <li style={{ padding: "6px 8px", fontSize: ".78rem", color: "var(--text-dim)" }}>
              {trucks.length === 0 ? "Loading trucks…" : `No truck matches “${query}”`}
            </li>
          ) : (
            matches.map((t, i) => (
              <li
                key={t.truck_id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={t.truck_id === value}
                // Pointerdown, not click: the input's blur would
                // otherwise close the popup before the click resolved.
                onPointerDown={(e) => { e.preventDefault(); choose(t); }}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  padding: "5px 8px",
                  borderRadius: "4px",
                  fontSize: ".8rem",
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                  // One line per option, always. A name long enough to
                  // exceed maxWidth is clipped rather than wrapped —
                  // the id is the identifier and it leads.
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: t.truck_id === value ? "var(--text)" : "var(--text-dim)",
                  // Achromatic, like every other control in the app —
                  // the palette's five hues are spoken for by vehicle
                  // state and none of them means "highlighted".
                  background: i === highlight ? "rgba(255, 252, 225, 0.06)" : "transparent",
                }}
              >
                {t.truck_id}
                {t.name && (
                  <span style={{ color: "var(--text-dim)", marginLeft: 6 }}>— {t.name}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
