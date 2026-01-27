# Cohort Migration Cron Job

## Overview

The Cohort Migration Cron Job automatically migrates cohort data from the source database to the destination database on a daily basis.

## Schedule

- **Cron Expression**: `35 18 * * *`
- **IST Time**: 12:05 AM (Midnight + 5 minutes)
- **UTC Time**: 6:35 PM (18:35)
- **Frequency**: Daily

## Features

### Automatic Migration
- Runs automatically every day at 12:05 AM IST
- Migrates all cohorts created on the current date
- Handles both Centers (parent cohorts) and Batches (child cohorts)

### Data Transformation
1. **Center Types**:
   - `regular` → `regularCenter`
   - `remote` → `remoteCenter`

2. **Batch Types** (automatically determined by parent type):
   - If parent is `regular` or `regularCenter` → `regularBatch`
   - If parent is `remote` or `remoteCenter` → `remoteBatch`

3. **Field Mapping**:
   - State, District, Block, Village
   - Board, Subject, Grade, Medium
   - Industry, Google Map Link
   - Other custom fields

## API Endpoints

### 1. Manual Trigger

Manually trigger the cohort migration process.

**Endpoint**: `POST /cron/cohort-migration/trigger`

**Request**:
```bash
curl -X POST http://localhost:3000/cron/cohort-migration/trigger
```

**Response** (Success):
```json
{
  "message": "Cohort migration executed successfully",
  "timestamp": "2026-01-16T06:35:00.000Z"
}
```

**Response** (Error):
```json
{
  "message": "Failed to execute cohort migration",
  "error": "Error details here"
}
```

### 2. Check Cron Job Status

Get the overall status of all cron jobs.

**Endpoint**: `GET /cron/status`

**Request**:
```bash
curl http://localhost:3000/cron/status
```

**Response**:
```json
{
  "isRunning": false,
  "totalExecutions": 45,
  "successfulExecutions": 43,
  "failedExecutions": 2,
  "lastExecution": "2026-01-16T00:05:00.000Z",
  "lastSuccess": "2026-01-16T00:05:30.000Z",
  "lastError": null
}
```

### 3. Health Check

Check the health status of the cron job service.

**Endpoint**: `GET /cron/health`

**Request**:
```bash
curl http://localhost:3000/cron/health
```

**Response**:
```json
{
  "status": "healthy",
  "details": {
    "service": "CronJobService",
    "uptime": 3600,
    "lastExecution": "2026-01-16T00:05:00.000Z"
  }
}
```

## Implementation Details

### Location

- **Service**: `src/services/cron-job.service.ts`
  - Method: `executeCohortMigrationJob()` - Scheduled cron job
  - Method: `triggerCohortMigration()` - Manual trigger
  - Method: `migrateCohorts()` - Core migration logic

- **Controller**: `src/controllers/cron-job.controller.ts`
  - Endpoint: `POST /cron/cohort-migration/trigger`

- **Migration Script**: `shiksha-migration/cohort-migration.js`
  - Contains the core migration logic
  - Can still be run standalone: `node cohort-migration.js`

### Migration Process

1. **Connect to Databases**
   - Source: Read cohort data
   - Destination: Write transformed data

2. **Fetch Cohorts**
   - Filter by current date (`createdAt::date = today`)
   - Order by creation time (centers before batches)

3. **Process Each Cohort**
   - Upsert core cohort record (CohortID, TenantID, CohortName, etc.)
   - Process field values (Type, Location, Board, Medium, etc.)
   - Apply transformations based on parent-child relationships

4. **Type Transformations**
   - Centers: Apply center type transformation
   - Batches: Look up parent type and apply batch type transformation

5. **Disconnect and Log**
   - Close database connections
   - Log completion status

## Configuration

### Environment Variables

Required in `.env` file:

```env
# Source Database (where we READ cohort data from)
SOURCE_DB_USER=your_source_user
SOURCE_DB_PASSWORD=your_source_password
SOURCE_DB_HOST=your_source_host
SOURCE_DB_PORT=5432
SOURCE_DB_NAME=your_source_database

# Destination Database (where we WRITE transformed data to)
DEST_DB_USER=your_dest_user
DEST_DB_PASSWORD=your_dest_password
DEST_DB_HOST=your_dest_host
DEST_DB_PORT=5555
DEST_DB_NAME=your_dest_database
```

### Database Configuration

Located in: `shiksha-migration/db.js`

