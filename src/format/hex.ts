/**
 * 六边形网格坐标换算。
 *
 * 与客户端 `MainScene.unity` 的 Grid 组件对齐：
 * `m_CellSize: (1, 1.14)`、`m_CellLayout: 1`（Hexagon，尖顶）。
 *
 * 三套坐标：
 *  - **格子下标** `(row, col)`：`MapInfo.Grid` 的索引，row 由南向北、col 由西向东，均 ≥ 0。
 *  - **cell 坐标** `(cx, cy)`：以地图中心为原点，即客户端 `LoadGrid` 里
 *    `new Vector3Int(col - floor(W/2), row - floor(H/2))`。
 *  - **世界坐标** `(x, y)`：写进 `BasesPosition` / `Tips[].Position` 的值。
 */

export const CELL_WIDTH = 1.0;
export const CELL_HEIGHT = 1.14;

/** 尖顶六边形相邻行的纵向间距：尖顶高度占 1/4，故行距为 cellHeight 的 3/4。 */
export const ROW_STEP = CELL_HEIGHT * 0.75; // 0.855

/** 客户端 `SetTextureToMap` / `SetSize` 用整数除法 `width / 100`，即 1 世界单位 = 100 像素。 */
export const PIXELS_PER_UNIT = 100;

/**
 * 真正的数学奇偶判定 —— 必须对负数也成立。
 * JS 的 `-7 % 2 === -1`，直接用 `% 2 === 1` 会让地图南半部分静默错位。
 */
export function isOddRow(cy: number): boolean {
  return ((cy % 2) + 2) % 2 === 1;
}

/** 客户端的居中偏移，对应 C# 的整数除法 `count / 2`。 */
export function centerOffset(count: number): number {
  return Math.floor(count / 2);
}

/** 格子下标 → cell 坐标。 */
export function indexToCell(
  row: number,
  col: number,
  width: number,
  height: number,
): { cx: number; cy: number } {
  return { cx: col - centerOffset(width), cy: row - centerOffset(height) };
}

/**
 * cell 坐标 → 世界坐标（六边形中心）。
 *
 * 横向偏移取决于 **cy 自身的奇偶**，而不是行下标的奇偶。
 * 这一点用 `operation`（height=103，居中偏移为奇数 51）验证过：
 * 按行下标判定会让全部 12 个坐标都算出非整数的 cx。
 */
export function cellToWorld(cx: number, cy: number): { x: number; y: number } {
  return {
    x: cx * CELL_WIDTH + (isOddRow(cy) ? CELL_WIDTH / 2 : 0),
    y: cy * ROW_STEP,
  };
}

/** 世界坐标 → 最近的 cell 坐标（摆放时的吸附）。 */
export function worldToCell(x: number, y: number): { cx: number; cy: number } {
  const cy = Math.round(y / ROW_STEP);
  const offset = isOddRow(cy) ? CELL_WIDTH / 2 : 0;
  return { cx: Math.round((x - offset) / CELL_WIDTH), cy };
}

/** 地图在世界空间中的尺寸，对应客户端 `MapLoader.SetSize`。 */
export function mapWorldSize(
  width: number,
  height: number,
): { worldWidth: number; worldHeight: number } {
  return { worldWidth: width * CELL_WIDTH, worldHeight: height * ROW_STEP };
}

/**
 * 底图在世界空间中的尺寸。
 *
 * 客户端 `SetTextureToMap` 用的是整数除法 `px / 100`，小数部分被丢掉 ——
 * 13703px 得到 137 而非 137.03，底图因此被横向压缩 0.02%。
 * 量级极小，但换算必须照做，否则编辑器画出来的位置和客户端对不上。
 */
export function imageWorldSize(
  imageWidth: number,
  imageHeight: number,
): { worldWidth: number; worldHeight: number } {
  return {
    worldWidth: Math.floor(imageWidth / PIXELS_PER_UNIT),
    worldHeight: Math.floor(imageHeight / PIXELS_PER_UNIT),
  };
}

/**
 * 网格的世界包围盒。
 *
 * 注意它**不是**以原点为中心的：居中偏移用的是 `floor(count/2)`，
 * 且奇数行整体右移半格，所以左右边界并不对称。底图却是严格居中于原点的
 * （见 `renderMap`），这半格之差正是「底图看着没对齐」的来源之一。
 */
