const { MongoClient } = require('mongodb');
const { Client } = require('pg');
const dbConfig = require('./db');

console.log('=== Loading project-migration.js ===');

/*
 * PROJECT MIGRATION: MongoDB Solutions → PostgreSQL Project
 * 
 * Source: MongoDB - Solutions collection
 * Destinationyour_database_name: PostgreSQL - Project table
 * 
 * Field Mapping:
 * - ProjectId      ← _id (MongoDB ObjectId as string)
 * - ProjectName    ← name
 * - Board          ← scope.board[0] (first element of array)
 * - Medium         ← scope.medium[0]
 * - Subject        ← scope.subject[0]
 * - Grade          ← scope.class[0]
 * - Type           ← scope.courseType[0]
 * - StartDate      ← startDate
 * - EndDate        ← endDate
 * - CreatedBy      ← createdBy (if available)
 * - TenantId       ← tenantId (if available)
 * - AcademicYear   ← academicYear (if available)
 */

/**
 * Extract first element from array or return null
 */
function firstOrNull(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }
  return value;
}

/**
 * Parse MongoDB date to JavaScript Date
 */
function parseMongoDate(mongoDate) {
  if (!mongoDate) return null;
  
  try {
    // Handle MongoDB $date format (e.g., {$date: "2025-12-17T01:38:37.000Z"})
    if (mongoDate.$date) {
      const parsed = new Date(mongoDate.$date);
      if (isNaN(parsed.getTime())) {
        console.warn('[PROJECT MIGRATION] Invalid $date format:', mongoDate.$date);
        return null;
      }
      return parsed;
    }
    
    // Handle ISO string
    if (typeof mongoDate === 'string') {
      const parsed = new Date(mongoDate);
      if (isNaN(parsed.getTime())) {
        console.warn('[PROJECT MIGRATION] Invalid date string:', mongoDate);
        return null;
      }
      return parsed;
    }
    
    // Already a Date object
    if (mongoDate instanceof Date) {
      if (isNaN(mongoDate.getTime())) {
        console.warn('[PROJECT MIGRATION] Invalid Date object');
        return null;
      }
      return mongoDate;
    }
    
    console.warn('[PROJECT MIGRATION] Unrecognized date format:', mongoDate);
    return null;
  } catch (error) {
    console.error('[PROJECT MIGRATION] Error parsing date:', error.message);
    return null;
  }
}

/**
 * Transform MongoDB Solution document to PostgreSQL Project record
 */
function transformSolutionToProject(solution) {
  const scope = solution.scope || {};
  
  // Parse dates from solution document
  const startDate = parseMongoDate(solution.startDate);
  const endDate = parseMongoDate(solution.endDate);
  
  // Log date parsing for verification
  if (solution.startDate || solution.endDate) {
    console.log(`[PROJECT MIGRATION] Solution ${solution._id} dates: StartDate=${startDate ? startDate.toISOString() : 'NULL'}, EndDate=${endDate ? endDate.toISOString() : 'NULL'}`);
  }
  
  return {
    ProjectId: solution._id.toString(), // Convert MongoDB ObjectId to string
    ProjectName: solution.name || null,
    Board: firstOrNull(scope.board),
    Medium: firstOrNull(scope.medium),
    Subject: firstOrNull(scope.subject),
    Grade: firstOrNull(scope.class), // Note: MongoDB has "class", PostgreSQL has "Grade"
    Type: firstOrNull(scope.courseType),
    StartDate: startDate,
    EndDate: endDate,
    CreatedBy: solution.createdBy || null,
    TenantId: solution.tenantId || null,
    AcademicYear: solution.academicYear || null,
  };
}

/**
 * Format date for PostgreSQL (YYYY-MM-DD format)
 */
function formatDateForPostgres(date) {
  if (!date || !(date instanceof Date)) return null;
  
  // Use toISOString and extract date part to avoid timezone issues
  const isoString = date.toISOString();
  const datePart = isoString.split('T')[0]; // Get YYYY-MM-DD
  
  return datePart;
}

/**
 * Upsert a single project into PostgreSQL
 */
