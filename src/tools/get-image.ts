import type { ComfyUIClient } from '../comfyui/client.js';
import type { ImageData } from '../comfyui/types.js';
import { GetImageInputSchema, validateFilename } from '../utils/validation.js';

export interface GetImageOutput {
  status: 'completed' | 'executing' | 'pending' | 'not_found';
  images?: ImageData[];
  error?: string;
}

export async function getImage(input: unknown, client: ComfyUIClient): Promise<GetImageOutput> {
  // Validate input
  const validatedInput = GetImageInputSchema.parse(input);
  const promptId = validatedInput.prompt_id;

  try {
    // Fetch history for this prompt
    const history = await client.getHistory(promptId);

    // Check if prompt exists
    if (!history[promptId]) {
      return {
        status: 'not_found',
        error: `Prompt ID ${promptId} not found`,
      };
    }

    const entry = history[promptId];

    // Check completion status
    if (!entry.status.completed) {
      return {
        status: 'executing',
      };
    }

    // Extract images from outputs
    const images: ImageData[] = [];

    for (const [nodeId, output] of Object.entries(entry.outputs)) {
      if (output.images && Array.isArray(output.images)) {
        for (const imageMetadata of output.images) {
          // Validate filename to prevent path traversal
          if (!validateFilename(imageMetadata.filename)) {
            console.error(`Invalid filename: ${imageMetadata.filename}`);
            continue;
          }

          try {
            // Fetch the actual image data
            const imageBuffer = await client.getImage(
              imageMetadata.filename,
              imageMetadata.subfolder,
              imageMetadata.type,
            );

            // Convert to base64
            const base64Data = imageBuffer.toString('base64');

            images.push({
              filename: imageMetadata.filename,
              subfolder: imageMetadata.subfolder,
              type: imageMetadata.type,
              data: base64Data,
            });
          } catch (error) {
            console.error(`Failed to fetch image ${imageMetadata.filename}:`, error);
            // Continue with other images
          }
        }
      }
    }

    if (images.length === 0) {
      return {
        status: 'completed',
        error: 'No images found in output',
      };
    }

    return {
      status: 'completed',
      images,
    };
  } catch (error) {
    return {
      status: 'not_found',
      error: (error as Error).message,
    };
  }
}
