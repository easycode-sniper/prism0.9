/**
 * The half of an optimistic update that is easy to leave out.
 *
 * Patching state locally when the user clicks is the visible half. The
 * other half is surviving what happens next: these lists are refetched
 * by realtime and by interval polls, and a refetch that was already in
 * flight when the write went out lands carrying the OLD row and silently
 * undoes the patch. The unread dot comes back, the stopped run
 * reappears, and the user clicks again.
 *
 * So a patch is also recorded in an overlay, and the overlay is
 * re-applied to every load until the server's own copy agrees — at which
 * point the entry is dropped and the server is in charge again.
 *
 * Both helpers MUTATE the overlay they are given. That is the point:
 * settling is the only way an entry is ever removed, so it has to happen
 * where the fresh rows are seen.
 */

/**
 * Hold one field at a chosen value until the loaded row reports that
 * value itself.
 *
 * An id that is missing from `rows` is dropped: it can never confirm.
 * A notification that ages out of the 24h window would otherwise sit in
 * the overlay for the life of the tab.
 */
export function applyFieldOverlay<T, K extends keyof T>(
  rows: T[],
  overlay: Map<string, T[K]>,
  field: K,
  idOf: (row: T) => string
): T[] {
  if (overlay.size === 0) return rows;

  const present = new Set<string>();
  const patched = rows.map((row) => {
    const id = idOf(row);
    present.add(id);
    if (!overlay.has(id)) return row;

    const wanted = overlay.get(id) as T[K];
    if (row[field] === wanted) {
      overlay.delete(id);
      return row;
    }
    return { ...row, [field]: wanted };
  });

  for (const id of [...overlay.keys()]) if (!present.has(id)) overlay.delete(id);
  return patched;
}

/**
 * Hold a row out of a list until it stops being returned.
 *
 * The opposite settling rule to applyFieldOverlay, and deliberately so:
 * here ABSENCE is the confirmation. listActiveDispatches only returns
 * active runs, so a stopped run simply stops appearing, and that is the
 * server agreeing. A row still present is one the write has not landed
 * for yet, so it stays hidden.
 */
export function applyRemovalOverlay<T>(
  rows: T[],
  overlay: Set<string>,
  idOf: (row: T) => string
): T[] {
  if (overlay.size === 0) return rows;

  const present = new Set(rows.map(idOf));
  for (const id of [...overlay]) if (!present.has(id)) overlay.delete(id);

  return rows.filter((row) => !overlay.has(idOf(row)));
}
