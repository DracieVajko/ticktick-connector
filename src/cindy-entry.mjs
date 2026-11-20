import { createClient, describeError, TickTickError } from './core.mjs';
import { callTool } from './tools.mjs';

function cindyTransport(callId) {
  return async ({ url, method, headers, body }) => {
    const response = await cindy.fetch({
      url,
      method,
      headers,
      body,
      callId,
      timeoutMs: 30000,
    });

    const status = Number(response.status || 0);
    if (!status) {
      // No HTTP status means Cindy itself could not complete the call; core
      // has nothing to map, so surface the transport error as-is.
      throw new TickTickError(response.message || 'Cindy could not reach TickTick.', {
        code: response.errorCode || 'TICKTICK_NETWORK',
      });
    }
    if (response.truncated) {
      throw new TickTickError('TickTick returned a response that was too large to read.', {
        code: 'TICKTICK_RESPONSE_TOO_LARGE',
      });
    }

    // Hand the status back to core so 401/404/429/5xx keep the same wording as
    // the MCP server path instead of collapsing into a network error.
    return {
      status,
      text: response.body,
      headers: response.headers,
    };
  };
}

cindy.onHostMessage(async (msg) => {
  if (msg.type !== 'tool-call') return;

  try {
    const client = createClient({ transport: cindyTransport(msg.callId) });
    const result = await callTool(msg.tool, msg.args || {}, client);
    await cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: true,
      result,
    });
  } catch (error) {
    await cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: false,
      errorCode: error instanceof TickTickError ? error.code : 'TICKTICK_CONNECTOR_ERROR',
      message: describeError(error),
    });
  }
});