```javascript
const dbConfig = {
  source: {
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME
  },
  destination: {
    user: process.env.DEST_DB_USER,
    password: process.env.DEST_DB_PASSWORD,
    host: process.env.DEST_DB_HOST,
    port: parseInt(process.env.DEST_DB_PORT || '5555'),
    database: process.env.DEST_DB_NAME
  }
};
```

## Logging

The cron job uses structured logging with the following levels:

- **INFO**: General execution flow, start/complete messages
- **DEBUG**: Detailed processing information for each cohort
- **WARN**: Skipped executions, potential issues
- **ERROR**: Migration failures, database errors

### Log Examples

```
[CronJobService] Starting CohortMigration cron job execution
[CronJobService] 📅 Filter: Only migrating cohorts created on: 2026-01-16
[CronJobService] Connected to source database
[CronJobService] Connected to destination database
[CronJobService] Found 150 cohorts to migrate (created on 2026-01-16)
[CronJobService] Core upsert done for CohortID=abc-123
[CronJobService] Type transformation for cohort abc-123: remote -> remoteCenter
[CronJobService] Field values updated for CohortID=abc-123
[CronJobService] All cohorts processed successfully
[CronJobService] CohortMigration cron job completed successfully
```

## Testing

### 1. Test Manual Trigger

```bash
# Trigger migration manually
curl -X POST http://localhost:3000/cron/cohort-migration/trigger

# Check logs for execution details
# Check destination database for migrated records
```

### 2. Test Scheduled Execution

```bash
# Wait for scheduled time (12:05 AM IST)
# Or temporarily change cron expression for testing
# Check logs at scheduled time
# Verify records in destination database
```

### 3. Verify Transformations

```sql
-- Check center types
SELECT "CohortID", "CohortName", "Type", "ParentID"
FROM "Cohort"
WHERE "Type" IN ('regularCenter', 'remoteCenter')
  AND "CreatedOn"::date = CURRENT_DATE;

-- Check batch types
SELECT c."CohortID", c."CohortName", c."Type", c."ParentID", p."Type" as "ParentType"
FROM "Cohort" c
JOIN "Cohort" p ON c."ParentID" = p."CohortID"
WHERE c."Type" IN ('regularBatch', 'remoteBatch')
  AND c."CreatedOn"::date = CURRENT_DATE;
```

## Troubleshooting

### Migration Not Running

1. Check if cron job service is enabled
2. Verify database connection credentials
3. Check application logs for errors
4. Ensure proper timezone configuration

### No Records Migrated

1. Verify records exist in source database for today's date
2. Check date filter logic
3. Verify database connectivity
4. Check source database timezone settings

### Type Transformation Issues

1. Verify parent cohort exists and has type field
2. Check `COHORT_FIELD_ID_TO_COLUMN` mappings
3. Verify `transformCohortType` logic
4. Check logs for transformation details

### Manual Trigger Fails

1. Check API endpoint is accessible
2. Verify authentication (if enabled)
3. Check application logs for detailed error
4. Ensure no concurrent migration is running

## Maintenance

### Updating Cron Schedule

To change the cron schedule, modify the decorator in `cron-job.service.ts`:

```typescript
@Cron('35 18 * * *') // Current: 12:05 AM IST
async executeCohortMigrationJob() {
  // ...
}
```

### Adding New Field Mappings

Update `COHORT_FIELD_ID_TO_COLUMN` in `cohort-migration.js`:

```javascript
const COHORT_FIELD_ID_TO_COLUMN = {
  'field-uuid-here': 'DestinationColumnName',
  // Add new mappings here
};
```

### Modifying Transformation Logic

Update `transformCohortType` function in `cohort-migration.js`:

```javascript
function transformCohortType(originalType, hasParent, parentType = null) {
  // Add custom transformation logic here
}
```

## Security Considerations

1. **Database Credentials**: Store in `.env` file, never commit to version control
2. **API Access**: Consider adding authentication to manual trigger endpoint
3. **Logging**: Avoid logging sensitive data (passwords, PII)
4. **Error Handling**: Ensure errors don't expose sensitive information

## Performance

- **Batch Size**: Processes one cohort at a time
- **Concurrent Execution**: Prevented by `isRunning` flag
- **Database Connections**: Properly closed after execution
- **Optimization**: Consider batch inserts for large datasets

## Support

For issues or questions:
1. Check application logs
2. Review this documentation
3. Check database connection configuration
4. Contact development team

