const PAGE_SIZE = 1000;

/**
 * PostgREST caps unpaginated selects at a server-side max-rows limit (1000
 * by default) and silently truncates rather than erroring, so any query
 * that can return more rows than that must page through with .range() to
 * avoid silently dropping data. `buildQuery` must construct a fresh query
 * each call (Supabase query builders can't be re-ranged after awaiting).
 */
export async function fetchAllRows<T>(
  buildQuery: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  }
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}
