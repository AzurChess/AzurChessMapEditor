/**
 * `.azurchessmap` 容器的读写。
 *
 * 客户端 `MapScripts/Loaders/MapLoader.cs` + `FileUtils.ReadZipFile` 要求：
 * 一个 ZIP，内含名字**正好**为 `info.json` 与 `map.png` 的两个条目，
 * 其它命名会抛 `FileNotFoundException`。
 *
 * 注意：这不是旧 ACME 编辑器的格式（那是 `"AzurChessMapV0.1"` 魔数
 * 加两个 int32 长度前缀的自定义二进制），本工程只支持客户端格式。
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { LegacyMapInfoFields, MapFile, MapInfo } from './types.ts';

export const ENTRY_INFO = 'info.json';
export const ENTRY_IMAGE = 'map.png';

export class MapFormatError extends Error {}

/** 解析 `.azurchessmap` 字节流。 */
export function parseMapFile(bytes: Uint8Array): MapFile {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new MapFormatError(
      `不是有效的 ZIP：${(e as Error).message}。旧版 ACME 编辑器的自定义二进制格式不受支持。`,
    );
  }

  const infoBytes = entries[ENTRY_INFO];
  if (!infoBytes) {
    throw new MapFormatError(
      `压缩包内缺少 ${ENTRY_INFO}（实际条目：${Object.keys(entries).join('、') || '无'}）`,
    );
  }
  const imageBytes = entries[ENTRY_IMAGE];
  if (!imageBytes) {
    throw new MapFormatError(
      `压缩包内缺少 ${ENTRY_IMAGE}（实际条目：${Object.keys(entries).join('、')}）`,
    );
  }

  return { info: normalizeInfo(JSON.parse(strFromU8(infoBytes))), image: imageBytes };
}

/**
 * 校验并归一化反序列化结果。
 *
 * 丢弃 `ImageSize` / `ImageTextureFormat` —— 这两个是 ACME 的 raw-texture
 * 管线遗留字段，客户端 `MapInfo` 未声明，写回去只是噪音。
 */
function normalizeInfo(raw: unknown): MapInfo {
  if (raw === null || typeof raw !== 'object') {
    throw new MapFormatError('info.json 的顶层不是对象');
  }
  const o = raw as Partial<MapInfo> & LegacyMapInfoFields;

  if (!Array.isArray(o.Grid) || o.Grid.length === 0) {
    throw new MapFormatError('info.json 缺少非空的 Grid');
  }
  const width = o.Grid[0].length;
  for (let row = 0; row < o.Grid.length; row++) {
    const line = o.Grid[row];
    if (!Array.isArray(line)) {
      throw new MapFormatError(`Grid 第 ${row} 行不是数组`);
    }
    if (line.length !== width) {
      throw new MapFormatError(
        `Grid 第 ${row} 行长度为 ${line.length}，与第 0 行的 ${width} 不一致`,
      );
    }
    for (let col = 0; col < line.length; col++) {
      const v = line[col];
      // 客户端 Grid 是 List<List<short>>，取值是 tileList 的下标。
      // 旧 ACME 写的是 List<List<bool>>，这里顺手接住 true/false。
      if (typeof v === 'boolean') {
        line[col] = v ? 1 : 0;
      } else if (v !== 0 && v !== 1) {
        throw new MapFormatError(`Grid[${row}][${col}] = ${JSON.stringify(v)}，只允许 0 或 1`);
      }
    }
  }

  return {
    Grid: o.Grid as number[][],
    Loop: Boolean(o.Loop),
    BasesPosition: o.BasesPosition ?? {},
    LighthousesPosition: o.LighthousesPosition ?? {},
    Tips: o.Tips ?? [],
  };
}

/**
 * 打包成 `.azurchessmap` 字节流。
 *
 * 用 Deflate（与现网两张地图的 method 8 一致）但压缩等级取 1：
 * `operation` 的 86MB 底图在默认等级下要花几十秒，而实测只压掉 0.13%。
 */
export function serializeMapFile(file: MapFile, level: 0 | 1 = 1): Uint8Array {
  const json = JSON.stringify(toWireInfo(file.info));
  return zipSync(
    {
      [ENTRY_INFO]: strToU8(json),
      [ENTRY_IMAGE]: file.image,
    },
    { level },
  );
}

/** 按客户端 `MapInfo` 的字段顺序输出，且只输出它声明过的字段。 */
function toWireInfo(info: MapInfo): MapInfo {
  return {
    Grid: info.Grid,
    Loop: info.Loop,
    BasesPosition: info.BasesPosition,
    LighthousesPosition: info.LighthousesPosition,
    Tips: info.Tips,
  };
}

/** 地图的格子尺寸。 */
export function gridSize(info: MapInfo): { width: number; height: number } {
  return { width: info.Grid[0].length, height: info.Grid.length };
}

/** 建一张全部可航行的空地图。 */
export function createEmptyMap(width: number, height: number, image: Uint8Array): MapFile {
  return {
    info: {
      Grid: Array.from({ length: height }, () => new Array<number>(width).fill(0)),
      Loop: false,
      BasesPosition: {},
      LighthousesPosition: {},
      Tips: [],
    },
    image,
  };
}
