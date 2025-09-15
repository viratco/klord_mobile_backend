import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config.js';

// A flexible payload that can handle all user types
interface UserPayload {
  sub: string;
  type: 'customer' | 'partner' | 'admin';
  mobile?: string; // Optional for admin
  email?: string;  // Optional for customer/partner
  iat: number;
  exp: number;
}

// Extend the Express Request type to include our unified user object
export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    type: 'customer' | 'partner' | 'admin';
    mobile?: string;
    email?: string;
  };
}

export const protect = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const bearer = req.headers.authorization;

  if (!bearer || !bearer.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authorized, no token' });
  }

  const token = bearer.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as UserPayload;
    
    // Attach a unified user object to the request
    req.user = {
      sub: payload.sub,
      type: payload.type,
      mobile: payload.mobile,
      email: payload.email,
    };
    
    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(401).json({ error: 'Not authorized, token failed' });
  }
};

