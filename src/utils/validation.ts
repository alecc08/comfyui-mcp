import { z } from 'zod';

/**
 * Schema for unified generate_image input
 */
export const GenerateImageInputSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(10000, 'Prompt too long').optional(),
  negative_prompt: z.string().max(10000, 'Negative prompt too long').optional(),
  image_path: z.string().min(1, 'Image path cannot be empty').optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  remove_background: z.boolean().optional(),
  wait: z.boolean().optional().default(false),
});

export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

/**
 * Schema for get_image input
 */
export const GetImageInputSchema = z.object({
  prompt_id: z.string().min(1, 'Prompt ID cannot be empty'),
});

export type GetImageInput = z.infer<typeof GetImageInputSchema>;

/**
 * Schema for get_request_history input
 */
export const GetRequestHistoryInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type GetRequestHistoryInput = z.infer<typeof GetRequestHistoryInputSchema>;

/**
 * Sanitize prompt text to prevent potential issues
 */
export function sanitizePrompt(prompt: string): string {
  // Remove control characters except newlines and tabs
  return prompt.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Validate filename to prevent path traversal
 */
export function validateFilename(filename: string): boolean {
  // Must be alphanumeric with dots, dashes, underscores
  // No path separators
  return /^[a-zA-Z0-9._-]+$/.test(filename);
}

/**
 * Validate that a path is absolute (for security)
 */
export function isAbsolutePath(filePath: string): boolean {
  // Windows: C:\path or \\network\path
  // Unix: /path
  return /^([a-zA-Z]:\\|\\\\|\/)/i.test(filePath);
}
