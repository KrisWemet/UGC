import { put } from "@vercel/blob";
import { uploadFile } from "./kie";

export type StoredFile = { url: string; expires: boolean };

// Finished videos go to Vercel Blob when configured; otherwise to kie.ai file
// storage, which deletes files after 24 hours.
export async function storeVideo(data: Buffer, name: string): Promise<StoredFile> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`videos/${name}`, data, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: true,
    });
    return { url: blob.url, expires: false };
  }
  return { url: await uploadFile(data, name, "video/mp4"), expires: true };
}
