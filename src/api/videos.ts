import path from "node:path";
import { randomBytes } from "node:crypto";

import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import type { Path } from "typescript";

const MAX_UPLOAD_VIDEO_SIZE = 1 << 30;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videoMetadata = getVideo(cfg.db, videoId);
  if (videoMetadata?.userID !== userID) {
    throw new UserForbiddenError("That video is not yours!");
  }

  const data = await req.formData();
  const video = data.get("video");
  if (!(video instanceof File)) {
    throw new BadRequestError("The file is not a file");
  }
  if (video.size > MAX_UPLOAD_VIDEO_SIZE) {
    throw new BadRequestError("File too big");
  }
  if (video.type !== "video/mp4") {
    throw new BadRequestError("Incorrect file type");
  }

  const fileName = randomBytes(32).toString("base64url");
  const fileExtension = "mp4";
  const fileNameWithExtension = `${fileName}.${fileExtension}`;
  const pathToImage = path.join(cfg.assetsRoot, fileNameWithExtension);

  await Bun.write(pathToImage, video);
  const aspectRatio = await getVideoAspectRatio(pathToImage);
  const s3Key = `${aspectRatio}/${fileNameWithExtension}`;

  const file = await S3Client.file(s3Key, {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    type: video.type,
  });

  await file.write(Bun.file(pathToImage));
  console.log("aspectRatio", aspectRatio);

  const videoURL = `http://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
  videoMetadata.videoURL = videoURL;
  updateVideo(cfg.db, videoMetadata);
  return respondWithJSON(200, videoMetadata);
}

async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  const result = await proc.exited;
  if (result !== 0) {
    throw new Error("Error processing ffmpeg");
  }
  const stdoutJSON = JSON.parse(stdoutText);
  const width = stdoutJSON.streams[0].width;
  const height = stdoutJSON.streams[0].height;
  const aspectRatio = Math.floor(width / height);
  let aspectRatioStr = "other";
  if (aspectRatio === Math.floor(16 / 9)) {
    aspectRatioStr = "landscape";
  } else if (aspectRatio === Math.floor(9 / 16)) {
    aspectRatioStr = "portrait";
  }
  return aspectRatioStr;
}

async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath + ".processed";
  const proc = Bun.spawn(
    ["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputFilePath],
    { stderr: "pipe", stdout: "pipe" },
  );
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  const result = await proc.exited;
  if (result !== 0) {
    throw new Error("Error processing ffmpeg");
  }

  return outputFilePath;
}
