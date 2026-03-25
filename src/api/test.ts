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
    aspectRatioStr = "portait";
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

// console.log(await getVideoAspectRatio("samples/boots-video-vertical.mp4"));
console.log(await processVideoForFastStart("samples/boots-video-vertical.mp4"));