async function upsertProject(pgClient, project) {
  // Format dates as YYYY-MM-DD strings to avoid timezone issues
  const startDateFormatted = formatDateForPostgres(project.StartDate);
  const endDateFormatted = formatDateForPostgres(project.EndDate);
  
  // Debug log the dates being inserted
  console.log(`[PROJECT MIGRATION] Inserting dates for ${project.ProjectId}:`);
  console.log(`  - StartDate (raw): ${project.StartDate}`);
  console.log(`  - StartDate (formatted): ${startDateFormatted}`);
  console.log(`  - EndDate (raw): ${project.EndDate}`);
  console.log(`  - EndDate (formatted): ${endDateFormatted}`);
  
  const query = `
    INSERT INTO public."Project" (
      "ProjectId", "ProjectName", "Board", "Medium", "Subject", 
      "Grade", "Type", "StartDate", "EndDate", 
      "CreatedBy", "TenantId", "AcademicYear"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT ("ProjectId") DO UPDATE SET
      "ProjectName" = EXCLUDED."ProjectName",
      "Board" = EXCLUDED."Board",
      "Medium" = EXCLUDED."Medium",
      "Subject" = EXCLUDED."Subject",
      "Grade" = EXCLUDED."Grade",
      "Type" = EXCLUDED."Type",
      "StartDate" = EXCLUDED."StartDate",
      "EndDate" = EXCLUDED."EndDate",
      "CreatedBy" = EXCLUDED."CreatedBy",
      "TenantId" = EXCLUDED."TenantId",
      "AcademicYear" = EXCLUDED."AcademicYear"
  `;

  const values = [
    project.ProjectId,
    project.ProjectName,
    project.Board,
    project.Medium,
    project.Subject,
    project.Grade,
    project.Type,
    startDateFormatted, // Use formatted date string
    endDateFormatted,   // Use formatted date string
    project.CreatedBy,
    project.TenantId,
    project.AcademicYear,
  ];

  await pgClient.query(query, values);
  console.log(`[PROJECT MIGRATION] ✓ Upserted project: ${project.ProjectId} - ${project.ProjectName}`);
}

/**
 * Main migration function
 */
async function migrateProjects() {
  console.log('=== STARTING PROJECT MIGRATION ===');
  
  let mongoClient;
  let pgClient;

  try {
    // Connect to MongoDB
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const mongoDbName = process.env.MONGO_DB_NAME || 'your_database';
    
    console.log(`[PROJECT MIGRATION] Connecting to MongoDB: ${mongoUrl}`);
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    console.log('[PROJECT MIGRATION] Connected to MongoDB');

    const db = mongoClient.db(mongoDbName);
    const solutionsCollection = db.collection('solutions');

    // Connect to PostgreSQL
    pgClient = new Client(dbConfig.destination);
    await pgClient.connect();
    console.log('[PROJECT MIGRATION] Connected to PostgreSQL destination');

    // Fetch all solutions from MongoDB
    console.log('[PROJECT MIGRATION] Fetching solutions from MongoDB...');
    const solutions = await solutionsCollection.find({
      deleted: { $ne: true }, // Skip deleted solutions
      isDeleted: { $ne: true }, // Skip isDeleted solutions
    }).toArray();

    console.log(`[PROJECT MIGRATION] Found ${solutions.length} solutions to migrate`);

    // Track migration stats
    let successCount = 0;
    let errorCount = 0;

    // Migrate each solution
    for (const solution of solutions) {
      try {
        const project = transformSolutionToProject(solution);
        await upsertProject(pgClient, project);
        successCount++;

        // Log progress every 100 records
        if (successCount % 100 === 0) {
          console.log(`[PROJECT MIGRATION] Progress: ${successCount}/${solutions.length} migrated`);
        }
      } catch (error) {
        errorCount++;
        console.error(`[PROJECT MIGRATION] Error migrating solution ${solution._id}:`, error.message);
        // Continue with next solution
      }
    }

    console.log('=== PROJECT MIGRATION COMPLETE ===');
    console.log(`Total solutions: ${solutions.length}`);
    console.log(`Successfully migrated: ${successCount}`);
    console.log(`Errors: ${errorCount}`);

  } catch (error) {
    console.error('[PROJECT MIGRATION] Critical error:', error);
    throw error;
  } finally {
    // Close connections
    if (mongoClient) {
      await mongoClient.close();
      console.log('[PROJECT MIGRATION] Disconnected from MongoDB');
    }
    if (pgClient) {
      await pgClient.end();
      console.log('[PROJECT MIGRATION] Disconnected from PostgreSQL');
    }
  }
}

// Run migration if executed directly
if (require.main === module) {
  console.log('Running project-migration.js directly');
  migrateProjects().catch(err => {
    console.error('Project migration failed with unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { migrateProjects };

