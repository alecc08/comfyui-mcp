import { z } from 'zod';
import type { WorkflowLoader } from '../workflows/workflow-loader.js';

export const listWorkflowsSchema = z.object({});

export async function listWorkflows(workflowLoader: WorkflowLoader): Promise<string> {
  try {
    const workflows = await workflowLoader.listWorkflows();
    const defaultWorkflow = workflowLoader.getDefaultWorkflow();
    const workspaceDir = workflowLoader.getWorkspaceDir();

    if (workflows.length === 0) {
      return `No workflow files found in ${workspaceDir}`;
    }

    const workflowList = workflows
      .map(name => {
        const isDefault = name === defaultWorkflow;
        return `- ${name}${isDefault ? ' (default)' : ''}`;
      })
      .join('\n');

    return `Available workflows in ${workspaceDir}:\n\n${workflowList}\n\nDefault workflow: ${defaultWorkflow}`;
  } catch (error) {
    throw new Error(`Failed to list workflows: ${(error as Error).message}`);
  }
}
