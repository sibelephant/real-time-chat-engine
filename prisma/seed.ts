import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

/**
 * Seed script — creates a demo user and a General chat room.
 * Run with: npx ts-node prisma/seed.ts
 */
async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    console.log('🌱 Seeding database...');

    // Create demo user
    const hashedPassword = await bcrypt.hash('demo1234', 10);
    const demoUser = await prisma.user.upsert({
        where: { username: 'demo' },
        update: {},
        create: {
            username: 'demo',
            password: hashedPassword,
        },
    });
    console.log(`  ✓ Demo user: ${demoUser.username} (${demoUser.id})`);

    // Create General room
    const generalRoom = await prisma.room.upsert({
        where: { id: demoUser.id },   // will not find — forces create
        update: {},
        create: {
            name: 'General',
            type: 'GROUP',
            creatorId: demoUser.id,
            members: {
                create: { userId: demoUser.id },
            },
        },
    });
    console.log(`  ✓ Room: ${generalRoom.name} (${generalRoom.id})`);

    console.log('✅ Seed complete!');

    await prisma.$disconnect();
    await pool.end();
}

main().catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
});
