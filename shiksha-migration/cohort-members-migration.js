const { Client } = require('pg');
const dbConfig = require('./db');

console.log('=== Loading cohort-members-migration.js ===');

async function migrateCohortMembers() {
  console.log('=== STARTING COHORT MEMBERS MIGRATION ===');
  const sourceClient = new Client(dbConfig.source);
  const destClient = new Client(dbConfig.destination);

  try {
    await sourceClient.connect();
    console.log('[COHORT MEMBERS] Connected to source database');
    await destClient.connect();
    console.log('[COHORT MEMBERS] Connected to destination database');

    const query = `
      SELECT 
        cm."cohortMembershipId",
        cm."cohortId",
        cm."userId",
        cm.status,
        cm."cohortAcademicYearId",
        cm."createdAt",
        cm."updatedAt",
        cay."academicYearId"
      FROM public."CohortMembers" cm
      LEFT JOIN public."CohortAcademicYear" cay
        ON cm."cohortAcademicYearId" = cay."cohortAcademicYearId"
    `;

    const res = await sourceClient.query(query);
    console.log(`[COHORT MEMBERS] Found ${res.rows.length} cohort member records to migrate.`);
    for (const row of res.rows) {
      await upsertCohortMember(destClient, row);
      // break;
      // Uncomment to test single record
      // console.log('[COHORT MEMBERS] 🛑 Stopping after one record for testing');
      // break;
    }

    console.log('[COHORT MEMBERS] Migration completed successfully');
  } catch (err) {
    console.error('[COHORT MEMBERS] Critical error:', err);
  } finally {
    await sourceClient.end();
    await destClient.end();
    console.log('[COHORT MEMBERS] Disconnected from databases');
  }
}

async function upsertCohortMember(destClient, row) {
  try {
    const insert = `
      INSERT INTO public."CohortMember" (
        "CohortMemberID", "CohortID", "UserID", "MemberStatus", "AcademicYearID","CreatedAt","UpdatedAt"
      ) VALUES ($1, $2, $3, $4, $5,$6,$7)
    `;

    const values = [
      row.cohortMembershipId,
      row.cohortId,
      row.userId,
      row.status || null,
      row.academicYearId || null,
      row.createdAt,
      row.updatedAt
    ];

    await destClient.query(insert, values);
  } catch (e) {
    console.error(`[COHORT MEMBERS] Error upserting CohortMemberID=${row.cohortMembershipId}:`, e.message);
  }
}

if (require.main === module) {
  console.log('Running cohort-members-migration.js directly');
  migrateCohortMembers().catch(err => {
    console.error('CohortMembers migration failed with unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { migrateCohortMembers };