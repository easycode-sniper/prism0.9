"use client";

// Type-to-search over the fleet, for Rapport Geo's truck picker.
//
// It replaced a native <select>. With ~40 trucks named 00045-523-35 that
// control is technically usable and practically not: the names differ in
// the middle, native type-ahead only matches from the first character,
// and finding a truck meant scrolling a list of near-identical strings.
//
// The popup, keyboard handling and styling now live in Combobox — this
// is the fleet-shaped wrapper over it. The behaviour is unchanged: the
// same placeholder, the same "id — driver" label, the same search over
// both halves because the operator may know the truck by its plate or by
// who drives it, and the id alone is not memorable.

import Combobox, { type ComboOption } from "./Combobox";

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

export default function TruckCombobox({ trucks, value, onChange, style }: Props) {
  const options: ComboOption[] = trucks.map((t) => ({
    id: t.truck_id,
    label: t.truck_id,
    hint: t.name,
  }));

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Search truck or driver…"
      listLabel="Trucks"
      loadingText="Loading trucks…"
      noMatchText={(q) => `No truck matches “${q}”`}
      style={style}
    />
  );
}
