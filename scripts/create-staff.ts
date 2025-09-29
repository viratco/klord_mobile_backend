import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_STAFF_EMAIL || 'staff@example.com';
  const name = process.env.SEED_STAFF_NAME || 'Demo Staff';
  const password = process.env.SEED_STAFF_PASSWORD || 'password123';

  const passwordHash = await bcrypt.hash(password, 10);

  // Use any-cast to avoid TS error before `prisma generate` has been run
  const existing = await (prisma as any).staff.findUnique({ where: { email } });
  if (existing) {
    console.log(`[create-staff] Staff already exists: ${email}`);
    return;
  }

  const staff = await (prisma as any).staff.create({ data: { email, name, passwordHash } });
  console.log(`[create-staff] Created staff: ${staff.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
