const { MongoClient, ObjectId } = require('mongodb');
const { Client } = require('pg');
const dbConfig = require('./db');

console.log('=== Loading project-task-migration.js ===');

/**
 * NEW SIMPLIFIED PROJECT TASK MIGRATION
 * 
 * Logic:
 * 1. Get all solutions from Solutions collection
 * 2. For each solution, find the FIRST project from Projects collection where solutionId matches
 * 3. Extract tasks array from the project document
 * 4. For each task in tasks array:
 *    - Insert parent task using task.referenceId as ProjectTaskId
 *    - For each child in task.children array:
 *      - Insert child task using child.referenceId as ProjectTaskId
 *      - Set child's ParentId to parent's task.referenceId
 */

// MongoDB connection (same as project-migration.js)
const mongoUrl = process.env.MONGO_URL;
const mongoDbName = process.env.MONGO_DB_NAME;

/**
 * Parse date from various formats (DD-MM-YYYY, ISO, MongoDB $date)
 */
function parseDate(dateValue) {
  if (!dateValue) return null;

  try {
    // Handle MongoDB $date object
    if (dateValue.$date) {
      const parsed = new Date(dateValue.$date);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    // Handle DD-MM-YYYY format
    if (typeof dateValue === 'string' && dateValue.includes('-')) {
      const parts = dateValue.split('-');
      if (parts.length === 3) {
        // Try DD-MM-YYYY
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
        const year = parseInt(parts[2], 10);
        
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          const parsed = new Date(year, month, day);
          // Validate the parsed date
          if (!isNaN(parsed.getTime())) {
            return parsed;
          }
        }
      }
    }

    // Try parsing as ISO string or timestamp
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    console.warn(`[TASK MIGRATION] Could not parse date: ${dateValue}`);
    return null;
  } catch (error) {
    console.warn(`[TASK MIGRATION] Error parsing date ${dateValue}:`, error.message);
    return null;
  }
}

/**
 * Format date for PostgreSQL (YYYY-MM-DD format as string)
 */
function formatDateForPostgres(date) {
  if (!date || !(date instanceof Date)) return null;
  
  // Validate the date is not invalid
  if (isNaN(date.getTime())) {
    console.warn('[TASK MIGRATION] Invalid date object, returning null');
    return null;
  }
  
  try {
    // Use toISOString and extract date part to avoid timezone issues
    const isoString = date.toISOString();
    const datePart = isoString.split('T')[0]; // Get YYYY-MM-DD
    return datePart;
  } catch (error) {
    console.warn('[TASK MIGRATION] Error formatting date for PostgreSQL:', error.message);
    return null;
  }
}

/**
 * Transform MongoDB task (parent or child) to PostgreSQL ProjectTask
 */
function transformTaskToProjectTask(task, solutionId, parentReferenceId = null) {
  // Parse dates from metaInformation
  const startDateParsed = task.metaInformation?.startDate 
    ? parseDate(task.metaInformation.startDate) 
    : null;
  const endDateParsed = task.metaInformation?.endDate 
    ? parseDate(task.metaInformation.endDate) 
    : null;

  return {
    ProjectTaskId: task.referenceId ? task.referenceId.toString() : null,
    ProjectId: solutionId,
    TaskName: task.name || null,
    ParentId: parentReferenceId,
    StartDate: formatDateForPostgres(startDateParsed),
    EndDate: formatDateForPostgres(endDateParsed),
    LearningResource: task.learningResources && task.learningResources.length > 0 
      ? JSON.stringify(task.learningResources) 
      : null,
    CreatedBy: task.createdBy || null,
    UpdatedBy: task.updatedBy || null,
  };
}

/**
 * Upsert a single ProjectTask into PostgreSQL
 */
