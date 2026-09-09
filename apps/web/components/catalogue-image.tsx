import { cx } from "@/components/ui";
import type { CatalogItem, ProductVariantRecord } from "@/lib/types";

type CatalogueImageItem = CatalogItem | ProductVariantRecord;

export function CatalogueImage({
  item,
  api,
  size = "thumbnail",
}: {
  item: CatalogueImageItem;
  api: string;
  size?: "thumbnail" | "preview";
}) {
  const dimensions = size === "preview" ? "h-28 w-full" : "size-10 shrink-0";
  if (!item.hasImage || !item.imageUrl) {
    return (
      <span
        className={cx(
          dimensions,
          "flex items-center justify-center rounded-lg border border-dashed border-brand-border bg-white text-xs font-medium text-text-secondary",
        )}
        aria-label={`No image for ${item.name}`}
      >
        {size === "preview" ? "No image" : item.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  const version = item.imageUpdatedAt ? `?v=${encodeURIComponent(item.imageUpdatedAt)}` : "";
  return (
    // Authenticated catalogue images are API resources, so native loading preserves credentials.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${api}${item.imageUrl}${version}`}
      alt={`${item.name} image`}
      width={item.imageWidth ?? (size === "preview" ? 240 : 40)}
      height={item.imageHeight ?? (size === "preview" ? 112 : 40)}
      loading="lazy"
      className={cx(
        dimensions,
        "rounded-lg border border-brand-border bg-white object-contain p-1",
      )}
    />
  );
}
