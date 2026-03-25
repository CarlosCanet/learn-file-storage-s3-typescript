const { randomBytes } = require("node:crypto");
const path = require("node:path");
import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import { pathToFileURL, type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

// const videoThumbnails: Map<string, Thumbnail> = new Map();
const MAX_UPLOAD_SIZE = 10 << 20;

// export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
//   const { videoId } = req.params as { videoId?: string };
//   if (!videoId) {
//     throw new BadRequestError("Invalid video ID");
//   }

//   const video = getVideo(cfg.db, videoId);
//   if (!video) {
//     throw new NotFoundError("Couldn't find video");
//   }

//   const thumbnail = videoThumbnails.get(videoId);
//   if (!thumbnail) {
//     throw new NotFoundError("Thumbnail not found");
//   }

//   return new Response(thumbnail.data, {
//     headers: {
//       "Content-Type": thumbnail.mediaType,
//       "Cache-Control": "no-store",
//     },
//   });
// }

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const data = await req.formData();
  const thumbnail = data.get("thumbnail");

  if (!(thumbnail instanceof File)) {
    throw new BadRequestError("The file is not a file");
  }

  if (thumbnail.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File too big");
  }

  const mediaType = thumbnail.type;
  if (mediaType !== "image/jpeg" && mediaType !== "image/png") {
    throw new BadRequestError("Incorrect file type");
  }
  const imageData = await thumbnail.arrayBuffer();
  const imageDataBuffer = Buffer.from(imageData);
  const fileExtension = mediaType.split("/")[1];
  const fileName = randomBytes(32).toString("base64url");
  const pathToImage = path.join(cfg.assetsRoot, `${fileName}.${fileExtension}`);
  Bun.write(pathToImage, imageDataBuffer);

  // const imageBase64 = imageDataBuffer.toString("base64");
  // const dataURL = `data:${mediaType};base64,${imageBase64}`;
  const video = getVideo(cfg.db, videoId);
  if (video?.userID !== userID) {
    throw new UserForbiddenError("That video is not yours!");
  }

  // videoThumbnails.set(videoId, { data: imageData, mediaType });

  const thumbnailURL = `http://localhost:8091/assets/${fileName}.${fileExtension}`;
  video.thumbnailURL = thumbnailURL;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
