/**
 * Tool definitions and schemas for the AI Orchestrator.
 * The AI LLM interacts with the deterministic backend strictly through these structured tools.
 */

export interface LogExpenseParams {
  budgetCycleId: string;
  category: 'groceries' | 'takeaway' | 'restaurant' | 'convenience';
  amountPence: number;
  slotId?: string;
  vendorName?: string;
  description: string;
}

export interface RequestReplanParams {
  budgetCycleId: string;
  deficitPence: number;
  lockedSlotIds?: string[];
  preserveChannels?: string[];
}

export interface ApplyReplanParams {
  budgetCycleId: string;
  strategyCode: string;
  updatedSlotIds: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export const AGENT_TOOLS: Record<string, ToolDefinition> = {
  propose_expense_log: {
    name: 'propose_expense_log',
    description: 'Records an actual expense in the deterministic financial ledger and checks variance against the planned slot.',
    parameters: {
      type: 'object',
      properties: {
        budgetCycleId: { type: 'string', description: 'ID of current active budget cycle' },
        category: { type: 'string', enum: ['groceries', 'takeaway', 'restaurant', 'convenience'] },
        amountPence: { type: 'integer', description: 'Amount in minor units (pence)' },
        slotId: { type: 'string', description: 'Target planned meal slot ID if associated with a scheduled meal' },
        vendorName: { type: 'string', description: 'Name of store or restaurant' },
        description: { type: 'string', description: 'Description of purchase' }
      },
      required: ['budgetCycleId', 'category', 'amountPence', 'description']
    }
  },

  request_replanning: {
    name: 'request_replanning',
    description: 'Invokes the deterministic optimization solver to generate rebalanced meal plan options within the remaining budget.',
    parameters: {
      type: 'object',
      properties: {
        budgetCycleId: { type: 'string' },
        deficitPence: { type: 'integer', description: 'Overspend amount to recover in pence' },
        lockedSlotIds: { type: 'array', items: { type: 'string' }, description: 'Slots user refuses to alter' }
      },
      required: ['budgetCycleId']
    }
  },

  get_budget_state: {
    name: 'get_budget_state',
    description: 'Returns the verified deterministic financial figures (actual spent, remaining cash, projected variance) directly from the ledger.',
    parameters: {
      type: 'object',
      properties: {
        budgetCycleId: { type: 'string' }
      },
      required: ['budgetCycleId']
    }
  }
};
