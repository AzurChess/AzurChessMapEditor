/**
 * `.azurchessmap` 的数据模型。
 *
 * 字段名与大小写必须与客户端 `Assets/Scripts/LocalDataPacks/MapInfo.cs`
 * 及 `TipDataPack.cs` 逐字一致 —— 客户端用 Newtonsoft 直接反序列化，
 * 改名即破坏兼容。
 */

/** 客户端 `Vector2ForSerializer`。 */
export interface Vec2 {
  X: number;
  Y: number;
}

/** 客户端 `ColorForJSON`，各分量 0..1。 */
export interface ColorJson {
  R: number;
  G: number;
  B: number;
  A: number;
}

/** 客户端 `TipDataPack`：地图上的地名标注。 */
export interface TipData {
  TextSize: number;
  Color: ColorJson;
  Content: string;
  Position: Vec2;
}

/**
 * 客户端 `MapInfo`。
 *
 * `Grid` 外层为行、内层为列，行序**由南向北**（`Grid[0]` 是最南一行）。
 * 取值是客户端 `MapLoader.tileList` 的下标：0 = 无 tile（可航行），
 * 1 = `Hexagonal Collide Rule Tile`（障碍）。客户端声明为 `List<List<short>>`，
 * 因此必须写成 0/1 而不是 false/true。
 */
export interface MapInfo {
  Grid: number[][];
  Loop: boolean;
  BasesPosition: Record<string, Vec2>;
  LighthousesPosition: Record<string, Vec2>;
  Tips: TipData[];
}

/**
 * 旧版 ACME 编辑器写入的字段，客户端 `MapInfo` 未声明、反序列化时静默忽略。
 * 读取时容忍，写出时丢弃。
 */
export interface LegacyMapInfoFields {
  ImageSize?: Vec2;
  ImageTextureFormat?: number;
}

/** 一个完整的地图文件：结构化信息 + 原样透传的底图字节。 */
export interface MapFile {
  info: MapInfo;
  /** `map.png` 的原始字节。编辑器不重新编码，原样带进带出。 */
  image: Uint8Array;
}

/** 客户端 `GameInitialData.allBasesDefaultFleet` 中的合法基地 key。 */
export const VALID_BASE_NAMES = [
  'America',
  'Japan',
  'China',
  'Germany',
  'Italy',
  'France',
  'England',
  'Russia',
  'META',
] as const;
