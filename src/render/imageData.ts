/** 从已解码的位图取出像素，供掩膜生成使用。仅在浏览器可用。 */
export function bitmapToImageData(bitmap: ImageBitmap): ImageData {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), {
          width: bitmap.width,
          height: bitmap.height,
        });
  const ctx = (canvas as OffscreenCanvas).getContext('2d', { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('无法创建 2D context');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}
