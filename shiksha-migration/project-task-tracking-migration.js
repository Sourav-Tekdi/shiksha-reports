const { MongoClient } = require('mongodb');
const { Client } = require('pg');
const dbConfig = require('./db');
const { v4: uuidv4 } = require('uuid');

console.log('=== Loading project-task-tracking-migration.js ===');

/**
 * PROJECT TASK TRACKING MIGRATION
 * 
 * Logic:
 * 1. Find all Project documents in MongoDB that have entityId field with a value
 * 2. For each project, go through tasks array
 * 3. Check status of both parent tasks and child tasks
 * 4. Only insert entries where status === "completed"
 * 
 * Field Mapping:
 * - ProjectTaskTrackingId: Auto-generated UUID
 * - ProjectId: solutionId (from project document)
 * - ProjectTaskId: referenceId (from task or child task)
 * - CohortId: entityId (from project document)
 * - CreatedBy: task.createdBy (if available)
 * - UpdatedBy: task.updatedBy (if available)
 */

// MongoDB connection
const mongoUrl = process.env.MONGO_URL;
const mongoDbName = process.env.MONGO_DB_NAME;

/**
 * Upsert a ProjectTaskTracking record into PostgreSQL
 */
async function upsertProjectTaskTracking(pgClient, tracking) {
  const query = `
    INSERT INTO "ProjectTaskTracking" (
      "ProjectTaskTrackingId",
      "ProjectId",
      "ProjectTaskId",
      "CohortId",
      "CreatedBy",
      "UpdatedBy",
      "CreatedAt",
      "UpdatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT ("ProjectTaskTrackingId") 
    DO UPDATE SET
      "ProjectId" = EXCLUDED."ProjectId",
      "ProjectTaskId" = EXCLUDED."ProjectTaskId",
      "CohortId" = EXCLUDED."CohortId",
      "UpdatedBy" = EXCLUDED."UpdatedBy",
      "UpdatedAt" = NOW();
  `;

  const values = [
    tracking.ProjectTaskTrackingId,
    tracking.ProjectId,
    tracking.ProjectTaskId,
    tracking.CohortId,
    tracking.CreatedBy,
    tracking.UpdatedBy,
  ];

  try {
    await pgClient.query(query, values);
  } catch (error) {
    console.error(`[TRACKING MIGRATION] Error upserting tracking ${tracking.ProjectTaskTrackingId}:`, error.message);
    throw error;
  }
}

/**
 * Check if a tracking record already exists (by ProjectId + ProjectTaskId + CohortId)
 */
async function trackingExists(pgClient, projectId, projectTaskId, cohortId) {
  const query = `
    SELECT "ProjectTaskTrackingId" 
    FROM "ProjectTaskTracking" 
    WHERE "ProjectId" = $1 AND "ProjectTaskId" = $2 AND "CohortId" = $3
  `;
  
  const result = await pgClient.query(query, [projectId, projectTaskId, cohortId]);
  return result.rows.length > 0 ? result.rows[0].ProjectTaskTrackingId : null;
}

/**
 * Process a single project and extract completed task trackings
 */
