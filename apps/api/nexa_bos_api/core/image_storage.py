from __future__ import annotations

import secrets
import warnings
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.exceptions import AppError

MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = 16_000_000

_FORMATS = {
    "JPEG": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
    "WEBP": ("image/webp", ".webp"),
}
_MIME_EXTENSIONS = {
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
}


@dataclass(frozen=True)
class ValidatedImage:
    data: bytes
    content_type: str
    extension: str
    width: int
    height: int


def _validate_dimensions(width: int, height: int) -> None:
    if (
        width < 1
        or height < 1
        or width > MAX_IMAGE_DIMENSION
        or height > MAX_IMAGE_DIMENSION
        or width * height > MAX_IMAGE_PIXELS
    ):
        raise AppError(
            status_code=422,
            code="IMAGE_DIMENSIONS_INVALID",
            message="Image dimensions must be between 1 and 4096 pixels per side",
        )


async def validate_image_upload(upload: UploadFile) -> ValidatedImage:
    declared_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
    suffix = Path(upload.filename or "").suffix.lower()
    if declared_type not in _MIME_EXTENSIONS or suffix not in _MIME_EXTENSIONS[declared_type]:
        raise AppError(
            status_code=422,
            code="IMAGE_TYPE_INVALID",
            message="Upload a PNG, JPEG, or WebP image with a matching file extension",
        )

    payload = await upload.read(MAX_IMAGE_BYTES + 1)
    if not payload:
        raise AppError(status_code=422, code="IMAGE_EMPTY", message="Image file is empty")
    if len(payload) > MAX_IMAGE_BYTES:
        raise AppError(
            status_code=413,
            code="IMAGE_TOO_LARGE",
            message="Image file must be 2 MB or smaller",
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as probe:
                detected_format = probe.format
                _validate_dimensions(*probe.size)
                probe.verify()
            with Image.open(BytesIO(payload)) as decoded:
                decoded.load()
                normalized = ImageOps.exif_transpose(decoded)
                width, height = normalized.size
                _validate_dimensions(width, height)
                if detected_format not in _FORMATS:
                    raise AppError(
                        status_code=422,
                        code="IMAGE_TYPE_INVALID",
                        message="Upload a valid PNG, JPEG, or WebP image",
                    )
                actual_type, extension = _FORMATS[detected_format]
                if actual_type != declared_type:
                    raise AppError(
                        status_code=422,
                        code="IMAGE_TYPE_MISMATCH",
                        message="Image content does not match its declared type",
                    )
                output = BytesIO()
                if detected_format == "JPEG":
                    normalized.convert("RGB").save(output, "JPEG", quality=90, optimize=True)
                elif detected_format == "PNG":
                    normalized.save(output, "PNG", optimize=True)
                else:
                    normalized.save(output, "WEBP", quality=90, method=6)
    except AppError:
        raise
    except Image.DecompressionBombError, Image.DecompressionBombWarning:
        raise AppError(
            status_code=422,
            code="IMAGE_DIMENSIONS_INVALID",
            message="Image dimensions exceed the safe limit",
        ) from None
    except UnidentifiedImageError, OSError, SyntaxError, ValueError:
        raise AppError(
            status_code=422,
            code="IMAGE_CONTENT_INVALID",
            message="The uploaded file is not a valid image",
        ) from None

    normalized_payload = output.getvalue()
    if len(normalized_payload) > MAX_IMAGE_BYTES:
        raise AppError(
            status_code=413,
            code="IMAGE_TOO_LARGE",
            message="Normalized image must be 2 MB or smaller",
        )
    return ValidatedImage(
        data=normalized_payload,
        content_type=actual_type,
        extension=extension,
        width=width,
        height=height,
    )


def _storage_root() -> Path:
    root = get_settings().file_storage_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def image_path(storage_key: str) -> Path:
    key = PurePosixPath(storage_key)
    if key.is_absolute() or ".." in key.parts or not key.parts:
        raise AppError(status_code=404, code="IMAGE_NOT_FOUND", message="Image not found")
    root = _storage_root()
    candidate = root.joinpath(*key.parts).resolve()
    if root not in candidate.parents:
        raise AppError(status_code=404, code="IMAGE_NOT_FOUND", message="Image not found")
    return candidate


def store_image(image: ValidatedImage, category: str) -> str:
    safe_category = PurePosixPath(category)
    if safe_category.is_absolute() or ".." in safe_category.parts or not safe_category.parts:
        raise RuntimeError("Unsafe image storage category")
    directory = _storage_root().joinpath(*safe_category.parts)
    directory.mkdir(parents=True, exist_ok=True)
    for _ in range(5):
        filename = f"{secrets.token_hex(16)}{image.extension}"
        path = directory / filename
        try:
            with path.open("xb") as handle:
                handle.write(image.data)
            return PurePosixPath(*safe_category.parts, filename).as_posix()
        except FileExistsError:
            continue
    raise RuntimeError("Could not allocate a unique image storage key")


def remove_image(storage_key: str | None) -> None:
    if storage_key:
        image_path(storage_key).unlink(missing_ok=True)
