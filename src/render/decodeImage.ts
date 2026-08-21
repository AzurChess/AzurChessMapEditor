/**
 * 底图解码。
 *
 * `operation` 的底图是 13703×9000 = 1.23 亿像素，整幅解码成 RGBA 是 ~493MB，
 * 足以让标签页 OOM。`createImageBitmap` 的 resize 选项能在**解码阶段**就降采样，
 * 从不物化全尺寸位图。
 *
 * 降采样只影响显示；写出时用的始终是 `MapFile.image` 里的原始字节。
 */

/** 预览位图的最长边上限（像素）。 */
export const MAX_PREVIEW_EDGE = 4096;

export interface DecodedImage {
  bitmap: ImageBitmap;
  /** 原图的真实像素尺寸 —— 世界尺寸换算要用它，而不是预览尺寸。 */
  width: number;
  height: number;
  downscaled: boolean;
}

export async function decodePreview(pngBytes: Uint8Array): Promise<DecodedImage> {
  const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });

  // 先只读尺寸：这一步 createImageBitmap 仍会解码，故直接带上 resize 参数，
  // 用 PNG 头里的尺寸来决定缩放比例。
  const { width, height } = readPngSize(pngBytes);
  const longest = Math.max(width, height);
  const ratio = longest > MAX_PREVIEW_EDGE ? MAX_PREVIEW_EDGE / longest : 1;

  const bitmap =
    ratio < 1
      ? await createImageBitmap(blob, {
          resizeWidth: Math.max(1, Math.round(width * ratio)),
          resizeHeight: Math.max(1, Math.round(height * ratio)),
          resizeQuality: 'high',
        })
      : await createImageBitmap(blob);

  return { bitmap, width, height, downscaled: ratio < 1 };
}

/** 从 PNG 的 IHDR 直接读尺寸，不解码像素。 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) throw new Error('不是 PNG 文件');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
