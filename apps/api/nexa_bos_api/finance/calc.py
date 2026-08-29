from __future__ import annotations

from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

from nexa_bos_api.finance.enums import CalculationMethod

ZERO = Decimal("0.00")
HUNDRED = Decimal("100")
CENT = Decimal("0.01")
SPLIT_QUANTUM = Decimal("0.0001")


def decimal_value(value: Decimal | int | str) -> Decimal:
    if isinstance(value, float):
        raise TypeError("Finance monetary calculations do not accept float values")
    return value if isinstance(value, Decimal) else Decimal(str(value))


def round_money(value: Decimal | int | str) -> Decimal:
    return decimal_value(value).quantize(CENT, rounding=ROUND_HALF_UP)


def normalize_split_percent(value: Decimal | int | str) -> Decimal:
    return decimal_value(value).quantize(SPLIT_QUANTUM, rounding=ROUND_HALF_UP)


def money(value: Decimal | int | str) -> str:
    return f"{round_money(value):.2f}"


def single_matching_slab(
    eligible_amount: Decimal,
    slabs: list[tuple[Decimal, Decimal | None, Decimal]],
) -> tuple[Decimal, Decimal | None, Decimal] | None:
    matches = [
        slab
        for slab in slabs
        if eligible_amount >= slab[0] and (slab[1] is None or eligible_amount <= slab[1])
    ]
    if len(matches) > 1:
        raise ValueError("Ambiguous overlapping slabs")
    return matches[0] if matches else None


def calculate_component(
    *,
    method: str,
    eligible_amount: Decimal,
    fixed_amount: Decimal | None,
    percentage_rate: Decimal | None,
    flat_amount: Decimal | None,
    slabs: list[tuple[Decimal, Decimal | None, Decimal]],
) -> Decimal:
    eligible = decimal_value(eligible_amount)
    if method == CalculationMethod.FIXED:
        if fixed_amount is None:
            raise ValueError("Fixed amount is required")
        raw = decimal_value(fixed_amount)
    elif method == CalculationMethod.PERCENTAGE:
        if percentage_rate is None:
            raise ValueError("Percentage rate is required")
        raw = eligible * decimal_value(percentage_rate) / HUNDRED
    elif method == CalculationMethod.FLAT_PERCENTAGE:
        if flat_amount is None or percentage_rate is None:
            raise ValueError("Flat amount and percentage rate are required")
        raw = decimal_value(flat_amount) + eligible * decimal_value(percentage_rate) / HUNDRED
    elif method == CalculationMethod.SLAB:
        match = single_matching_slab(eligible, slabs)
        raw = match[2] if match else ZERO
    else:
        raise ValueError("Unsupported Finance calculation method")
    return round_money(raw)


def largest_remainder_allocate[Key](
    source_amount: Decimal,
    shares: list[tuple[Key, Decimal, int]],
) -> dict[Key, Decimal]:
    """Allocate a rounded positive pool by percentage with exact cent reconciliation."""
    pool = round_money(source_amount)
    if pool < ZERO:
        raise ValueError("Percentage-split source amount cannot be negative")
    if not shares:
        raise ValueError("At least one recipient split is required")
    total_percent = sum((decimal_value(percent) for _, percent, _ in shares), start=Decimal(0))
    if total_percent != HUNDRED:
        raise ValueError("Recipient splits must total exactly 100%")
    total_cents = int((pool / CENT).to_integral_exact())
    floors: dict[Key, int] = {}
    remainders: list[tuple[Decimal, int, Key]] = []
    for key, percent, sort_order in shares:
        raw_cents = Decimal(total_cents) * decimal_value(percent) / HUNDRED
        floor_cents = int(raw_cents.to_integral_value(rounding=ROUND_FLOOR))
        floors[key] = floor_cents
        remainders.append((raw_cents - Decimal(floor_cents), sort_order, key))
    residual = total_cents - sum(floors.values())
    remainders.sort(key=lambda item: (-item[0], item[1]))
    for _remainder, _sort_order, key in remainders[:residual]:
        floors[key] += 1
    allocations = {key: Decimal(cents) * CENT for key, cents in floors.items()}
    if sum(allocations.values(), start=ZERO) != pool:
        raise AssertionError("Largest Remainder allocation did not reconcile")
    return allocations


def ranges_overlap(
    left_minimum: Decimal,
    left_maximum: Decimal | None,
    right_minimum: Decimal,
    right_maximum: Decimal | None,
) -> bool:
    left_end = left_maximum if left_maximum is not None else Decimal("Infinity")
    right_end = right_maximum if right_maximum is not None else Decimal("Infinity")
    return left_minimum <= right_end and right_minimum <= left_end
