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
        const data = await fetchFile(source instanceof Uint8Array ? new Blob([source]) : source);

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
    const blob = new Blob([data], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
}
