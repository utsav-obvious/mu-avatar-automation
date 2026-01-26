import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

export async function getFFmpeg() {
    if (ffmpeg) return ffmpeg;

    ffmpeg = new FFmpeg();

    // You can add progress listeners here if needed
    // ffmpeg.on('log', ({ message }) => console.log(message));

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    return ffmpeg;
}

export async function stitchAudioFiles(
    audioSources: (string | Uint8Array | File | Blob)[],
    outputName: string = "stitched_audio.mp3"
): Promise<string> {
    const ffmpeg = await getFFmpeg();

    const inputFiles: string[] = [];

    for (let i = 0; i < audioSources.length; i++) {
        const fileName = `input${i}.mp3`;
        const source = audioSources[i];

        // fetchFile expects string, File, or Blob. Wrap Uint8Array in a Blob.
        const data = await fetchFile(source instanceof Uint8Array ? new Blob([source as any]) : source);

        await ffmpeg.writeFile(fileName, data);
        inputFiles.push(fileName);
    }

    // Use the concat protocol for MP3 files
    // ffmpeg -i "concat:input0.mp3|input1.mp3" -acodec copy output.mp3
    const concatString = `concat:${inputFiles.join("|")}`;

    await ffmpeg.exec([
        "-i", concatString,
        "-acodec", "copy",
        outputName
    ]);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data as any], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
}

export async function spliceAudio(
    originalAudio: string | Blob | File,
    patchAudio: string | Blob | File,
    startTime: number,
    endTime: number,
    outputName: string = "patched_audio.mp3"
): Promise<string> {
    const ffmpeg = await getFFmpeg();

    const originalData = await fetchFile(originalAudio);
    const patchData = await fetchFile(patchAudio);

    await ffmpeg.writeFile("original.mp3", originalData);
    await ffmpeg.writeFile("patch.mp3", patchData);

    const parts: string[] = [];

    // Cut part 1: 0 to startTime (only if startTime > 0.05s)
    if (startTime > 0.05) {
        await ffmpeg.exec(["-y", "-i", "original.mp3", "-t", startTime.toString(), "-c", "copy", "part1.mp3"]);
        parts.push("part1.mp3");
    }

    // patch.mp3 is always included
    parts.push("patch.mp3");

    // Cut part 3: endTime to end
    // We attempt to cut. If startTime is too close to end, it might fail or be empty.
    try {
        await ffmpeg.exec(["-y", "-i", "original.mp3", "-ss", endTime.toString(), "-c", "copy", "part3.mp3"]);
        parts.push("part3.mp3");
    } catch (e) {
        console.warn("Trailing part split failed or was empty:", e);
    }

    // Concat parts
    const concatString = `concat:${parts.join("|")}`;
    await ffmpeg.exec(["-y", "-i", concatString, "-acodec", "copy", outputName]);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data as any], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
}