async function processProjectTracking(mongoDb, pgClient, project) {
  const projectId = project.solutionId;
  const entityId = project.entityId;

  if (!projectId) {
    console.warn(`[TRACKING MIGRATION] Project ${project._id} has no solutionId, skipping`);
    return {
      processed: 0,
      skipped: 0,
      alreadyExists: 0,
    };
  }

  if (!entityId) {
    console.warn(`[TRACKING MIGRATION] Project ${project._id} has no entityId, skipping`);
    return {
      processed: 0,
      skipped: 0,
      alreadyExists: 0,
    };
  }

  // Convert ObjectId to string if needed
  const projectIdStr = typeof projectId === 'string' ? projectId : projectId.toString();
  const entityIdStr = typeof entityId === 'string' ? entityId : entityId.toString();

  console.log(`[TRACKING MIGRATION] Processing project ${project._id} (solutionId: ${projectIdStr}, entityId: ${entityIdStr})`);

  // Step 1: Check if ProjectId exists in Project table
  const projectCheck = await pgClient.query(
    'SELECT "ProjectId" FROM "Project" WHERE "ProjectId" = $1',
    [projectIdStr]
  );

  if (projectCheck.rows.length === 0) {
    console.warn(`[TRACKING MIGRATION] ⚠️  Project ${projectIdStr} does NOT exist in Project table - skipping`);
    return {
      processed: 0,
      skipped: 0,
      alreadyExists: 0,
      missingProject: true,
    };
  }

  const tasks = project.tasks || [];
  console.log(`[TRACKING MIGRATION] Found ${tasks.length} tasks in project`);

  let processed = 0;
  let skipped = 0;
  let alreadyExists = 0;

  // Step 2: Process each task
  for (const task of tasks) {
    const taskReferenceId = task.referenceId ? task.referenceId.toString() : null;
    const taskStatus = task.status ? task.status.toLowerCase() : '';

    if (!taskReferenceId) {
      console.warn(`[TRACKING MIGRATION]   ⚠️ Parent task ${task._id} has no referenceId, skipping`);
      skipped++;
      continue;
    }

    // Check if parent task is completed
    if (taskStatus === 'completed') {
      try {
        // Check if already exists
        const existingId = await trackingExists(pgClient, projectIdStr, taskReferenceId, entityIdStr);
        
        if (existingId) {
          console.log(`[TRACKING MIGRATION]   ○ Parent task ${task.name} already tracked (${existingId})`);
          alreadyExists++;
        } else {
          // Insert parent task tracking
          const tracking = {
            ProjectTaskTrackingId: uuidv4(),
            ProjectId: projectIdStr,
            ProjectTaskId: taskReferenceId,
            CohortId: entityIdStr,
            CreatedBy: task.createdBy || null,
            UpdatedBy: task.updatedBy || null,
          };

          await upsertProjectTaskTracking(pgClient, tracking);
          processed++;
          console.log(`[TRACKING MIGRATION]   ✓ Parent task completed: ${task.name} (${taskReferenceId})`);
        }
      } catch (error) {
        skipped++;
        console.error(`[TRACKING MIGRATION]   ✗ Error with parent task ${taskReferenceId}:`, error.message);
      }
    } else {
      console.log(`[TRACKING MIGRATION]   → Parent task ${task.name} status: ${taskStatus} (not completed, skipping)`);
    }

    // Step 3: Process children tasks
    const children = task.children || [];
    if (children.length > 0) {
      console.log(`[TRACKING MIGRATION]   → Processing ${children.length} children for parent ${taskReferenceId}`);
    }

    for (const childTask of children) {
      const childReferenceId = childTask.referenceId ? childTask.referenceId.toString() : null;
      const childStatus = childTask.status ? childTask.status.toLowerCase() : '';

      if (!childReferenceId) {
        console.warn(`[TRACKING MIGRATION]     ⚠️ Child task ${childTask._id} has no referenceId, skipping`);
        skipped++;
        continue;
      }

      // Check if child task is completed
      if (childStatus === 'completed') {
        try {
          // Check if already exists
          const existingId = await trackingExists(pgClient, projectIdStr, childReferenceId, entityIdStr);
          
          if (existingId) {
            console.log(`[TRACKING MIGRATION]     ○ Child task ${childTask.name} already tracked (${existingId})`);
            alreadyExists++;
          } else {
            // Insert child task tracking
            const tracking = {
              ProjectTaskTrackingId: uuidv4(),
              ProjectId: projectIdStr,
              ProjectTaskId: childReferenceId,
              CohortId: entityIdStr,
              CreatedBy: childTask.createdBy || null,
              UpdatedBy: childTask.updatedBy || null,
            };

            await upsertProjectTaskTracking(pgClient, tracking);
            processed++;
            console.log(`[TRACKING MIGRATION]     ✓ Child task completed: ${childTask.name} (${childReferenceId})`);
          }
        } catch (error) {
          skipped++;
          console.error(`[TRACKING MIGRATION]     ✗ Error with child task ${childReferenceId}:`, error.message);
        }
      } else {
        console.log(`[TRACKING MIGRATION]     → Child task ${childTask.name} status: ${childStatus} (not completed, skipping)`);
      }
    }
  }

  console.log(`[TRACKING MIGRATION] Project ${projectIdStr} summary: Processed=${processed}, AlreadyExists=${alreadyExists}, Skipped=${skipped}`);

  return {
    processed,
    skipped,
    alreadyExists,
  };
}

