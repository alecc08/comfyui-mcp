import type { HistoryEntry, ImageData, ImageMetadata } from './types.js';
import type { ImageServer } from '../http/image-server.js';
import { validateFilename } from '../utils/validation.js';

export type CompletionState =
  | { kind: 'executing' }
  | { kind: 'error'; errorMessage: string }
  | { kind: 'completed'; images: ImageData[] };

export function extractErrorMessage(entry: HistoryEntry): string {
  let errorMessage = 'Image generation failed';
  if (entry.status.messages && Array.isArray(entry.status.messages)) {
    const errorMessages = entry.status.messages
      .map((msg: any) => {
        if (typeof msg === 'string') return msg;
        if (msg && typeof msg === 'object') return JSON.stringify(msg);
        return String(msg);
      })
      .filter(Boolean);
    if (errorMessages.length > 0) {
      errorMessage = errorMessages.join('; ');
    }
  }
  return errorMessage;
}

export function extractImages(
  entry: HistoryEntry,
  promptId: string,
  imageServer: ImageServer,
): ImageData[] {
  const images: ImageData[] = [];
  for (const output of Object.values(entry.outputs)) {
    if (output.images && Array.isArray(output.images)) {
      for (const imageMetadata of output.images as ImageMetadata[]) {
        if (!validateFilename(imageMetadata.filename)) {
          console.error(`Invalid filename: ${imageMetadata.filename}`);
          continue;
        }
        const imageUrl = imageServer.buildImageUrl(promptId, imageMetadata);
        images.push({
          filename: imageMetadata.filename,
          subfolder: imageMetadata.subfolder,
          type: imageMetadata.type,
          url: imageUrl,
        });
      }
    }
  }
  return images;
}

export function classifyHistoryEntry(
  entry: HistoryEntry,
  promptId: string,
  imageServer: ImageServer,
): CompletionState {
  if (entry.status.status_str === 'error') {
    return { kind: 'error', errorMessage: extractErrorMessage(entry) };
  }
  if (!entry.status.completed) {
    return { kind: 'executing' };
  }
  const images = extractImages(entry, promptId, imageServer);
  return { kind: 'completed', images };
}
