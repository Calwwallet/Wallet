/**
 * Standardized Error Handler Middleware
 */
export const errorHandler = (err, req, res, next) => {
    console.error('API Error:', err);

    const status = err.status || 500;

    // Create a structured error format
    const errorResponse = {
        error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message || 'An unexpected internal error occurred.',
        }
    };

    // Add specific details if provided
    if (err.details) {
        errorResponse.error.details = err.details;
    }

    // Handle specific known viem/blockchain errors
    if (err.message?.includes('insufficient funds')) {
        errorResponse.error.code = 'INSUFFICIENT_FUNDS';
        return res.status(400).json(errorResponse);
    }

    res.status(status).json(errorResponse);
};

// Helper class for throwing standardized errors
export class ApiError extends Error {
    constructor(message, status = 500, code = 'INTERNAL_ERROR', details = null) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
