import type { CallToolResult, TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';

export interface ToolResult extends CallToolResult {
  content: (TextContent | ImageContent)[];
  isError: boolean;
}

export interface ToolExecutor {
  execute(args: any): Promise<ToolResult>;
}

export const createErrorResponse = (
  message: string = 'Unknown error, please try again',
  modalInfo?: any,
  retryInfo?: { attempt: number; maxAttempts: number; nextRetryDelay?: number },
): ToolResult => {
  // If no modal or retry info, return simple text (upstream-compatible)
  if (!modalInfo && !retryInfo) {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }

  const errorData: any = {
    error: true,
    message,
    timestamp: new Date().toISOString(),
  };

  if (modalInfo) {
    errorData.modalDetection = modalInfo;
    if (modalInfo.modals && modalInfo.modals.length > 0) {
      errorData.modalSuggestion =
        'Modal dialog detected. Consider using modalTimeout parameter or handling the modal manually.';
    }
  }

  if (retryInfo) {
    errorData.retryInfo = retryInfo;
    if (retryInfo.attempt < retryInfo.maxAttempts) {
      errorData.retryMessage = `Attempt ${retryInfo.attempt}/${retryInfo.maxAttempts} failed. ${retryInfo.nextRetryDelay ? `Retrying in ${retryInfo.nextRetryDelay}ms...` : 'Retrying...'}`;
    } else {
      errorData.retryMessage = `All ${retryInfo.maxAttempts} retry attempts exhausted.`;
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(errorData, null, 2) }],
    isError: true,
  };
};

/**
 * Create a modal-aware error response with detailed context
 */
export const createModalAwareErrorResponse = (
  message: string,
  modalDetection?: any,
  elementInfo?: any,
  retryAttempt?: number,
  maxRetries?: number,
): ToolResult => {
  const errorData: any = {
    error: true,
    message,
    timestamp: new Date().toISOString(),
  };

  if (elementInfo) {
    errorData.elementInfo = elementInfo;
  }

  if (modalDetection) {
    errorData.modalDetection = modalDetection;

    if (modalDetection.modals && modalDetection.modals.length > 0) {
      const modalTypes = modalDetection.modals.map((m: any) => m.type).join(', ');
      errorData.modalSuggestion =
        `Modal dialog(s) detected (${modalTypes}). Consider:\n` +
        '- Using modalTimeout parameter for longer wait times\n' +
        '- Using retryAttempts parameter for automatic retries\n' +
        '- Handling the modal manually before retrying';

      const modalsWithButtons = modalDetection.modals.filter(
        (m: any) => m.buttons && m.buttons.length > 0,
      );
      if (modalsWithButtons.length > 0) {
        errorData.modalButtons = modalsWithButtons.map((modal: any) => ({
          type: modal.type,
          message: modal.message?.substring(0, 100),
          buttons: modal.buttons.map((btn: any) => ({
            text: btn.text,
            selector: btn.selector,
          })),
        }));
      }
    }
  }

  if (retryAttempt !== undefined && maxRetries !== undefined) {
    errorData.retryInfo = { attempt: retryAttempt, maxAttempts: maxRetries };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(errorData, null, 2) }],
    isError: true,
  };
};
