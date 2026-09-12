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
  const placeholderDimensions = size === "preview" ? "h-28 w-full" : "h-10 w-16 shrink-0";
  if (!item.hasImage || !item.imageUrl) {
    return (
      <span
        className={cx(
          placeholderDimensions,
          "flex items-center justify-center rounded-lg border border-dashed border-brand-border bg-surface text-xs font-medium text-text-secondary",
        )}
        aria-label={`No image for ${item.name}`}
      >
        {size === "preview" ? "No image" : item.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  const version = item.imageUpdatedAt ? `?v=${encodeURIComponent(item.imageUpdatedAt)}` : "";
  const sourceWidth = item.imageWidth && item.imageWidth > 0 ? item.imageWidth : 1;
  const sourceHeight = item.imageHeight && item.imageHeight > 0 ? item.imageHeight : 1;
  const maxWidth = size === "preview" ? 240 : 64;
  const maxHeight = size === "preview" ? 112 : 40;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const renderedWidth = Math.max(1, Math.round(sourceWidth * scale));
  return (
    // Authenticated catalogue images are API resources, so native loading preserves credentials.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${api}${item.imageUrl}${version}`}
      alt={`${item.name} image`}
      width={item.imageWidth ?? (size === "preview" ? 240 : 40)}
      height={item.imageHeight ?? (size === "preview" ? 112 : 40)}
      loading="eager"
      className="block h-auto max-h-28 max-w-full shrink-0 object-contain"
      style={{ width: renderedWidth }}
    />
  );
}
