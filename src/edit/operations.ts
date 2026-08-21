/** 对 MapInfo 的实际改动。全部就地修改，撤销靠 history 的快照。 */
import { gridSize } from '../format/mapfile.ts';
import {
  cellDistance,
  cellToWorld,
  cellsInRadius,
  centerOffset,
  worldToCell,
} from '../format/hex.ts';
import type { MapInfo, TipData, Vec2 } from '../format/types.ts';

export type Tool = 'pan' | 'block' | 'clear' | 'base' | 'lighthouse' | 'tip' | 'select';

export type ItemRef =
  | { kind: 'base'; key: string }
  | { kind: 'lighthouse'; key: string }
  | { kind: 'tip'; index: number };

export function refLabel(info: MapInfo, ref: ItemRef): string {
  return ref.kind === 'tip' ? (info.Tips[ref.index]?.Content ?? '') : ref.key;
}

export function sameRef(a: ItemRef | null, b: ItemRef | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'tip' ? a.index === (b as typeof a).index : a.key === (b as typeof a).key;
}

/**
 * 把 cell 的横坐标折回地图本体。
 *
 * Loop 地图左右各画了一份复制品，用户很可能在复制品上落笔；
 * 不折回的话改动会落到范围之外被丢弃，表现为「点了没反应」。
 */
export function wrapCellX(cx: number, info: MapInfo): number {
  if (!info.Loop) return cx;
  const { width } = gridSize(info);
  const offset = centerOffset(width);
  const col = (((cx + offset) % width) + width) % width;
  return col - offset;
}

/** 世界横坐标折回本体，用于标注这类不吸附网格的物件。 */
export function wrapWorldX(x: number, info: MapInfo): number {
  if (!info.Loop) return x;
  const { width } = gridSize(info);
  const half = width / 2;
  return (((x + half) % width) + width) % width - half;
}

/** cell 坐标 → Grid 下标；越界返回 null。 */
export function cellToGridIndex(
  cx: number,
  cy: number,
  info: MapInfo,
): { row: number; col: number } | null {
  const { width, height } = gridSize(info);
  const row = cy + centerOffset(height);
  const col = wrapCellX(cx, info) + centerOffset(width);
  if (row < 0 || row >= height || col < 0 || col >= width) return null;
  return { row, col };
}

