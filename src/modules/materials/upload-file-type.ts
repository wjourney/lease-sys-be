import { fail } from "../../common/utils/errors";

export function uploadFileType(file: Express.Multer.File, category: string) {
  if (!file || file.size > 30 * 1024 * 1024) fail("请选择小于 30MB 的文件");
  const b = file.buffer;
  const detected = b.subarray(0, 4).toString() === "%PDF" ? "application/pdf"
    : b[0] === 0x89 && b.subarray(1, 4).toString() === "PNG" ? "image/png"
    : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
    : b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" ? "image/webp"
    : b.subarray(4, 8).toString() === "ftyp" ? "video/mp4" : null;
  if (!detected) return fail("支持 PDF、PNG、JPEG、WebP 和 MP4");
  if (["LOGO", "PHOTO"].includes(category) && !detected.startsWith("image/")) fail("图片仅支持图片文件");
  if (category === "VIDEO" && detected !== "video/mp4") fail("视频仅支持 MP4 文件");
  if (category === "PROJECT_FILE" && detected === "video/mp4") fail("文件不支持视频，请上传至视频栏目");
  return detected;
}
