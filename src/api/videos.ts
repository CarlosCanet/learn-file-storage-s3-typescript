import path from "node:path";
import { randomBytes } from "node:crypto";

import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import {
  BadRequestError,
  NotFoundError,
  UserForbiddenError,
} from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import type { Path } from "typescript";
import { uploadVideoToS3 } from "./s3";
import { rm } from "node:fs/promises";

const MAX_UPLOAD_VIDEO_SIZE = 1 << 30;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find the video!");
  }
  if (video?.userID !== userID) {
    throw new UserForbiddenError("That video is not yours!");
  }

  const data = await req.formData();
  const videoFile = data.get("video");
  if (!(videoFile instanceof File)) {
    throw new BadRequestError("The file is not a file");
  }
  if (videoFile.size > MAX_UPLOAD_VIDEO_SIZE) {
    throw new BadRequestError("File too big");
  }
  if (videoFile.type !== "video/mp4") {
    throw new BadRequestError("Incorrect file type");
  }

  const fileName = randomBytes(32).toString("base64url");
  const fileExtension = "mp4";
  const fileNameWithExtension = `${fileName}.${fileExtension}`;
  const tempFilePath = path.join(cfg.assetsRoot, fileNameWithExtension);

  await Bun.write(tempFilePath, videoFile);
  const aspectRatio = await getVideoAspectRatio(tempFilePath);
  const tempProcessFilePath = await processVideoForFastStart(tempFilePath);

  const s3Key = `${aspectRatio}/${fileNameWithExtension}`;
  uploadVideoToS3(cfg, s3Key, tempProcessFilePath, "video/mp4");

  const videoURL = `http://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
  video.videoURL = videoURL;
  updateVideo(cfg.db, video);

  await Promise.all([
    rm(tempFilePath, { force: true }),
    rm(tempProcessFilePath, { force: true }),
  ]);

  return respondWithJSON(200, videoFile);
}

async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      stderr: "pipe",
      stdout: "pipe",
    },
  );

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  const result = await proc.exited;
  if (result !== 0) {
    throw new Error("Error processing ffmpeg");
  }

  const stdoutJSON = JSON.parse(stdoutText);
  if (!stdoutJSON.streams || stdoutJSON.streams.length === 0) {
    throw new Error("No video streams found");
  }

  const { width, height } = stdoutJSON.streams[0];

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
  const outputFilePath = inputFilePath + ".processed.mp4";
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      outputFilePath,
    ],
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
