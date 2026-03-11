export function createErrorEnvelope({ code, message, details = null }) {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  };
}

export function sendError(res, status, code, message, details = null) {
  return res.status(status).json(createErrorEnvelope({ code, message, details }));
}

export function normalizeErrorDetails(error) {
  if (!error) return null;
  if (Array.isArray(error)) return error;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return error;
}
