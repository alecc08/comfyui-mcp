import type { WorkflowLoader } from '../workflows/workflow-loader.js';

export interface ListWorkflowsOutput {
  workflows: Array<{ name: string; is_default: boolean }>;
  default_workflow: string;
  total_count: number;
}

export async function listWorkflows(workflowLoader: WorkflowLoader): Promise<ListWorkflowsOutput> {
  try {
    const names = await workflowLoader.listWorkflows();
    const defaultWorkflow = workflowLoader.getDefaultWorkflow();

    return {
      workflows: names.map((name) => ({ name, is_default: name === defaultWorkflow })),
      default_workflow: defaultWorkflow,
      total_count: names.length,
    };
  } catch (error) {
    throw new Error(`Failed to list workflows: ${(error as Error).message}`);
  }
}
