import { promises as fs } from 'fs';
import path from 'path';

export interface CachedImage {
  filePath: string;
  mimeType: string;
}

export class ImageCache {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  /**
   * Initialize cache directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create cache directory: ${(error as Error).message}`);
    }
  }

  /**
   * Get cache file path for an image
   */
  getCachePath(promptId: string, filename: string): string {
    const promptDir = path.join(this.cacheDir, promptId);
    return path.join(promptDir, filename);
  }

  /**
   * Check if image exists in cache
   */
  async has(promptId: string, filename: string): Promise<boolean> {
    const filePath = this.getCachePath(promptId, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save image to cache
   */
  async set(promptId: string, filename: string, imageBuffer: Buffer, mimeType: string): Promise<string> {
    const promptDir = path.join(this.cacheDir, promptId);
    await fs.mkdir(promptDir, { recursive: true });

    const filePath = this.getCachePath(promptId, filename);
    await fs.writeFile(filePath, imageBuffer);

    return filePath;
  }

  /**
   * Get image from cache
   */
  async get(promptId: string, filename: string): Promise<Buffer> {
    const filePath = this.getCachePath(promptId, filename);
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new Error(`Failed to read cached image: ${(error as Error).message}`);
    }
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      await this.initialize();
    } catch (error) {
      throw new Error(`Failed to clear cache: ${(error as Error).message}`);
    }
  }

  /**
   * Clear cache for specific prompt
   */
  async clearPrompt(promptId: string): Promise<void> {
    const promptDir = path.join(this.cacheDir, promptId);
    try {
      await fs.rm(promptDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Failed to clear prompt cache: ${(error as Error).message}`);
      }
    }
  }
}
