import express, { type Express, type Request, type Response } from 'express';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { ImageMetadata } from '../comfyui/types.js';
import { ImageCache } from './image-cache.js';

export interface ImageServerConfig {
  port: number;
  cacheDir: string;
}

export class ImageServer {
  private app: Express;
  private cache: ImageCache;
  private comfyClient: ComfyUIClient;
  private port: number;
  private server: any;

  constructor(config: ImageServerConfig, comfyClient: ComfyUIClient) {
    this.app = express();
    this.cache = new ImageCache(config.cacheDir);
    this.comfyClient = comfyClient;
    this.port = config.port;
    this.setupRoutes();
  }

  /**
   * Initialize the image server
   */
  async initialize(): Promise<void> {
    await this.cache.initialize();
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok' });
    });

    // Serve image by prompt_id and filename
    this.app.get('/images/:prompt_id/:filename', async (req: Request, res: Response) => {
      const { prompt_id, filename } = req.params;
      const { subfolder = '', type = 'output' } = req.query;

      try {
        // Check if image is in cache
        const isCached = await this.cache.has(prompt_id, filename);

        let imageBuffer: Buffer;
        let mimeType = 'image/png'; // Default MIME type

        if (isCached) {
          // Serve from cache
          imageBuffer = await this.cache.get(prompt_id, filename);
        } else {
          // Fetch from ComfyUI and cache
          imageBuffer = await this.comfyClient.getImage(
            filename,
            subfolder as string,
            type as string
          );

          // Determine MIME type from filename
          mimeType = this.getMimeType(filename);

          // Save to cache
          await this.cache.set(prompt_id, filename, imageBuffer, mimeType);
        }

        // Set appropriate headers
        res.set('Content-Type', mimeType);
        res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        res.send(imageBuffer);
      } catch (error) {
        console.error(`Failed to serve image ${prompt_id}/${filename}:`, error);
        res.status(404).json({
          error: 'Image not found',
          message: (error as Error).message,
        });
      }
    });

    // Clear cache endpoint (optional, for debugging)
    this.app.delete('/cache', async (_req: Request, res: Response) => {
      try {
        await this.cache.clear();
        res.json({ message: 'Cache cleared successfully' });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to clear cache',
          message: (error as Error).message,
        });
      }
    });
  }

  /**
   * Get MIME type from filename extension
   */
  private getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
    };
    return mimeTypes[ext || 'png'] || 'image/png';
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    await this.initialize();
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          console.error(`Image server listening on http://localhost:${this.port}`);
          resolve();
        });

        this.server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            reject(new Error(`Port ${this.port} is already in use`));
          } else {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server.close((error?: Error) => {
          if (error) {
            reject(error);
          } else {
            console.error('Image server stopped');
            resolve();
          }
        });
      });
    }
  }

  /**
   * Get the base URL for the image server
   */
  getBaseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Build image URL for a given prompt_id and image metadata
   */
  buildImageUrl(promptId: string, imageMetadata: ImageMetadata): string {
    const params = new URLSearchParams({
      subfolder: imageMetadata.subfolder,
      type: imageMetadata.type,
    });
    return `${this.getBaseUrl()}/images/${promptId}/${imageMetadata.filename}?${params.toString()}`;
  }
}