export function gridWorldBounds(
  width: number,
  height: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const wo = centerOffset(width);
  const ho = centerOffset(height);
  const firstCy = -ho;
  const lastCy = height - 1 - ho;

  // 行数 ≥ 2 时奇偶行都存在；只有一行时看那一行自己的奇偶。
  const shifts =
    height >= 2
      ? [0, CELL_WIDTH / 2]
      : [isOddRow(firstCy) ? CELL_WIDTH / 2 : 0];

  return {
    minX: -wo + Math.min(...shifts) - CELL_WIDTH / 2,
    maxX: width - 1 - wo + Math.max(...shifts) + CELL_WIDTH / 2,
    minY: firstCy * ROW_STEP - CELL_HEIGHT / 2,
    maxY: lastCy * ROW_STEP + CELL_HEIGHT / 2,
  };
}

// ---------------------------------------------------------------------------
// 立方坐标：涂刷时需要「两点之间的连续格子」与「半径内的格子」，
// 这两件事在 offset 坐标里很难写对，转成 cube 坐标就是直线插值和距离比较。
//
// 本工程的 cell 坐标即 odd-r 布局（奇数行右移半格），与客户端
// NavGraphGenerator 的邻接表一致。
// ---------------------------------------------------------------------------

export interface Cube {
  q: number;
  r: number;
  s: number;
}

export function cellToCube(cx: number, cy: number): Cube {
  const parity = isOddRow(cy) ? 1 : 0;
  const q = cx - (cy - parity) / 2;
  return { q, r: cy, s: -q - cy };
}

export function cubeToCell(cube: Cube): { cx: number; cy: number } {
  const parity = isOddRow(cube.r) ? 1 : 0;
  return { cx: cube.q + (cube.r - parity) / 2, cy: cube.r };
}

/** 把可能带小数的 cube 坐标取整到最近的格子。 */
export function cubeRound(q: number, r: number, s: number): Cube {
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq, r: rr, s: rs };
}

export function cellDistance(a: { cx: number; cy: number }, b: { cx: number; cy: number }): number {
  const ca = cellToCube(a.cx, a.cy);
  const cb = cellToCube(b.cx, b.cy);
  return (Math.abs(ca.q - cb.q) + Math.abs(ca.r - cb.r) + Math.abs(ca.s - cb.s)) / 2;
}

/**
 * 两个格子之间的连续路径（含首尾）。
 * 鼠标拖快时相邻两帧可能隔着好几格，靠它把中间补上，否则笔迹会断成点。
 */
export function cellLine(
  from: { cx: number; cy: number },
  to: { cx: number; cy: number },
): Array<{ cx: number; cy: number }> {
  const steps = cellDistance(from, to);
  if (steps === 0) return [{ ...from }];

  const a = cellToCube(from.cx, from.cy);
  const b = cellToCube(to.cx, to.cy);
  const out: Array<{ cx: number; cy: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push(
      cubeToCell(
        cubeRound(
          a.q + (b.q - a.q) * t,
          a.r + (b.r - a.r) * t,
          a.s + (b.s - a.s) * t,
        ),
      ),
    );
  }
  return out;
}

/** 以某格为中心、半径 radius 以内的全部格子（radius=0 即单格）。 */
export function cellsInRadius(
  center: { cx: number; cy: number },
  radius: number,
): Array<{ cx: number; cy: number }> {
  const out: Array<{ cx: number; cy: number }> = [];
  const c = cellToCube(center.cx, center.cy);
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) {
      out.push(cubeToCell({ q: c.q + dq, r: c.r + dr, s: c.s - dq - dr }));
    }
  }
  return out;
}

/** 尖顶六边形的 6 个顶点，用于渲染。 */
export function hexCorners(
  centerX: number,
  centerY: number,
): Array<{ x: number; y: number }> {
  const halfW = CELL_WIDTH / 2;
  const halfH = CELL_HEIGHT / 2;
  const quarterH = CELL_HEIGHT / 4;
  return [
    { x: centerX, y: centerY + halfH },
    { x: centerX + halfW, y: centerY + quarterH },
    { x: centerX + halfW, y: centerY - quarterH },
    { x: centerX, y: centerY - halfH },
    { x: centerX - halfW, y: centerY - quarterH },
    { x: centerX - halfW, y: centerY + quarterH },
  ];
}
