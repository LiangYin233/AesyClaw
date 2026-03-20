import type { ToolContext } from '../../../tools/ToolRegistry.js';
import type { SessionReference } from '../../legacy-types.js';

export interface HandleDirectMessageInput {
  content: string;
  reference: SessionReference | string;
  suppressOutbound?: boolean;
  toolContextBase: ToolContext;
}