/**
 * Main migration function
 */
async function migrateProjectTaskTracking() {
  let mongoClient;
  let pgClient;

  try {
    // Connect to MongoDB
    console.log(`[TRACKING MIGRATION] Connecting to MongoDB: ${mongoUrl}`);
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    console.log('[TRACKING MIGRATION] Connected to MongoDB');

    const db = mongoClient.db(mongoDbName);

    // Connect to PostgreSQL
    pgClient = new Client(dbConfig.destination);
    await pgClient.connect();
    console.log('[TRACKING MIGRATION] Connected to PostgreSQL destination');
    console.log('');

    // Step 1: Find all projects that have entityId field
    const projectsCollection = db.collection('projects');
    const projects = await projectsCollection.find({
      entityId: { $exists: true, $ne: null },
      deleted: { $ne: true },
      isDeleted: { $ne: true },
    }).toArray();

    console.log(`[TRACKING MIGRATION] Found ${projects.length} projects with entityId to process`);
    console.log('');

    // Track migration stats
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalAlreadyExists = 0;
    let projectsProcessed = 0;
    let missingProjectCount = 0;

    // Process each project
    for (const project of projects) {
      try {
        const result = await processProjectTracking(db, pgClient, project);
        totalProcessed += result.processed;
        totalSkipped += result.skipped;
        totalAlreadyExists += result.alreadyExists || 0;
        if (result.missingProject) {
          missingProjectCount++;
        }
        projectsProcessed++;

        if (projectsProcessed % 50 === 0) {
          console.log('');
          console.log(`===== Progress: ${projectsProcessed}/${projects.length} projects =====`);
          console.log(`Running totals: Processed=${totalProcessed}, AlreadyExists=${totalAlreadyExists}, Skipped=${totalSkipped}`);
          console.log('');
        }
      } catch (error) {
        console.error(`[TRACKING MIGRATION] ✗ Error processing project ${project._id}:`, error.message);
        totalSkipped++;
      }
    }

    console.log('');
    console.log('=== PROJECT TASK TRACKING MIGRATION COMPLETE ===');
    console.log(`Total projects processed: ${projectsProcessed}/${projects.length}`);
    console.log(`Total tracking records inserted: ${totalProcessed}`);
    console.log(`Total records already existed: ${totalAlreadyExists}`);
    console.log(`Total errors: ${totalSkipped}`);
    console.log('');

    if (missingProjectCount > 0) {
      console.warn('⚠️  WARNING: MISSING PROJECTS IN PROJECT TABLE');
      console.warn(`   ${missingProjectCount} projects were skipped because they don't exist in the Project table`);
      console.warn('   Please run the Project migration first: npm run start:project');
      console.warn('');
    }

  } catch (error) {
    console.error('[TRACKING MIGRATION] Migration failed:', error);
    throw error;
  } finally {
    // Close connections
    if (mongoClient) {
      await mongoClient.close();
      console.log('[TRACKING MIGRATION] MongoDB connection closed');
    }
    if (pgClient) {
      await pgClient.end();
      console.log('[TRACKING MIGRATION] PostgreSQL connection closed');
    }
  }
}

// Run migration if executed directly
if (require.main === module) {
  migrateProjectTaskTracking()
    .then(() => {
      console.log('[TRACKING MIGRATION] Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[TRACKING MIGRATION] Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateProjectTaskTracking };

