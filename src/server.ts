import dotenv from 'dotenv';
// Load only .env
dotenv.config();
import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multerPkg from 'multer';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { protect, AuthenticatedRequest } from './middleware/auth.js';
// Twilio OTP sending removed; using console OTP for development
import { generateCertificatePDF } from './services/certificateService.js';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const app = express();
const prisma = new PrismaClient();

app.use(cors());
// Explicit preflight for safety (some clients are picky on mobile networks)
app.options('*', cors());
app.use(express.json());

// File uploads setup
const multer: any = multerPkg as any;
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

async function signIfS3Url(url: string): Promise<string> {
  const key = getS3KeyFromUrl(url);
  if (key && AWS_S3_BUCKET) {
    try {
      const cmd = new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key });
      // 1 hour expiry is fine for feed images; adjust as needed
      return await getSignedUrl(s3, cmd, { expiresIn: 3600 });
    } catch (e) {
      console.warn('[s3] failed to sign url for', key, e);
      return url; // fall back to original url
    }
  }
  return url;
}

// Use memory storage for images that will be sent to S3
const storage = multer.memoryStorage();

// S3 client configuration
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';
const s3 = new S3Client({ region: AWS_REGION });

function buildS3PublicUrl(key: string): string {
  const bucket = AWS_S3_BUCKET;
  const region = AWS_REGION;
  // Standard virtual-hosted–style URL
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`;
}

function getS3KeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://dummy${url}`);
    const host = u.host;
    if (host.includes(`${AWS_S3_BUCKET}.s3.`)) {
      // Real S3 URL: path starts with '/<key>'
      return decodeURIComponent(u.pathname.replace(/^\//, ''));
    }
    return null;
  } catch {
    return null;
  }
}