/** 涂刷一批格子，返回是否真的产生了改动。 */
export function paintCells(
  info: MapInfo,
  cells: Array<{ cx: number; cy: number }>,
  value: 0 | 1,
  radius = 0,
): boolean {
  let changed = false;
  for (const cell of cells) {
    for (const target of radius > 0 ? cellsInRadius(cell, radius) : [cell]) {
      const index = cellToGridIndex(target.cx, target.cy, info);
      if (!index) continue;
      if (info.Grid[index.row][index.col] !== value) {
        info.Grid[index.row][index.col] = value;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * `Loop` 地图左右各补一份的世界横向偏移。
 *
 * 拼接周期是网格列数，不是底图或包围盒宽度 —— 客户端按列数实例化三份
 * mapImage/Tilemap。渲染层（renderMap.ts）复用这份定义，避免各自维护
 * 一份 `[-width, 0, width]` 后彼此静默漂移。
 */
export function loopShifts(info: MapInfo): number[] {
  if (!info.Loop) return [0];
  const { width } = gridSize(info);
  return [-width, 0, width];
}

/** 命中测试：找出离世界坐标最近、且在阈值内的物件。 */
export function hitTestItem(
  info: MapInfo,
  x: number,
  y: number,
  threshold = 0.7,
): ItemRef | null {
  let best: ItemRef | null = null;
  let bestDistance = threshold;

  const consider = (ref: ItemRef, pos: Vec2) => {
    for (const dx of loopShifts(info)) {
      const distance = Math.hypot(pos.X + dx - x, pos.Y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = ref;
      }
    }
  };

  // 顺序即优先级：小的先测，避免被大圆盖住
  info.Tips.forEach((tip, index) => consider({ kind: 'tip', index }, tip.Position));
  for (const [key, pos] of Object.entries(info.LighthousesPosition)) {
    consider({ kind: 'lighthouse', key }, pos);
  }
  for (const [key, pos] of Object.entries(info.BasesPosition)) {
    consider({ kind: 'base', key }, pos);
  }
  return best;
}

function tableOf(info: MapInfo, kind: 'base' | 'lighthouse'): Record<string, Vec2> {
  return kind === 'base' ? info.BasesPosition : info.LighthousesPosition;
}

export function itemPosition(info: MapInfo, ref: ItemRef): Vec2 | null {
  if (ref.kind === 'tip') return info.Tips[ref.index]?.Position ?? null;
  return tableOf(info, ref.kind)[ref.key] ?? null;
}

/**
 * 移动物件。
 *
 * 基地与灯塔吸附到六边形中心；标注不吸附 —— 现网地图里的标注坐标
 * 就是任意值（如 -16.138, 3.802），强行吸附会改变原有排版。
 */
export function moveItem(info: MapInfo, ref: ItemRef, x: number, y: number): void {
  if (ref.kind === 'tip') {
    const tip = info.Tips[ref.index];
    if (tip) tip.Position = { X: wrapWorldX(x, info), Y: y };
    return;
  }
  const { cx, cy } = worldToCell(x, y);
  const world = cellToWorld(wrapCellX(cx, info), cy);
  tableOf(info, ref.kind)[ref.key] = { X: world.x, Y: world.y };
}

export function deleteItem(info: MapInfo, ref: ItemRef): void {
  if (ref.kind === 'tip') info.Tips.splice(ref.index, 1);
  else delete tableOf(info, ref.kind)[ref.key];
}

export function renameItem(
  info: MapInfo,
  ref: ItemRef,
  nextKey: string,
): boolean {
  if (ref.kind === 'tip') {
    const tip = info.Tips[ref.index];
    if (!tip) return false;
    tip.Content = nextKey;
    return true;
  }
  const table = tableOf(info, ref.kind);
  if (nextKey === ref.key) return true;
  if (nextKey in table) return false;
  table[nextKey] = table[ref.key];
  delete table[ref.key];
  return true;
}

/** 未被占用的基地名，供「放置基地」时自动取一个。 */
export function nextFreeBaseName(info: MapInfo, candidates: readonly string[]): string | null {
  return candidates.find((name) => !(name in info.BasesPosition)) ?? null;
}

/**
 * 生成一个新的灯塔 ID。
 *
 * 旧 ACME 用 `GetHashCode().ToString()`，产出 `-19868` 这类无意义的值，
 * 且冲突时 `TryAdd` 会静默丢灯塔。这里改成可读且必不重复的形式。
 */
export function nextLighthouseId(info: MapInfo): string {
  for (let i = 1; ; i++) {
    const id = `lighthouse_${i}`;
    if (!(id in info.LighthousesPosition)) return id;
  }
}

export const DEFAULT_TIP: Omit<TipData, 'Position'> = {
  TextSize: 0.8,
  Color: { R: 1, G: 1, B: 1, A: 1 },
  Content: '新标注',
};

/** 放置一个物件，返回它的引用；基地名用尽时返回 null。 */
export function placeItem(
  info: MapInfo,
  kind: ItemRef['kind'],
  x: number,
  y: number,
  baseNames: readonly string[],
): ItemRef | null {
  if (kind === 'tip') {
    info.Tips.push({ ...DEFAULT_TIP, Position: { X: wrapWorldX(x, info), Y: y } });
    return { kind: 'tip', index: info.Tips.length - 1 };
  }
  const key = kind === 'base' ? nextFreeBaseName(info, baseNames) : nextLighthouseId(info);
  if (key === null) return null;
  const ref: ItemRef = { kind, key };
  moveItem(info, ref, x, y);
  return ref;
}

/** 供渲染高亮用：光标所在格（已折回本体）。 */
export function cellUnderCursor(
  info: MapInfo,
  x: number,
  y: number,
): { cx: number; cy: number } | null {
  const { cx, cy } = worldToCell(x, y);
  const index = cellToGridIndex(cx, cy, info);
  if (!index) return null;
  return { cx: wrapCellX(cx, info), cy };
}

/**
 * 改变网格尺寸，以地图中心为锚。
 *
 * 锚点必须与 `centerOffset` 一致，否则改完尺寸后所有物件相对地形整体平移。
 */
export function resizeGrid(info: MapInfo, nextWidth: number, nextHeight: number): void {
  const { width, height } = gridSize(info);
  if (nextWidth === width && nextHeight === height) return;

  const oldWO = centerOffset(width);
  const oldHO = centerOffset(height);
  const newWO = centerOffset(nextWidth);
  const newHO = centerOffset(nextHeight);

  const grid: number[][] = new Array(nextHeight);
  for (let row = 0; row < nextHeight; row++) {
    const line = new Array<number>(nextWidth).fill(0);
    const srcRow = row - newHO + oldHO;
    if (srcRow >= 0 && srcRow < height) {
      for (let col = 0; col < nextWidth; col++) {
        const srcCol = col - newWO + oldWO;
        if (srcCol >= 0 && srcCol < width) line[col] = info.Grid[srcRow][srcCol];
      }
    }
    grid[row] = line;
  }
  info.Grid = grid;
}

/** 尺寸变化后，哪些物件掉到了网格之外。 */
export function itemsOutsideGrid(info: MapInfo): ItemRef[] {
  const out: ItemRef[] = [];
  const check = (ref: ItemRef) => {
    const pos = itemPosition(info, ref);
    if (!pos) return;
    const { cx, cy } = worldToCell(pos.X, pos.Y);
    if (!cellToGridIndex(cx, cy, info)) out.push(ref);
  };
  for (const key of Object.keys(info.BasesPosition)) check({ kind: 'base', key });
  for (const key of Object.keys(info.LighthousesPosition)) check({ kind: 'lighthouse', key });
  return out;
}

export { cellDistance };
