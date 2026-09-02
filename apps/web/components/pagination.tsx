"use client";

import { useEffect, useMemo, useState } from "react";

import { Button, Select, cx } from "@/components/ui";

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, "all"] as const;
export const SERVER_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export type ServerPageSize = (typeof SERVER_PAGE_SIZE_OPTIONS)[number];
export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
export type PaginatedResponse<T> = { items: T[]; pagination: PaginationMeta };

function pageWindow(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export function useClientPagination<T>(items: T[], resetKey = "") {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const total = items.length;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => setPage(1), [resetKey]);
  useEffect(() => setPage((current) => Math.min(current, totalPages)), [totalPages]);

  const pagedItems = useMemo(() => {
    if (pageSize === "all") return items;
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return {
    page,
    pageSize,
    pagedItems,
    setPage,
    setPageSize: (next: PageSize) => {
      setPageSize(next);
      setPage(1);
    },
    total,
    totalPages,
  };
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
}: {
  page: number;
  pageSize: PageSize;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
  pageSizeOptions?: readonly PageSize[];
  className?: string;
}) {
  if (total === 0) return null;

  const start = pageSize === "all" ? 1 : (page - 1) * pageSize + 1;
  const end = pageSize === "all" ? total : Math.min(page * pageSize, total);
  const window = pageWindow(page, totalPages);

  return (
    <nav
      aria-label="List pagination"
      className={cx(
        "flex max-w-full flex-col items-stretch justify-between gap-2 border-t border-brand-border bg-surface px-3 py-2 text-sm sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      <p className="text-xs font-medium tabular-nums text-slate-500">
        Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
        {totalPages > 1 ? <div className="flex flex-wrap items-center gap-1" aria-label={`Page ${page} of ${totalPages}`}>
          <Button
            type="button"
            variant="secondary"
            size="compact"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          {window.map((item, index) =>
            item === "ellipsis" ? (
              <span key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-slate-400">
                …
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                variant={item === page ? "primary" : "ghost"}
                size="compact"
                className="min-w-8 px-2 tabular-nums"
                aria-label={`Page ${item}`}
                aria-current={item === page ? "page" : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            ),
          )}
          <Button
            type="button"
            variant="secondary"
            size="compact"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div> : null}
        <label className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-600">
          Rows per page
          <Select
            aria-label="Rows per page"
            className="!mt-0 !min-h-8 w-auto !py-1 pl-2 pr-7 text-xs"
            value={String(pageSize)}
            onChange={(event) =>
              onPageSizeChange(event.target.value === "all" ? "all" : (Number(event.target.value) as PageSize))
            }
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All" : option}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </nav>
  );
}
