// MapRegionManager — divides a dungeon map image into a grid of scrollable
// windows and hands out one fresh, unused window per room.  When every region
// has been seen, the pool is reshuffled so the run can continue indefinitely.
//
// Region strategy: "sliding window" rather than a strict non-overlapping grid.
// Each cell is (REGION_W × REGION_H) = (1280 × 900) px, which is larger than
// the 960 × 640 viewport, giving the camera room to scroll 320 px horizontally
// and 260 px vertically within every room.
//
// With cols = 4 and rows = 3 over a 1920 × 1080 source image:
//   xStep = (1920 - 1280) / (4 - 1) = 213 px
//   yStep = (1080 - 900)  / (3 - 1) = 90  px
// → 12 distinct (though overlapping) windows, each showing a different area.

export interface MapRegion {
  id: string;
  x:  number;
  y:  number;
  w:  number;
  h:  number;
}

export const REGION_W = 1280;
export const REGION_H = 900;

export class MapRegionManager {
  private readonly all:  MapRegion[];
  private          pool: MapRegion[] = [];

  constructor(
    mapW = 1920, mapH = 1080,
    cols = 4,    rows = 3,
  ) {
    const w     = REGION_W;
    const h     = REGION_H;
    const xStep = cols > 1 ? Math.floor((mapW - w) / (cols - 1)) : 0;
    const yStep = rows > 1 ? Math.floor((mapH - h) / (rows - 1)) : 0;

    this.all = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = Math.min(col * xStep, mapW - w);
        const y = Math.min(row * yStep, mapH - h);
        this.all.push({ id: `r${col}c${row}`, x, y, w, h });
      }
    }

    this.refill();
  }

  // Returns the next unused region, reshuffling the full pool when empty.
  next(): MapRegion {
    if (this.pool.length === 0) this.refill();
    return this.pool.pop()!;
  }

  // Expose pool size for diagnostics.
  get remaining(): number { return this.pool.length; }

  private refill() {
    // Fisher-Yates via sort trick — acceptable for a small pool.
    this.pool = [...this.all].sort(() => Math.random() - 0.5);
  }
}
