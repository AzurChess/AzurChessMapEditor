/**
 * 从底图自动生成障碍掩膜。
 *
 * 做法：在每个格子的外接盒内均匀采 7×7 个点，统计"不透明"像素的占比，
 * 超过阈值即判为陆地（障碍）。
 *
 * 阈值不是拍脑袋定的 —— 拿现网 `global` 的底图与它手工绘制的 Grid 做过比对：
 *   · 只采格心一个点：一致率 79.1%
 *   · 覆盖率法，阈值 0.23：一致率 96.1%
 * 所以默认取 0.25。剩下约 4% 需要人工修 —— 多是小到放不下一格的岛屿，
 * 以及作者手工判断的海岸线。**这是起点，不是终稿。**
 */
import {
  CELL_HEIGHT,
  CELL_WIDTH,
  ROW_STEP,
  cellToWorld,
  centerOffset,
  imageWorldSize,
  isOddRow,
} from '../format/hex.ts';

export interface MaskOptions {
  /** alpha 大于等于此值算作不透明。 */
  alphaThreshold: number;
  /** 格内不透明占比超过此值判为障碍。 */
  coverage: number;
  /** 每格每个方向的采样点数。 */
  samples: number;
  /** 落在底图之外的格子怎么算。现网 global 的南北极边界行就是这么来的。 */
  outsideValue: 0 | 1;
}

export const DEFAULT_MASK_OPTIONS: MaskOptions = {
  alphaThreshold: 8,
  coverage: 0.25,
  samples: 7,
  outsideValue: 1,
};

/**
 * @param pixels 底图的 RGBA 数据（可以是降采样后的预览，采样只看覆盖率，够用）
 * @param imageWorldWidth 底图在世界空间中的宽度，即客户端的 `floor(px / 100)`
 */
export function generateMask(
  pixels: ImageData,
  imageWorldWidth: number,
  imageWorldHeight: number,
  width: number,
  height: number,
  options: MaskOptions = DEFAULT_MASK_OPTIONS,
): number[][] {
  const { data, width: pw, height: ph } = pixels;
  const { alphaThreshold, coverage, samples, outsideValue } = options;
  const wo = centerOffset(width);
  const ho = centerOffset(height);

  const offsets: Array<[number, number]> = [];
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      offsets.push([sx / (samples - 1) - 0.5, sy / (samples - 1) - 0.5]);
    }
  }

  const grid: number[][] = new Array(height);
  for (let row = 0; row < height; row++) {
    const line = new Array<number>(width).fill(outsideValue);
    for (let col = 0; col < width; col++) {
      const center = cellToWorld(col - wo, row - ho);
      let hits = 0;
      let total = 0;
      for (const [ox, oy] of offsets) {
        const x = center.x + ox * CELL_WIDTH;
        const y = center.y + oy * CELL_HEIGHT;
        const u = ((x + imageWorldWidth / 2) / imageWorldWidth) * pw;
        const v = ((imageWorldHeight / 2 - y) / imageWorldHeight) * ph;
        if (u < 0 || u >= pw || v < 0 || v >= ph) continue;
        total++;
        if (data[(((v | 0) * pw + (u | 0)) << 2) + 3] >= alphaThreshold) hits++;
      }
      // 整格都在底图之外时保留 outsideValue
      if (total > 0) line[col] = hits / total >= coverage ? 1 : 0;
    }
    grid[row] = line;
  }
  return grid;
}

/** 由底图像素尺寸推一个合适的默认网格尺寸。 */
export function suggestGridSize(
  imageWidth: number,
  imageHeight: number,
): { width: number; height: number } {
  const { worldWidth, worldHeight } = imageWorldSize(imageWidth, imageHeight);
  return {
    width: Math.max(1, worldWidth),
    height: Math.max(1, Math.round(worldHeight / ROW_STEP)),
  };
}

export { imageWorldSize, isOddRow };
