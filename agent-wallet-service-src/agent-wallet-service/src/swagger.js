import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Agent Wallet Service',
            version: '0.4.0',
            description: 'Stripe for AI Agent Wallets — Add wallet functionality to any AI agent in seconds.',
            contact: {
                name: 'Agent Wallet Service Docs',
                url: 'https://github.com/mrclaw/agent-wallet-service',
            },
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Local development server',
            },
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-API-Key',
                    description: 'Secure API Key for protected endpoints',
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'string',
                            description: 'Error message description',
                        },
                    },
                },
            },
        },
        security: [
            {
                ApiKeyAuth: [],
            },
        ],
    },
    // The files containing the API definitions/comments
    apis: ['./src/routes/*.js', './src/index.js'],
};

const swaggerSpec = swaggerJsdoc(options);

export const setupSwagger = (app) => {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Agent Wallet API Docs'
    }));
};
