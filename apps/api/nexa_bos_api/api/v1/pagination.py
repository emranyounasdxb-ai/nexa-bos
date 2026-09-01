from __future__ import annotations

from enum import IntEnum
from typing import Annotated

from fastapi import Depends, Query


class PageSize(IntEnum):
    TEN = 10
    TWENTY_FIVE = 25
    FIFTY = 50


class PaginationParams:
    def __init__(
        self,
        page: Annotated[int, Query(ge=1)] = 1,
        page_size: Annotated[PageSize, Query()] = PageSize.TEN,
    ) -> None:
        self.page = page
        self.page_size = int(page_size)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


PaginationDep = Annotated[PaginationParams, Depends()]