async function upsertProjectTask(pgClient, projectTask) {
  if (!projectTask.ProjectTaskId) {
    console.warn('[TASK MIGRATION] Skipping task without ProjectTaskId (referenceId)');
    return;
  }

  const query = `
    INSERT INTO "ProjectTask" (
      "ProjectTaskId",
      "ProjectId",
      "TaskName",
      "ParentId",
      "StartDate",
      "EndDate",
      "LearningResource",
      "CreatedBy",
      "UpdatedBy",
      "CreatedAt",
      "UpdatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    ON CONFLICT ("ProjectTaskId") 
    DO UPDATE SET
      "ProjectId" = EXCLUDED."ProjectId",
      "TaskName" = EXCLUDED."TaskName",
      "ParentId" = EXCLUDED."ParentId",
      "StartDate" = EXCLUDED."StartDate",
      "EndDate" = EXCLUDED."EndDate",
      "LearningResource" = EXCLUDED."LearningResource",
      "UpdatedBy" = EXCLUDED."UpdatedBy",
      "UpdatedAt" = NOW();
  `;

  const values = [
    projectTask.ProjectTaskId,
    projectTask.ProjectId,
    projectTask.TaskName,
    projectTask.ParentId,
    projectTask.StartDate,
    projectTask.EndDate,
    projectTask.LearningResource,
    projectTask.CreatedBy,
    projectTask.UpdatedBy,
  ];

  try {
    await pgClient.query(query, values);
  } catch (error) {
    console.error(`[TASK MIGRATION] Error upserting task ${projectTask.ProjectTaskId}:`, error.message);
    throw error;
  }
}

/**
 * Process a single solution and its project tasks
 */
async function processSolutionTasks(mongoDb, pgClient, solution) {
  const solutionId = solution._id.toString();
  
  console.log(`[TASK MIGRATION] Processing solution ${solutionId}`);

  // Step 1: Check if this solution exists in PostgreSQL Project table
  const projectCheck = await pgClient.query(
    'SELECT "ProjectId" FROM "Project" WHERE "ProjectId" = $1',
    [solutionId]
  );

  if (projectCheck.rows.length === 0) {
    console.warn(`[TASK MIGRATION] ⚠️  Solution ${solutionId} does NOT exist in Project table - skipping tasks`);
    return { 
      processed: 0, 
      skipped: 0, 
      parentTasks: 0, 
      childTasks: 0,
      missingProject: true
    };
  }

  const projectsCollection = mongoDb.collection('projects');

  // Step 2: Find the FIRST project for this solutionId
  const project = await projectsCollection.findOne({
    solutionId: solution._id,
    deleted: { $ne: true },
    isDeleted: { $ne: true },
  });

  if (!project) {
    console.log(`[TASK MIGRATION] No project found for solution ${solutionId}, skipping`);
    return { 
      processed: 0, 
      skipped: 0, 
      parentTasks: 0, 
      childTasks: 0 
    };
  }

  console.log(`[TASK MIGRATION] Found project ${project._id} for solution ${solutionId}`);

  const tasks = project.tasks || [];
  console.log(`[TASK MIGRATION] Found ${tasks.length} parent tasks in project`);

  if (tasks.length === 0) {
    return { 
      processed: 0, 
      skipped: 0, 
      parentTasks: 0, 
      childTasks: 0 
    };
  }

  let processed = 0;
  let skipped = 0;
  let parentTasksProcessed = 0;
  let childTasksProcessed = 0;

  // Step 3: Process each task
  for (const task of tasks) {
    if (!task.referenceId) {
      console.warn(`[TASK MIGRATION] ⚠️ Task ${task._id} has no referenceId, skipping`);
      skipped++;
      continue;
    }

    const parentReferenceId = task.referenceId.toString();

    try {
      // Insert parent task
      const parentProjectTask = transformTaskToProjectTask(task, solutionId, null);
      await upsertProjectTask(pgClient, parentProjectTask);
      processed++;
      parentTasksProcessed++;
      console.log(`[TASK MIGRATION] ✓ Parent task: ${task.name} (referenceId: ${parentReferenceId})`);
    } catch (error) {
      skipped++;
      console.error(`[TASK MIGRATION] ✗ Error with parent task ${parentReferenceId}:`, error.message);
    }

    // Step 4: Process children tasks
    const children = task.children || [];
    console.log(`[TASK MIGRATION]   → Processing ${children.length} children for parent ${parentReferenceId}`);

    for (const childTask of children) {
      if (!childTask.referenceId) {
        console.warn(`[TASK MIGRATION]   ⚠️ Child task ${childTask._id} has no referenceId, skipping`);
        skipped++;
        continue;
      }

      const childReferenceId = childTask.referenceId.toString();

      try {
        // Insert child task with ParentId = parent's referenceId
        const childProjectTask = transformTaskToProjectTask(childTask, solutionId, parentReferenceId);
        await upsertProjectTask(pgClient, childProjectTask);
        processed++;
        childTasksProcessed++;
        console.log(`[TASK MIGRATION]   ✓ Child task: ${childTask.name} (referenceId: ${childReferenceId}, ParentId: ${parentReferenceId})`);
      } catch (error) {
        skipped++;
        console.error(`[TASK MIGRATION]   ✗ Error with child task ${childReferenceId}:`, error.message);
      }
    }
  }

  console.log(`[TASK MIGRATION] Solution ${solutionId} summary: Parents=${parentTasksProcessed}, Children=${childTasksProcessed}, Total=${processed}, Skipped=${skipped}`);
  
  return { 
    processed, 
    skipped, 
    parentTasks: parentTasksProcessed, 
    childTasks: childTasksProcessed 
  };
}

