import { z } from 'zod';

/**
 * Schema for generate_image input
 */
export const GenerateImageInputSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(10000, 'Prompt too long'),
  negative_prompt: z.string().max(10000, 'Negative prompt too long').optional(),
  width: z.number().int().positive().optional().default(512),
  height: z.number().int().positive().optional().default(512),
  workflow_name: z.string().optional(),
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
 * Schema for modify_image input (img2img)
 */
export const ModifyImageInputSchema = z.object({
  image_path: z.string().min(1, 'Image path cannot be empty'),
  prompt: z.string().min(1, 'Prompt cannot be empty').max(10000, 'Prompt too long'),
  negative_prompt: z.string().max(10000, 'Negative prompt too long').optional(),
  denoise_strength: z.number().min(0.0).max(1.0).optional().default(0.75),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  workflow_name: z.string().optional().default('img2img_workflow.json'),
});

export type ModifyImageInput = z.infer<typeof ModifyImageInputSchema>;

/**
 * Schema for resize_image input
 */
export const ResizeImageInputSchema = z.object({
  image_path: z.string().min(1, 'Image path cannot be empty'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  workflow_name: z.string().optional(),
});

export type ResizeImageInput = z.infer<typeof ResizeImageInputSchema>;

/**
 * Schema for remove_background input
 */
export const RemoveBackgroundInputSchema = z.object({
  image_path: z.string().min(1, 'Image path cannot be empty'),
  workflow_name: z.string().optional().default('remove_background_workflow.json'),
});

export type RemoveBackgroundInput = z.infer<typeof RemoveBackgroundInputSchema>;

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
