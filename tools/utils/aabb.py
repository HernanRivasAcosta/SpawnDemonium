from dataclasses import dataclass


@dataclass
class AABB:
    x: int
    y: int
    w: int
    h: int
    wall: bool = False

    @property
    def x2(self) -> int:
        return self.x + self.w

    @property
    def y2(self) -> int:
        return self.y + self.h

    def translated(self, dx: int, dy: int, wall: bool | None = None) -> "AABB":
        return AABB(
            self.x + dx,
            self.y + dy,
            self.w,
            self.h,
            self.wall if wall is None else wall,
        )


def simplify(aabbs: list[AABB]) -> list[AABB]:
    # Returns a near-minimal covering of the input union, preferring tall rectangles.
    # Inputs may overlap; outputs may overlap too.
    # Wall and non-wall AABBs are simplified independently and never merged together.
    if not aabbs:
        return []
    return _simplify_group([a for a in aabbs if a.wall], wall=True) + _simplify_group(
        [a for a in aabbs if not a.wall], wall=False
    )


def _simplify_group(aabbs: list[AABB], wall: bool) -> list[AABB]:
    if not aabbs:
        return []

    # Coordinate compression
    xs = sorted({a.x for a in aabbs} | {a.x2 for a in aabbs})
    ys = sorted({a.y for a in aabbs} | {a.y2 for a in aabbs})

    xi = {v: i for i, v in enumerate(xs)}
    yi = {v: i for i, v in enumerate(ys)}

    cols = len(xs) - 1
    rows = len(ys) - 1

    # Mark covered cells — cell (c, r) is [xs[c], xs[c+1]) × [ys[r], ys[r+1])
    covered = [[False] * cols for _ in range(rows)]

    for a in aabbs:
        c0, c1 = xi[a.x], xi[a.x2]
        r0, r1 = yi[a.y], yi[a.y2]
        for r in range(r0, r1):
            for c in range(c0, c1):
                covered[r][c] = True

    # Greedy extraction — column-major, tall-first
    claimed = [[False] * cols for _ in range(rows)]
    result: list[AABB] = []

    for c in range(cols):
        for r in range(rows):
            if not covered[r][c] or claimed[r][c]:
                continue

            # (a) Tallest downward run starting at (c, r).
            h_cells = 0
            while (
                r + h_cells < rows
                and covered[r + h_cells][c]
                and not claimed[r + h_cells][c]
            ):
                h_cells += 1

            # (b) Extend right while the full height is available.
            w_cells = 1
            while c + w_cells < cols:
                nc = c + w_cells
                if all(
                    covered[r + dr][nc] and not claimed[r + dr][nc]
                    for dr in range(h_cells)
                ):
                    w_cells += 1
                else:
                    break

            # (c) Claim cells and emit AABB.
            for dr in range(h_cells):
                for dc in range(w_cells):
                    claimed[r + dr][c + dc] = True

            result.append(
                AABB(
                    x=xs[c],
                    y=ys[r],
                    w=xs[c + w_cells] - xs[c],
                    h=ys[r + h_cells] - ys[r],
                    wall=wall,
                )
            )

    return result
