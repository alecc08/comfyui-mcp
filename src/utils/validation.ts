import { z } from 'zod';

/**
 * Schema for generate_image input
 */
export const GenerateImageInputSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(10000, 'Prompt too long'),
  negative_prompt: z.string().max(10000, 'Negative prompt too long').optional(),
  width: z.number().int().positive().optional().default(512),
  height: z.number().int().positive().optional().default(512),
  workflow_path: z.string().optional(),
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
