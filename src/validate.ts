/** 地图校验。规则来自客户端的实际行为，不是凭空定的约定。 */
import { cellToGridIndex } from './edit/operations.ts';
import { gridSize } from './format/mapfile.ts';
import {
  PIXELS_PER_UNIT,
  cellToWorld,
  imageWorldSize,
  mapWorldSize,
  worldToCell,
} from './format/hex.ts';
import { VALID_BASE_NAMES, type MapInfo } from './format/types.ts';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * 底图与网格的对齐关系。
 *
 * 客户端把底图居中于原点、尺寸取 `floor(px/100)` 世界单位，网格也大致居中，
 * 两者的相对位置**完全**由这两个尺寸决定 —— `MapInfo` 里没有任何偏移或缩放
 * 字段可供调整。所以「对齐」只有两个杠杆：改网格行列数，或改底图像素尺寸。
 */
export interface Alignment {
  /** 底图的世界尺寸（已按客户端的整数除法截断）。 */
  imageWorld: { width: number; height: number };
  /**
   * 网格的**名义**世界尺寸，即客户端 `SetSize` 用的 `列数 × 行数×ROW_STEP`。
   *
   * 刻意不用 `gridWorldBounds` 的真实包围盒：后者把奇数行右移半格造成的锯齿
   * 也算进去，恒定多出 0.5 格，会让一张拼接完美的 Loop 图被报成「窄 0.5 格」。
   * 那个包围盒只适合画对齐框，不适合做读数。
   */
  gridWorld: { width: number; height: number };
  /** 底图相对网格的溢出，单位为格；正数=底图更大，负数=底图更小。 */
  overhang: { x: number; y: number };
  /** Loop 拼接要求的精确底图宽度（像素）。非 Loop 地图为 null。 */
  loopRequiredPx: number | null;
  /** Loop 的左右拼接是否严丝合缝。非 Loop 恒为 true。 */
  loopSeamExact: boolean;
  /** 被 `floor(px/100)` 丢掉的世界单位，通常远小于 1 格。 */
  truncated: { x: number; y: number };
}

export function imageAlignment(
  info: MapInfo,
  imageWidth: number,
  imageHeight: number,
): Alignment {
  const { width, height } = gridSize(info);
  const { worldWidth, worldHeight } = imageWorldSize(imageWidth, imageHeight);
  const grid = mapWorldSize(width, height);

  return {
    imageWorld: { width: worldWidth, height: worldHeight },
    gridWorld: { width: grid.worldWidth, height: grid.worldHeight },
    overhang: {
      x: worldWidth - grid.worldWidth,
      y: worldHeight - grid.worldHeight,
    },
    // 拼接周期是网格列数（见 operations.ts 的 loopShifts），不是包围盒宽度。
    loopRequiredPx: info.Loop ? width * PIXELS_PER_UNIT : null,
    loopSeamExact: !info.Loop || imageWidth === width * PIXELS_PER_UNIT,
    truncated: {
      x: imageWidth / PIXELS_PER_UNIT - worldWidth,
      y: imageHeight / PIXELS_PER_UNIT - worldHeight,
    },
  };
}

export function validate(info: MapInfo, imageWidth?: number): Issue[] {
  const issues: Issue[] = [];
  const { width } = gridSize(info);

  for (const [name, pos] of Object.entries(info.BasesPosition)) {
    if (!(VALID_BASE_NAMES as readonly string[]).includes(name)) {
      // 不禁止 —— ACME 写死八个阵营名，正是它摆不了 META 的原因。
      issues.push({
        level: 'warning',
        message: `基地名「${name}」不在客户端 GameInitialData 的阵营列表里，对局中会取不到数据`,
      });
    }
    const { cx, cy } = worldToCell(pos.X, pos.Y);
    const snapped = cellToWorld(cx, cy);
    // pos.X/Y 若是 NaN，下面两个差值也全是 NaN，而 `NaN > 1e-4` 恒为 false ——
    // 不显式判非有限数的话，最该报警的「坐标本身就是垃圾值」反而会被放过。
    if (
      !Number.isFinite(pos.X) ||
      !Number.isFinite(pos.Y) ||
      Math.abs(snapped.x - pos.X) > 1e-4 ||
      Math.abs(snapped.y - pos.Y) > 1e-4
    ) {
      issues.push({ level: 'warning', message: `基地「${name}」没有落在六边形中心上` });
    }
    // 用 cellToGridIndex 而不是自己再算一遍 —— 它会先走 wrapCellX 把 Loop 地图
    // 拼接缝上的坐标折回本体，手写 row/col 漏了这一步，会把落在缝上的合法基地
    // 误判成「范围之外」。
    const index = cellToGridIndex(cx, cy, info);
    if (!index) {
      issues.push({ level: 'error', message: `基地「${name}」在地图范围之外` });
    } else if (info.Grid[index.row][index.col] !== 0) {
      issues.push({ level: 'error', message: `基地「${name}」落在障碍格上，舰娘将无法出港` });
    }
  }

  // 灯塔 ID 重复本应是 error（客户端 TryAdd，冲突时静默丢灯塔），但
  // LighthousesPosition 是 Record<string, Vec2>：JS 对象键天然唯一，
  // JSON.parse 早在这里之前就把重复键折叠掉了，这份数据结构里已经不可能
  // 出现重复 ID，因此这里没有（也不需要）对应的校验。

  /*
   * 底图对齐只有一条**硬**约束：Loop 地图的底图宽度必须精确等于 列数×100。
   * 客户端会把底图左右各复制一份、间距为网格列数，宽度不等就在拼接缝处
   * 重叠或裂开。现网 global 是 8000px = 80 列 × 100，分毫不差。
   *
   * 其余的尺寸差异一律**不报** —— 底图比网格大一圈或小一圈是正常的美术出血：
   * operation 的底图每侧宽出 4.5 格，global 的底图比网格矮 6.46 格（露出来的
   * 南北极行正是 mask.ts 里 outsideValue=1 的由来）。这些差异属于地图属性，
   * 交给侧栏的 imageAlignment 读数展示，不该占用问题列表。
   */
  if (imageWidth !== undefined && info.Loop && imageWidth !== width * PIXELS_PER_UNIT) {
    const short = width * PIXELS_PER_UNIT - imageWidth;
    issues.push({
      level: 'error',
      message:
        `Loop 地图的底图宽度必须正好是 列数×100 = ${width * PIXELS_PER_UNIT}px，当前 ${imageWidth}px` +
        `（${short > 0 ? `窄 ${short}` : `宽 ${-short}`}px），左右拼接处会${short > 0 ? '裂开' : '重叠'}`,
    });
  }

  return issues;
}
