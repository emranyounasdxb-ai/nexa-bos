"""Inert spreadsheet text shared by existing export formats."""

from __future__ import annotations


def spreadsheet_safe(value: object) -> object:
    # Quoting CSV fields alone does not prevent spreadsheet interpretation.
    # Preserve numeric objects and the complete original string; never truncate
    # or strip attacker-controlled leading whitespace/control characters.
    if isinstance(value, str) and (
        value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n"))
    ):
        return f"'{value}"
    return value