/**
 * Main migration function
 */
async function migrateProjectTasks() {
  let mongoClient;
  let pgClient;

  try {
    // Connect to MongoDB
    console.log(`[TASK MIGRATION] Connecting to MongoDB: ${mongoUrl}`);
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    console.log('[TASK MIGRATION] Connected to MongoDB');

    const db = mongoClient.db(mongoDbName);

    // Connect to PostgreSQL
    pgClient = new Client(dbConfig.destination);
    await pgClient.connect();
    console.log('[TASK MIGRATION] Connected to PostgreSQL destination');
    console.log('');

    // Step 1: Get all solutions
    const solutionsCollection = db.collection('solutions');
    const solutions = await solutionsCollection.find({
      deleted: { $ne: true },
      isDeleted: { $ne: true },
    }).toArray();

    console.log(`[TASK MIGRATION] Found ${solutions.length} solutions to process`);
    console.log('');

    // Track migration stats
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalParentTasks = 0;
    let totalChildTasks = 0;
    let solutionsProcessed = 0;
    let missingProjectCount = 0;

    // Process each solution
    for (const solution of solutions) {
      try {
        const result = await processSolutionTasks(db, pgClient, solution);
        totalProcessed += result.processed;
        totalSkipped += result.skipped;
        totalParentTasks += result.parentTasks;
        totalChildTasks += result.childTasks;
        if (result.missingProject) {
          missingProjectCount++;
        }
        solutionsProcessed++;

        if (solutionsProcessed % 10 === 0) {
          console.log('');
          console.log(`===== Progress: ${solutionsProcessed}/${solutions.length} solutions =====`);
          console.log(`Running totals: Parents=${totalParentTasks}, Children=${totalChildTasks}, Total=${totalProcessed}`);
          console.log('');
        }
      } catch (error) {
        console.error(`[TASK MIGRATION] ✗ Error processing solution ${solution._id}:`, error.message);
        totalSkipped++;
      }
    }

    console.log('');
    console.log('=== PROJECT TASK MIGRATION COMPLETE ===');
    console.log(`Total solutions processed: ${solutionsProcessed}/${solutions.length}`);
    console.log(`Total parent tasks migrated: ${totalParentTasks}`);
    console.log(`Total child tasks migrated: ${totalChildTasks}`);
    console.log(`Total tasks migrated: ${totalProcessed} (Parents + Children)`);
    console.log(`Total errors: ${totalSkipped}`);
    console.log('');
    
    if (missingProjectCount > 0) {
      console.warn('⚠️  WARNING: MISSING PROJECTS IN PROJECT TABLE');
      console.warn(`   ${missingProjectCount} solutions were skipped because they don't exist in the Project table`);
      console.warn('   Please run the Project migration first: npm run start:project');
      console.warn('');
    }

  } catch (error) {
    console.error('[TASK MIGRATION] Migration failed:', error);
    throw error;
  } finally {
    // Close connections
    if (mongoClient) {
      await mongoClient.close();
      console.log('[TASK MIGRATION] MongoDB connection closed');
    }
    if (pgClient) {
      await pgClient.end();
      console.log('[TASK MIGRATION] PostgreSQL connection closed');
    }
  }
}

// Run migration if executed directly
if (require.main === module) {
  migrateProjectTasks()
    .then(() => {
      console.log('[TASK MIGRATION] Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[TASK MIGRATION] Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateProjectTasks };
