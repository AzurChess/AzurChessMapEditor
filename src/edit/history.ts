/**
 * 撤销/重做。
 *
 * 用整份快照而不是命令栈：128×103 的 Grid 存成 Int8Array 才 13KB，
 * 连同基地/灯塔/标注的 JSON 也不过几十 KB，存 50 步毫无压力。
 * 命令栈要为每种操作各写一份逆操作，是本工程里最不值得的复杂度。
 */
import type { MapInfo } from '../format/types.ts';

export interface Snapshot {
  width: number;
  height: number;
  grid: Int8Array;
  /** 基地/灯塔/标注与 Loop 标志，量小，直接存 JSON。 */
  rest: string;
}

const MAX_DEPTH = 50;

export function takeSnapshot(info: MapInfo): Snapshot {
  const height = info.Grid.length;
  const width = info.Grid[0].length;
  const grid = new Int8Array(width * height);
  for (let row = 0; row < height; row++) {
    const line = info.Grid[row];
    for (let col = 0; col < width; col++) {
      grid[row * width + col] = line[col] as number;
    }
  }
  return {
    width,
    height,
    grid,
    rest: JSON.stringify({
      Loop: info.Loop,
      BasesPosition: info.BasesPosition,
      LighthousesPosition: info.LighthousesPosition,
      Tips: info.Tips,
    }),
  };
}

export function applySnapshot(info: MapInfo, snap: Snapshot): void {
  const { width, height, grid } = snap;
  const next: number[][] = new Array(height);
  for (let row = 0; row < height; row++) {
    const line = new Array<number>(width);
    for (let col = 0; col < width; col++) {
      line[col] = grid[row * width + col];
    }
    next[row] = line;
  }
  info.Grid = next;
  const rest = JSON.parse(snap.rest) as Pick<
    MapInfo,
    'Loop' | 'BasesPosition' | 'LighthousesPosition' | 'Tips'
  >;
  info.Loop = rest.Loop;
  info.BasesPosition = rest.BasesPosition;
  info.LighthousesPosition = rest.LighthousesPosition;
  info.Tips = rest.Tips;
}

export class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 在一次改动**之前**调用，记下改动前的状态。 */
  push(info: MapInfo): void {
    this.undoStack.push(takeSnapshot(info));
    if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(info: MapInfo): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoStack.push(takeSnapshot(info));
    applySnapshot(info, snap);
    return true;
  }

  redo(info: MapInfo): boolean {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    this.undoStack.push(takeSnapshot(info));
    applySnapshot(info, snap);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
