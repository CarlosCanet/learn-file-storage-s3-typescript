import type { ApiConfig } from "../config";

export async function uploadVideoToS3(cfg: ApiConfig, key: string, processesFilePath: string, contentType: string) {
  // const file = await S3Client.file(s3Key, {
  //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  //   type: videoFile.type,
  // });
  // await file.write(Bun.file(pathToImage));

  const s3File = cfg.s3Client.file(key, { bucket: cfg.s3Bucket });
  const videoFile = Bun.file(processesFilePath);
  await s3File.write(videoFile, { type: contentType });
}