// Admin: force regenerate certificate for a lead
app.post('/api/admin/leads/:id/certificate/regenerate', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const lead = await (prisma as any).booking.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const steps = await (prisma as any).leadStep.findMany({ where: { leadId: id } });
    const latestCompletedAt = steps
      .map((s: any) => (s.completedAt ? new Date(s.completedAt) : null))
      .filter((d: Date | null) => !!d)
      .sort((a: Date | null, b: Date | null) => (a!.getTime() - b!.getTime()))
      .pop() as Date | undefined;
    const installDate = (latestCompletedAt || new Date()).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    const location = [lead.city, lead.state, lead.country].filter(Boolean).join(', ');
    const certificateId = `${id.slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-6)}`;
    const { publicUrl } = await generateCertificatePDF({
      leadId: id,
      customerName: lead.fullName,
      projectType: lead.projectType,
      sizedKW: lead.sizedKW,
      installDate,
      location,
      certificateId,
    });
    await (prisma as any).booking.update({ where: { id }, data: { certificateUrl: publicUrl, certificateGeneratedAt: new Date() } });
    res.json({ ok: true, certificateUrl: await signIfS3Url(publicUrl) });
  } catch (err) {
    console.error('[certificate] force regenerate failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// --- Staff Auth Endpoints ---
app.post('/api/auth/staff/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const staff = await prisma.staff.findUnique({ where: { email } });

    if (!staff) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, staff.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ sub: staff.id, email: staff.email, type: 'staff' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: staff.id, email: staff.email, name: staff.name, type: 'staff' } });
  } catch (error) {
    console.error('[staff-login] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Admin: Register new staff member
app.post('/api/admin/staff/register', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const { name, email, password, phone } = req.body;

    // Validate required fields
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ error: 'Name, email, password, and phone are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if staff with email already exists
    const existingStaff = await prisma.staff.findUnique({ where: { email } });
    if (existingStaff) {
      return res.status(409).json({ error: 'Staff member with this email already exists' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create staff member
    const staff = await prisma.staff.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        phone: phone.trim(),
      },
    });

    // Return staff data (without password hash)
    res.status(201).json({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      phone: staff.phone,
      createdAt: staff.createdAt,
    });
  } catch (error) {
    console.error('[admin-staff-register] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Admin: Get all staff members
app.get('/api/admin/staff', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const staff = await prisma.staff.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(staff);
  } catch (error) {
    console.error('[admin-staff-list] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Admin: Assign staff to booking
app.post('/api/admin/leads/:id/assign', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const { id } = req.params;
    const { staffId } = req.body;

    if (!staffId) {
      return res.status(400).json({ error: 'Staff ID is required' });
    }

    // Verify staff exists
    const staff = await prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Update booking assignment
    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: {
        assignedStaffId: staffId,
        assigned: true,
      },
      include: {
        assignedStaff: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json({
      success: true,
      assignedStaff: updatedBooking.assignedStaff,
    });
  } catch (error) {
    console.error('[admin-assign-staff] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Admin: Unassign staff from booking
app.post('/api/admin/leads/:id/unassign', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const { id } = req.params;

    // Update booking to remove assignment
    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: {
        assignedStaffId: null,
        assigned: false,
      },
    });

    res.json({
      success: true,
      message: 'Staff assignment removed successfully',
    });
  } catch (error) {
    console.error('[admin-unassign-staff] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Staff: get my assigned bookings
app.get('/api/staff/my-leads', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'staff') {
      return res.status(403).json({ error: 'Forbidden: Staff access required' });
    }
    const staffId = String(req.user.sub);
    const items = await (prisma as any).booking.findMany({
      where: { assignedStaffId: staffId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectType: true,
        fullName: true,
        city: true,
        state: true,
        country: true,
        createdAt: true,
        updatedAt: true,
        steps: {
          select: { id: true, name: true, completed: true, order: true, completedAt: true, completionNotes: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    res.json(items);
  } catch (error) {
    console.error('[staff-my-leads] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Staff: get specific assigned booking details
app.get('/api/staff/my-leads/:id', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'staff') {
      return res.status(403).json({ error: 'Forbidden: Staff access required' });
    }
    const staffId = String(req.user.sub);
    const { id } = req.params;

    const lead = await (prisma as any).booking.findFirst({
      where: { 
        id,
        assignedStaffId: staffId 
      },
      include: {
        customer: true,
        steps: { 
          select: { id: true, name: true, completed: true, order: true, completedAt: true, completionNotes: true },
          orderBy: { order: 'asc' } 
        },
      },
    });

    if (!lead) {
      return res.status(404).json({ error: 'Booking not found or not assigned to you' });
    }

    res.json(lead);
  } catch (error) {
    console.error('[staff-my-leads-detail] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Staff: mark step as complete with notes
app.post('/api/staff/steps/:stepId/complete', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'staff') {
      return res.status(403).json({ error: 'Forbidden: Staff access required' });
    }
    const staffId = String(req.user.sub);
    const { stepId } = req.params;
    const { notes } = req.body;

    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: 'Completion notes are required' });
    }

    // First verify the step belongs to a booking assigned to this staff
    const step = await (prisma as any).leadStep.findFirst({
      where: { id: stepId },
      include: {
        lead: {
          select: { id: true, assignedStaffId: true }
        }
      }
    });

    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    if (step.lead.assignedStaffId !== staffId) {
      return res.status(403).json({ error: 'You are not assigned to this booking' });
    }

    if (step.completed) {
      return res.status(400).json({ error: 'Step is already completed' });
    }

    // Update the step
    const updatedStep = await (prisma as any).leadStep.update({
      where: { id: stepId },
      data: {
        completed: true,
        completedAt: new Date(),
        completionNotes: notes.trim(),
      },
    });

    // Update booking progress
    const allSteps = await (prisma as any).leadStep.findMany({
      where: { leadId: step.lead.id },
      select: { completed: true }
    });
    
    const completedSteps = allSteps.filter((s: any) => s.completed).length;
    const totalSteps = allSteps.length;
    const newPercent = Math.round((completedSteps / totalSteps) * 100);

    await (prisma as any).booking.update({
      where: { id: step.lead.id },
      data: { percent: newPercent }
    });

    res.json({ 
      success: true, 
      step: updatedStep,
      progress: { completed: completedSteps, total: totalSteps, percent: newPercent }
    });
  } catch (error) {
    console.error('[staff-complete-step] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

const upload = multer({ storage });

// Serve static files from uploads
app.use('/uploads', express.static(uploadsDir));

// Simple in-memory OTP store (for development only)
type OtpRecord = { code: string; expiresAt: number; attempts: number };
const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
import { JWT_SECRET } from './config.js';

// Twilio removed; always console-output OTP in dev

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Admin: list customer phone numbers (minimal payload)
app.get('/api/admin/customers/phones', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    // Customer model has no 'name' field in schema; only return id+mobile
    const customers = await (prisma as any).customer.findMany({
      select: { id: true, mobile: true },
      orderBy: { createdAt: 'desc' },
    });
    // Add a derived 'name' for UI compatibility (use mobile as display)
    const shaped = customers.map((c: any) => ({ id: c.id, mobile: c.mobile, name: c.mobile }));
    res.json(shaped);
  } catch (err) {
    console.error('[admin] list customer phones failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Public sample certificate generator (for quick testing only)
app.post('/api/sample/certificate', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const installDate = now.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    const sample = {
      leadId: 'SAMPLE-LEAD',
      customerName: 'Sample Customer',
      projectType: 'Solar Rooftop',
      sizedKW: 5.2,
      installDate,
      location: 'Patna, Bihar, India',
      certificateId: `SAMPLE-${now.getTime().toString().slice(-6)}`,
    };
    const { publicUrl } = await generateCertificatePDF(sample as any);
    return res.json({ ok: true, certificateUrl: await signIfS3Url(publicUrl) });
  } catch (err) {
    console.error('[certificate] sample generation failed', err);
    return res.status(500).json({ error: 'Failed to generate sample' });
  }
});

// --- Lead Endpoints ---
// Create a lead from the Personal Info (5/5) page
app.post('/api/leads', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'customer') {
      return res.status(403).json({ error: 'Forbidden: customers only' });
    }
    const body = req.body ?? {};
    const required = ['projectType','sizedKW','monthlyBill','pincode','estimateINR','fullName','phone','address','street','state','city','country','zip'];
    for (const key of required) {
      if (body[key] === undefined || body[key] === null || body[key] === '') {
        return res.status(400).json({ error: `Missing required field: ${key}` });
      }
    }
    // Map optional calculator fields
    const billingCycleMonths = typeof body.billingCycleMonths === 'number'
      ? body.billingCycleMonths
      : (body.billingCycle === '2m' ? 2 : 1);
    const budgetINR = body.budget !== undefined ? Number(body.budget) : (body.budgetINR !== undefined ? Number(body.budgetINR) : null);
    const provider = typeof body.provider === 'string' ? String(body.provider) : undefined;

    // Finance/gst defaults
    const gstPct = body.gstPct !== undefined && body.gstPct !== null && body.gstPct !== '' ? Number(body.gstPct) : 8.9;
    const totalInvBase = body.totalInvestment !== undefined ? Number(body.totalInvestment) : Number(body.estimateINR);
    const computedGstAmount = body.gstAmount !== undefined && body.gstAmount !== null && body.gstAmount !== ''
      ? Number(body.gstAmount)
      : Math.round((Number.isFinite(totalInvBase) ? totalInvBase : 0) * (gstPct / 100));

    const Booking = (prisma as any).booking ?? (prisma as any).lead;
    const created = await Booking.create({
      data: {
        customerId: req.user.sub,
        projectType: String(body.projectType),
        sizedKW: Number(body.sizedKW),
        monthlyBill: Number(body.monthlyBill),
        // Allow pincode override from calculator if provided
        pincode: String(body.pincode),
        
        withSubsidy: body.withSubsidy === undefined ? true : Boolean(body.withSubsidy),
        estimateINR: Number(body.estimateINR),
        totalInvestment: totalInvBase,
        wp: body.wp !== undefined ? Number(body.wp) : null,
        plates: body.plates !== undefined ? Number(body.plates) : null,
        // Finance (receipt) inputs
        ratePerKW: body.ratePerKW !== undefined ? Number(body.ratePerKW) : null,
        networkChargePerUnit: body.networkChargePerUnit !== undefined ? Number(body.networkChargePerUnit) : null,
        annualGenPerKW: body.annualGenPerKW !== undefined ? Number(body.annualGenPerKW) : null,
        moduleDegradationPct: body.moduleDegradationPct !== undefined ? Number(body.moduleDegradationPct) : null,
        omPerKWYear: body.omPerKWYear !== undefined ? Number(body.omPerKWYear) : null,
        omEscalationPct: body.omEscalationPct !== undefined ? Number(body.omEscalationPct) : null,
        tariffINR: body.tariffINR !== undefined ? Number(body.tariffINR) : null,
        tariffEscalationPct: body.tariffEscalationPct !== undefined ? Number(body.tariffEscalationPct) : null,
        lifeYears: body.lifeYears !== undefined ? Number(body.lifeYears) : null,
        gstPct,
        gstAmount: computedGstAmount,
        fullName: String(body.fullName),
        phone: String(body.phone),
        email: body.email ? String(body.email) : null,
        address: String(body.address),
        street: String(body.street),
        state: String(body.state),
        city: String(body.city),
        country: String(body.country),
        zip: String(body.zip),
        // New optional calculator-derived fields
        billingCycleMonths,
        budgetINR,
        ...(provider ? { provider } : {}),
      }
    });
    res.status(201).json(created);
  } catch (err: any) {
    console.error('[leads] create failed', err?.message || err, err?.stack);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Public create lead/booking (no auth) - used by mobile app 5/5 submission
app.post('/api/leads/public', async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const required = ['projectType','sizedKW','monthlyBill','pincode','estimateINR','fullName','phone','address','street','state','city','country','zip'];
    for (const key of required) {
      if (body[key] === undefined || body[key] === null || body[key] === '') {
        return res.status(400).json({ error: `Missing required field: ${key}` });
      }
    }
    const billingCycleMonths = typeof body.billingCycleMonths === 'number'
      ? body.billingCycleMonths
      : (body.billingCycle === '2m' ? 2 : 1);
    const budgetINR = body.budget !== undefined ? Number(body.budget) : (body.budgetINR !== undefined ? Number(body.budgetINR) : null);
    const provider = typeof body.provider === 'string' ? body.provider : null;

    // Finance/gst defaults for public route
    const gstPctPublic = body.gstPct !== undefined && body.gstPct !== null && body.gstPct !== '' ? Number(body.gstPct) : 8.9;
    const totalInvBasePublic = body.totalInvestment !== undefined ? Number(body.totalInvestment) : Number(body.estimateINR);
    const computedGstAmountPublic = body.gstAmount !== undefined && body.gstAmount !== null && body.gstAmount !== ''
      ? Number(body.gstAmount)
      : Math.round((Number.isFinite(totalInvBasePublic) ? totalInvBasePublic : 0) * (gstPctPublic / 100));

    // If a valid customer token is present, associate this booking to that customer
    let customerId: string | null = null;
    try {
      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token) {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.type === 'customer' && typeof decoded.sub === 'string') {
          customerId = decoded.sub;
        }
      }
    } catch {
      // ignore auth errors in public route
    }

    // If no token-derived customer, try to infer from provided phone/mobile
    if (!customerId) {
      try {
        const rawPhone: string | undefined = typeof body.phone === 'string' ? body.phone : (typeof body.mobile === 'string' ? body.mobile : undefined);
        if (rawPhone) {
          const normalized = String(rawPhone).replace(/\D+/g, ''); // digits only
          if (normalized.length >= 8 && normalized.length <= 15) {
            const existing = await (prisma as any).customer.findUnique({ where: { mobile: normalized } });
            if (existing) {
              customerId = existing.id;
            } else {
              const createdCustomer = await (prisma as any).customer.create({ data: { mobile: normalized } });
              customerId = createdCustomer.id;
            }
          }
        }
      } catch (e) {
        // do not fail public route due to customer association issues
        console.warn('[leads-public] customer association by phone skipped:', (e as any)?.message || e);
      }
    }

    const Booking = (prisma as any).booking ?? (prisma as any).lead ?? (prisma as any).Lead;
    const created = await Booking.create({
      data: {
        ...(customerId ? { customerId } : {}),
        projectType: String(body.projectType),
        sizedKW: Number(body.sizedKW),
        monthlyBill: Number(body.monthlyBill),
        pincode: String(body.pincode),
        withSubsidy: body.withSubsidy === undefined ? true : Boolean(body.withSubsidy),
        estimateINR: Number(body.estimateINR),
        totalInvestment: totalInvBasePublic,
        wp: body.wp !== undefined ? Number(body.wp) : null,
        plates: body.plates !== undefined ? Number(body.plates) : null,
        // Finance (receipt) inputs
        ratePerKW: body.ratePerKW !== undefined ? Number(body.ratePerKW) : null,
        networkChargePerUnit: body.networkChargePerUnit !== undefined ? Number(body.networkChargePerUnit) : null,
        annualGenPerKW: body.annualGenPerKW !== undefined ? Number(body.annualGenPerKW) : null,
        moduleDegradationPct: body.moduleDegradationPct !== undefined ? Number(body.moduleDegradationPct) : null,
        omPerKWYear: body.omPerKWYear !== undefined ? Number(body.omPerKWYear) : null,
        omEscalationPct: body.omEscalationPct !== undefined ? Number(body.omEscalationPct) : null,
        tariffINR: body.tariffINR !== undefined ? Number(body.tariffINR) : null,
        tariffEscalationPct: body.tariffEscalationPct !== undefined ? Number(body.tariffEscalationPct) : null,
        lifeYears: body.lifeYears !== undefined ? Number(body.lifeYears) : null,
        gstPct: gstPctPublic,
        gstAmount: computedGstAmountPublic,
        fullName: String(body.fullName),
        phone: String(body.phone),
        email: body.email ? String(body.email) : null,
        address: String(body.address),
        street: String(body.street),
        state: String(body.state),
        city: String(body.city),
        country: String(body.country),
        zip: String(body.zip),
        billingCycleMonths,
        budgetINR,
        ...(provider ? { provider } : {}),
      }
    });
    res.status(201).json(created);
  } catch (err: any) {
    console.error('[leads-public] create failed', err?.message || err, err?.stack);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Customer: list own leads
app.get('/api/customer/leads', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'customer') return res.status(403).json({ error: 'Forbidden' });
    const items = await (prisma as any).booking.findMany({ where: { customerId: req.user.sub }, orderBy: { createdAt: 'desc' } });
    const withSigned = await Promise.all(items.map(async (l: any) => ({
      ...l,
      certificateUrl: typeof l.certificateUrl === 'string' ? await signIfS3Url(l.certificateUrl) : l.certificateUrl,
    })));
    res.json(withSigned);
  } catch (err) {
    console.error('[leads] customer list failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Customer: get a single lead (own), include certificate fields
app.get('/api/customer/leads/:id', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'customer') return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const lead = await (prisma as any).booking.findFirst({ where: { id, customerId: req.user.sub } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const signed = { ...lead, certificateUrl: typeof lead.certificateUrl === 'string' ? await signIfS3Url(lead.certificateUrl) : lead.certificateUrl };
    res.json(signed);
  } catch (err) {
    console.error('[leads] customer get failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: list all leads
app.get('/api/admin/leads', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const items = await (prisma as any).booking.findMany({ 
      orderBy: { createdAt: 'desc' }, 
      include: { 
        customer: true, 
        steps: true,
        assignedStaff: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      } 
    });
    const withSigned = await Promise.all(items.map(async (l: any) => ({
      ...l,
      certificateUrl: typeof l.certificateUrl === 'string' ? await signIfS3Url(l.certificateUrl) : l.certificateUrl,
    })));
    res.json(withSigned);
  } catch (err) {
    console.error('[leads] admin list failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: AMC/Service requests - list
app.get('/api/admin/amc-requests', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const items = await (prisma as any).amcRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { customer: true, lead: true },
    });
    res.json(items);
  } catch (err) {
    console.error('[amc] admin list failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: get a single lead by ID (include steps and customer)
app.get('/api/admin/leads/:id', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const lead = await (prisma as any).booking.findUnique({ 
      where: { id }, 
      include: { 
        customer: true, 
        steps: { orderBy: { order: 'asc' } },
        assignedStaff: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      } 
    });
    if (!lead) return res.status(404).json({ error: 'Not found' });
    const signed = { ...lead, certificateUrl: typeof lead.certificateUrl === 'string' ? await signIfS3Url(lead.certificateUrl) : lead.certificateUrl };
    res.json(signed);
  } catch (err) {
    console.error('[leads] admin get failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const DEFAULT_STEP_NAMES: string[] = [
  'meeting',
  'survey',
  'staucher install',
  'civil work',
  'wiring',
  'panel installation',
  'net metering',
  'testing',
  'fully plant start',
  'subsidy process request',
  'subsidy disbursement',
  'certificate',
];

// Admin: list/init steps for a lead
app.get('/api/admin/leads/:id/steps', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const lead = await (prisma as any).lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const existing: any[] = await (prisma as any).leadStep.findMany({ where: { leadId: id }, orderBy: { order: 'asc' } });
    if (existing.length === 0) {
      await (prisma as any).$transaction(
        DEFAULT_STEP_NAMES.map((name, idx) => (prisma as any).leadStep.create({ data: { leadId: id, name, order: idx + 1 } }))
      );
    }
    const steps = await (prisma as any).leadStep.findMany({ where: { leadId: id }, orderBy: { order: 'asc' } });
    res.json(steps);
  } catch (err) {
    console.error('[leads] admin steps list/init failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: mark a lead step complete/undo
app.patch('/api/admin/leads/:id/steps/:stepId', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { id, stepId } = req.params;
    const { completed } = req.body ?? {};
    const step = await (prisma as any).leadStep.findFirst({ where: { id: stepId, leadId: id } });
    if (!step) return res.status(404).json({ error: 'Step not found' });
    const updated = await (prisma as any).leadStep.update({
      where: { id: stepId },
      data: { completed: Boolean(completed), completedAt: completed ? new Date() : null },
    });

    // If marking as completed, check if all non-'certificate' steps are done and generate certificate if missing
    if (Boolean(completed)) {
      const lead = await (prisma as any).lead.findUnique({ where: { id }, include: { steps: true } });
      if (lead) {
        const steps = await (prisma as any).leadStep.findMany({ where: { leadId: id }, orderBy: { order: 'asc' } });
        const nonCertSteps = steps.filter((s: any) => s.name !== 'certificate');
        const allNonCertComplete = nonCertSteps.length > 0 && nonCertSteps.every((s: any) => s.completed);
        if (allNonCertComplete && !lead.certificateUrl) {
          // Determine installation date as the latest completedAt among non-certificate steps or now
          const latestCompletedAt = nonCertSteps
            .map((s: any) => (s.completedAt ? new Date(s.completedAt) : null))
            .filter((d: Date | null) => !!d)
            .sort((a: Date | null, b: Date | null) => (a!.getTime() - b!.getTime()))
            .pop() as Date | undefined;
          const installDate = (latestCompletedAt || new Date()).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
          const location = [lead.city, lead.state, lead.country].filter(Boolean).join(', ');
          const certificateId = `${id.slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-6)}`;
          try {
            const { publicUrl } = await generateCertificatePDF({
              leadId: id,
              customerName: lead.fullName,
              projectType: lead.projectType,
              sizedKW: lead.sizedKW,
              installDate,
              location,
              certificateId,
            });
            await (prisma as any).booking.update({
              where: { id },
              data: { certificateUrl: publicUrl, certificateGeneratedAt: new Date() },
            });
            // Mark the 'certificate' step as completed automatically
            const certStep = steps.find((s: any) => s.name === 'certificate');
            if (certStep && !certStep.completed) {
              await (prisma as any).leadStep.update({
                where: { id: certStep.id },
                data: { completed: true, completedAt: new Date() },
              });
            }
          } catch (err) {
            console.error('[certificate] generation failed', err);
            // Do not fail the step update due to certificate issues
          }
        }
      }
    }

    res.json(updated);
  } catch (err) {
    console.error('[leads] admin step update failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- Customer-facing endpoints (steps + AMC) ---
// Customer: fetch steps for a lead they own (init defaults if missing)
app.get('/api/customer/leads/:id/steps', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'customer') return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    // Some environments use `booking` instead of `lead`
    let ownerLead: any = await (prisma as any).booking.findFirst({ where: { id, customerId: req.user.sub } });
    if (!ownerLead && (prisma as any).lead && typeof (prisma as any).lead.findFirst === 'function') {
      ownerLead = await (prisma as any).lead.findFirst({ where: { id, customerId: req.user.sub } });
    }
    if (!ownerLead) return res.status(404).json({ error: 'Lead not found' });
    const existing: any[] = await (prisma as any).leadStep.findMany({ where: { leadId: id }, orderBy: { order: 'asc' } });
    if (existing.length === 0) {
      await (prisma as any).$transaction(
        DEFAULT_STEP_NAMES.map((name, idx) => (prisma as any).leadStep.create({ data: { leadId: id, name, order: idx + 1 } }))
      );
    }
    const steps = await (prisma as any).leadStep.findMany({ where: { leadId: id }, orderBy: { order: 'asc' } });
    res.json(steps);
  } catch (err) {
    console.error('[leads] customer steps failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Customer: submit AMC request (create if not exists or not resolved)
app.post('/api/customer/amc-requests', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'customer') return res.status(403).json({ error: 'Forbidden' });
    const { leadId, note } = req.body ?? {};
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });
    const lead = await (prisma as any).booking.findFirst({ where: { id: String(leadId), customerId: req.user.sub } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    let existing = await (prisma as any).amcRequest.findFirst({
      where: { leadId: String(leadId), customerId: req.user.sub, NOT: { status: 'resolved' } },
    });
    if (existing) {
      // Update note if provided, keep status
      if (note && typeof note === 'string') {
        existing = await (prisma as any).amcRequest.update({ where: { id: existing.id }, data: { note } });
      }
      return res.status(200).json(existing);
    }
    const created = await (prisma as any).amcRequest.create({
      data: {
        leadId: String(leadId),
        customerId: req.user.sub,
        status: 'pending',
        note: note && typeof note === 'string' ? note : null,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    console.error('[amc] customer request failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Customer: get AMC request for a specific lead
app.get('/api/customer/amc-requests', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'customer') return res.status(403).json({ error: 'Forbidden' });
    const leadId = String((req.query as any).leadId || '');
    if (!leadId) return res.status(400).json({ error: 'leadId query is required' });
    const lead = await (prisma as any).booking.findFirst({ where: { id: leadId, customerId: req.user.sub } });
    if (!lead) return res.json(null);
    const reqItem = await (prisma as any).amcRequest.findFirst({
      where: { leadId, customerId: req.user.sub },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reqItem || null);
  } catch (err) {
    console.error('[amc] customer get failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Customer: get AMC requests history for a specific lead
app.get('/api/customer/amc-requests/history', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'customer') return res.status(403).json({ error: 'Forbidden' });
    const leadId = String((req.query as any).leadId || '');
    if (!leadId) return res.status(400).json({ error: 'leadId query is required' });
    const lead = await (prisma as any).lead.findFirst({ where: { id: leadId, customerId: req.user.sub } });
    if (!lead) return res.json([]);
    const items = await (prisma as any).amcRequest.findMany({
      where: { leadId, customerId: req.user.sub },
      orderBy: { createdAt: 'desc' },
    });
    res.json(items);
  } catch (err) {
    console.error('[amc] customer history failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: mark AMC request done/resolved
app.patch('/api/admin/amc-requests/:id', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!status || !['pending','in_progress','resolved','rejected'].includes(String(status))) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const updated = await (prisma as any).amcRequest.update({
      where: { id },
      data: {
        status: String(status),
        resolvedAt: status === 'resolved' ? new Date() : null,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('[amc] admin update failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Customer: fetch steps for a given inquiry they own
// Removed inquiry steps endpoints (legacy)

// Protected route to get all inquiries for admins
// Removed legacy inquiries list (admin)

// Admin: fetch steps for a given inquiry (initializes defaults if missing)
// Removed legacy inquiry steps (admin)

// Admin: mark a specific step as complete
// Removed legacy inquiry step complete

// --- Partner Auth Endpoints ---

app.post('/api/auth/partner/request-otp', async (req: Request, res: Response) => {
  const { mobile } = req.body;
  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ error: 'A valid 10-digit mobile number is required' });
  }

  const normalizedMobile = `+91${mobile}`;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(normalizedMobile, { code: otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  console.log(`[request-otp-partner][DEV] OTP for ${normalizedMobile} is ${otp}`);
  return res.json({ message: 'OTP sent (DEV)', otp, ttlMs: OTP_TTL_MS });
});

app.post('/api/auth/partner/verify-otp', async (req: Request, res: Response) => {
  const { mobile, otp } = req.body;
  if (!mobile || !otp) {
    return res.status(400).json({ error: 'Mobile and OTP are required' });
  }

  const normalizedMobile = `+91${mobile}`;
  const otpData = otpStore.get(normalizedMobile);

  if (!otpData || otpData.expiresAt < Date.now() || otpData.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(401).json({ error: 'OTP is invalid or has expired' });
  }

  if (otpData.code !== otp) {
    otpData.attempts++;
    return res.status(401).json({ error: 'Incorrect OTP' });
  }

  let partner = await prisma.partner.findUnique({ where: { mobile: normalizedMobile } });
  if (!partner) {
    partner = await prisma.partner.create({ data: { mobile: normalizedMobile, name: 'New Partner' } });
  }

  const token = jwt.sign({ sub: partner.id, mobile: partner.mobile, type: 'partner' }, JWT_SECRET, { expiresIn: '7d' });
  otpStore.delete(normalizedMobile);

  res.json({ token, user: partner });
});


// --- Admin Auth Endpoint ---

app.post('/api/auth/admin/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const admin = await prisma.admin.findUnique({ where: { email } });

    if (!admin) {
      // Use a generic error message to prevent email enumeration attacks
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Issue a token
    const token = jwt.sign({ sub: admin.id, email: admin.email, type: 'admin' }, JWT_SECRET, { expiresIn: '1d' });

    // Return the token and a sanitized user object
    res.json({ token, user: { id: admin.id, email: admin.email, name: admin.name, type: 'admin' } });

  } catch (error) {
    console.error('[admin-login] Error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});



// Request OTP (fake) for a mobile number
app.post('/api/auth/request-otp', async (req: Request, res: Response) => {
  try {
    const { mobile } = req.body ?? {};
    if (!mobile || typeof mobile !== 'string') {
      return res.status(400).json({ error: 'mobile is required' });
    }
    // Very basic mobile format check
    const normalized = mobile.replace(/\s+/g, '');
    if (!/^\d{8,15}$/.test(normalized)) {
      return res.status(400).json({ error: 'invalid mobile format' });
    }

    // Generate a fake OTP (for dev). You can fix it to 123456 if preferred.
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(normalized, {
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });

    console.log(`[request-otp][DEV] OTP for ${normalized} is ${code}`);
    return res.json({ success: true, mobile: normalized, otp: code, ttlMs: OTP_TTL_MS, via: 'dev' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('request-otp failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Verify OTP, create user (if needed), and return JWT
app.post('/api/auth/verify-otp', async (req: Request, res: Response) => {
  try {
    const { mobile, otp } = req.body ?? {};
    if (!mobile || typeof mobile !== 'string' || !otp || typeof otp !== 'string') {
      return res.status(400).json({ error: 'mobile and otp are required' });
    }
    console.log(`[verify-otp] Received request for mobile: ${mobile}, otp: ${otp}`);

    const normalized = mobile.replace(/\s+/g, '');
    const storedOtp = otpStore.get(normalized);

    console.log(`[verify-otp] Stored OTP data for ${normalized}:`, storedOtp);

    if (!storedOtp) {
      console.error(`[verify-otp] No OTP found for ${normalized}. It may have expired or was never requested.`);
      return res.status(400).json({ error: 'OTP not requested or has expired' });
    }

    if (Date.now() > storedOtp.expiresAt) {
      console.error(`[verify-otp] OTP for ${normalized} has expired.`);
      otpStore.delete(normalized);
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    if (storedOtp.attempts >= OTP_MAX_ATTEMPTS) {
      console.error(`[verify-otp] Too many attempts for ${normalized}.`);
      otpStore.delete(normalized);
      return res.status(403).json({ error: 'Too many attempts. Please request a new OTP.' });
    }

    if (storedOtp.code !== otp.trim()) {
      // Increment attempts
      storedOtp.attempts += 1;
      console.error(`[verify-otp] Invalid OTP for ${normalized}. Received: ${otp.trim()}, Expected: ${storedOtp.code}`);
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    console.log(`[verify-otp] OTP for ${normalized} is correct. Deleting from store.`);
    // OTP correct; consume it
    otpStore.delete(normalized);

    // Find an existing customer or create a new one
    let customer = await (prisma as any).customer.findUnique({
      where: { mobile: normalized },
    });

    if (!customer) {
      customer = await (prisma as any).customer.create({
        data: { mobile: normalized },
      });
    }

    

    // Issue JWT for the customer
    const token = jwt.sign({ sub: customer.id, mobile: customer.mobile, type: 'customer' }, JWT_SECRET, {
      expiresIn: '7d',
    });

    // Log success and delete OTP
    console.log(`[verify-otp] Customer ${customer.id} authenticated successfully.`);
    otpStore.delete(normalized);

    // Return token and user object
    res.json({ token, user: customer });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('verify-otp failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Removed legacy inquiry create

// List recent inquiries (for verification/testing)
// Removed legacy inquiries list (public)

// --- Posts Endpoints ---

// Public: list posts for feed
app.get('/api/posts', async (_req: Request, res: Response) => {
  try {
    const items = await (prisma as any).post.findMany({ orderBy: { createdAt: 'desc' } });
    const withSigned = await Promise.all(items.map(async (p: any) => ({
      ...p,
      imageUrl: typeof p.imageUrl === 'string' ? await signIfS3Url(p.imageUrl) : p.imageUrl,
    })));
    res.json(withSigned);
  } catch (err) {
    console.error('[posts] list failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: list posts (protected)
app.get('/api/admin/posts', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const items = await (prisma as any).post.findMany({ orderBy: { createdAt: 'desc' } });
    const withSigned = await Promise.all(items.map(async (p: any) => ({
      ...p,
      imageUrl: typeof p.imageUrl === 'string' ? await signIfS3Url(p.imageUrl) : p.imageUrl,
    })));
    res.json(withSigned);
  } catch (err) {
    console.error('[posts] admin list failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: create a post
app.post('/api/admin/posts', protect, upload.single('image'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admins only' });
    }
    const { caption } = req.body ?? {};
    if (!caption || typeof caption !== 'string') {
      return res.status(400).json({ error: 'caption is required' });
    }
    const file = (req as any).file;
    if (!file) {
      return res.status(400).json({ error: 'image file is required' });
    }
    let imageUrl: string | null = null;
    if (AWS_S3_BUCKET) {
      // Upload to S3
      const ext = path.extname(file.originalname) || '.jpg';
      const key = `posts/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      }));
      imageUrl = buildS3PublicUrl(key);
    } else {
      // Fallback to local disk if bucket not configured
      const localName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname) || '.jpg'}`;
      const localPath = path.join(uploadsDir, localName);
      fs.writeFileSync(localPath, file.buffer);
      imageUrl = `/uploads/${localName}`;
    }

    const post = await (prisma as any).post.create({
      data: {
        caption: caption.trim(),
        imageUrl,
        authorId: req.user.sub,
      },
    });
    const signed = { ...post, imageUrl: imageUrl ? await signIfS3Url(imageUrl) : imageUrl };
    res.status(201).json(signed);
  } catch (err) {
    console.error('[posts] create failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin: delete a post (and its image file if present)
app.delete('/api/admin/posts/:id', protect, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.type !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admins only' });
    }
    const { id } = req.params;
    const existing = await (prisma as any).post.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Post not found', id });

    // Attempt to delete the file from S3 if it points to our bucket; otherwise try local
    const img: string = existing.imageUrl || '';
    let deleted = false;
    if (typeof img === 'string') {
      const key = getS3KeyFromUrl(img);
      if (key && AWS_S3_BUCKET) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key }));
          deleted = true;
        } catch (e) {
          console.warn('[posts] failed to remove S3 object', e);
        }
      }
      if (!deleted && img.startsWith('/uploads/')) {
        const filePath = path.join(process.cwd(), img.replace(/^\//, ''));
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) {
          console.warn('[posts] failed to remove local image file', e);
        }
      }
    }

    await (prisma as any).post.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[posts] delete failed', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Like a post (simple increment, no auth for now)
app.post('/api/posts/:id/like', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await (prisma as any).post.update({
      where: { id },
      data: { likes: { increment: 1 } },
    });
    res.json(updated);
  } catch (err) {
    console.error('[posts] like failed', err);
    res.status(400).json({ error: 'Failed to like post' });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${PORT}`);
});
