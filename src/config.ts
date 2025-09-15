import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod';
