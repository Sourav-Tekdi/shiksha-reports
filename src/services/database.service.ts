import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

import { DailyAttendanceReport } from 'src/entities/daily-attendance-report.entity';
import { Event } from 'src/entities/event.entity';
import { CohortMember } from 'src/entities/cohort-member.entity';
import { Cohort } from 'src/entities/cohort.entity';
import { AttendanceTracker } from 'src/entities/attendance-tracker.entity';
import { AssessmentTracker } from 'src/entities/assessment-tracker.entity';
import { CourseTracker } from 'src/entities/course-tracker.entity';
import { ContentTracker } from 'src/entities/content-tracker.entity';
import { RegistrationTracker } from 'src/entities/registration-tracker.entity';
import { Project } from 'src/entities/project.entity';
import { ProjectTask } from 'src/entities/projectTask.entity';
import { ProjectTaskTracking } from 'src/entities/projectTaskTracking.entity';

@Injectable()
export class DatabaseService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(DailyAttendanceReport)
    private dailyAttendanceRepo: Repository<DailyAttendanceReport>,
    @InjectRepository(Event)
    private eventRepo: Repository<Event>,
    @InjectRepository(CohortMember)
    private cohortMemberRepo: Repository<CohortMember>,
    @InjectRepository(Cohort)
    private cohortNewRepo: Repository<Cohort>,
    @InjectRepository(AttendanceTracker)
    private attendanceTrackerRepo: Repository<AttendanceTracker>,
    @InjectRepository(AssessmentTracker)
    private assessmentTrackerRepo: Repository<AssessmentTracker>,
    @InjectRepository(CourseTracker)
    private courseTrackerRepo: Repository<CourseTracker>,
    @InjectRepository(ContentTracker)
    private contentTrackerRepo: Repository<ContentTracker>,
    @InjectRepository(RegistrationTracker)
    private registrationTrackerRepo: Repository<RegistrationTracker>,
    @InjectRepository(Project)
    private projectRepo: Repository<Project>,
    @InjectRepository(ProjectTask)
    private projectTaskRepo: Repository<ProjectTask>,
    @InjectRepository(ProjectTaskTracking)
    private projectTaskTrackingRepo: Repository<ProjectTaskTracking>,
  ) {}

  private readonly logger = new Logger(DatabaseService.name);

  private cohortMemberColumnTypeCache: Record<string, { isArray: boolean }> | null = null;

  private async loadCohortMemberColumnTypes(schema: string, tableName: string, columns: string[]) {
    if (this.cohortMemberColumnTypeCache) return this.cohortMemberColumnTypeCache;
    const placeholders = columns.map((_, idx) => `$${idx + 3}`).join(',');
    const sql = `SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name IN (${placeholders})`;
    try {
      const result = await this.cohortMemberRepo.query(sql, [schema, tableName, ...columns]);
      const map: Record<string, { isArray: boolean }> = {};
      for (const row of result) {
        const col = row.column_name as string;
        const isArray = (row.data_type === 'ARRAY') || (typeof row.udt_name === 'string' && row.udt_name.endsWith('[]'));
        map[col] = { isArray };
      }
      this.cohortMemberColumnTypeCache = map;
      return map;
    } catch (err) {
      this.logger.warn(`Failed to read column types for ${schema}.${tableName}: ${err?.message}`);
      // Fallback: assume non-array
      const map: Record<string, { isArray: boolean }> = {};
      for (const c of columns) map[c] = { isArray: false };
      this.cohortMemberColumnTypeCache = map;
      return map;
    }
  }

  private toArrayLiteral(values: string[]): string {
    const escape = (s: string) => s.replace(/"/g, '\\"');
    return `{${values.map((v) => `"${escape(v)}"`).join(',')}}`;
  }

  private normalizeValueForColumn(
    column: string,
    value: any,
    isArray: boolean,
  ): string | null {
    if (value == null) return null;
    // Return value as-is, without any transformation
    // This preserves the original format from the event (e.g., "na", ["item1", "item2"], etc)
    return String(value);
  }

  async saveUserProfileData(data: any) {
    return this.userRepo.save(data);
  }

  async deleteUserProfileData(data: any) {
    return this.userRepo.delete(data);
  }



  async saveDailyAttendanceData(data: any) {
    return this.dailyAttendanceRepo.save(data);
  }

  async deleteDailyAttendanceData(data: any) {
    return this.dailyAttendanceRepo.delete(data);
  }



  async saveEventData(data: any) {
    return this.eventRepo.save(data);
  }

  async deleteEventData(data: { eventDetailId: string }) {
    const { eventDetailId } = data;
    return this.eventRepo.delete({ eventDetailId });
  }

  async saveCohortMemberData(data: any) {
    return this.cohortMemberRepo.save(data);
  }

  async deleteCohortMemberData(data: any) {
    return this.cohortMemberRepo.delete(data);
  }

  async findCohortMember(userId: string, cohortId: string) {
    return this.cohortMemberRepo.findOne({
      where: { UserID: userId, CohortID: cohortId },
    });
  }

  async findCohortMemberById(cohortMembershipId: string) {
    return this.cohortMemberRepo.findOne({
      where: { CohortMemberID: cohortMembershipId },
    });
  }

  async createCohortMemberWithId(params: {
    cohortMembershipId: string;
    userId: string;
    cohortId: string;
    status?: string;
    academicYearId?: string;
  }) {
    const payload: Partial<CohortMember> = {
      CohortMemberID: params.cohortMembershipId as any,
      UserID: params.userId,
      CohortID: params.cohortId,
      MemberStatus: params.status ?? 'active',
      AcademicYearID: params.academicYearId,
    } as any;
    return this.cohortMemberRepo.save(payload);
  }

  async updateCohortMemberStatus(
    userId: string,
    cohortId: string,
    status: string,
  ) {
    return this.cohortMemberRepo.update(
      { UserID: userId, CohortID: cohortId },
      { MemberStatus: status },
    );
  }

  async updateCohortMemberCustomFieldsById(
    cohortMembershipId: string,
    updates: Record<string, string | null | undefined>,
  ) {
    // Only allow specific columns to be updated
    const allowed = new Set(['Subject', 'Fees', 'Registration', 'Board', 'MemberStatus']);
    const entries = Object.entries(updates).filter(([k, v]) =>
      allowed.has(k),
    );

    if (entries.length === 0) {
      return { affected: 0 } as any;
    }

    // Build dynamic SET clause using parameterized query
    const setFragments: string[] = [];
    const params: any[] = [];

    const { schema, tableName } = this.cohortMemberRepo.metadata as any;
    const effectiveSchema = schema && schema.length > 0 ? schema : 'public';
    const colTypes = await this.loadCohortMemberColumnTypes(effectiveSchema, 'CohortMember', entries.map(([c]) => c));

    entries.forEach(([column, value], idx) => {
      const isArrayColumn = colTypes[column]?.isArray ?? false;
      
      if (isArrayColumn) {
        // For array columns, wrap the value in PostgreSQL array literal format
        // Store the original value as a single-element array to preserve it exactly as received
        if (value == null) {
          setFragments.push(`"${column}" = $${idx + 1}`);
          params.push(null);
        } else {
          setFragments.push(`"${column}" = $${idx + 1}`);
          // Wrap the value in a single-element array
          params.push(this.toArrayLiteral([String(value)]));
        }
      } else {
        setFragments.push(`"${column}" = $${idx + 1}`);
        // Store value as-is for non-array columns
        params.push(value);
      }
    });

    params.push(cohortMembershipId);

    // Use metadata and quote identifiers to preserve case/schema
    // schema already resolved above
    const fullTable = `"${effectiveSchema}"."${tableName}"`;
    const sql = `UPDATE ${fullTable}
      SET ${setFragments.join(', ')}
      WHERE "CohortMemberID"::text = $${params.length}`;

    // Detailed debug
    this.logger.debug(
      `Updating CohortMember fields | table=${fullTable} | cohortMembershipId=${cohortMembershipId} | keys=${entries
        .map(([k]) => k)
        .join(',')} | paramsCount=${params.length}`,
    );

    try {
      const result = await this.cohortMemberRepo.query(sql, params);
      this.logger.debug(
        `Update result for ${cohortMembershipId}: ${JSON.stringify(result)}`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `Query failed updating CohortMember | table=${fullTable} | sql=${sql} | error=${err?.message}`,
      );
      throw err;
    }
  }

  async upsertCohortMemberData(cohortMemberData: Partial<CohortMember>) {
    try {
      // Check if a record with the same UserId and CohortID already exists
      const existingMember = await this.cohortMemberRepo.findOne({
        where: {
          UserID: cohortMemberData.UserID,
          CohortID: cohortMemberData.CohortID,
        },
      });

      if (existingMember) {
        // Check if all fields are exactly the same
        const allFieldsSame =
          existingMember.UserID === cohortMemberData.UserID &&
          existingMember.CohortID === cohortMemberData.CohortID &&
          existingMember.MemberStatus === cohortMemberData.MemberStatus &&
          existingMember.AcademicYearID === cohortMemberData.AcademicYearID;

        if (allFieldsSame) {
          console.log(
            `[DatabaseService] User ${cohortMemberData.UserID} is already assigned to cohort ${cohortMemberData.CohortID} with the same status. No changes needed.`,
          );
          return { action: 'no_change', data: existingMember };
        }

        // If UserId and CohortID are same but other fields are different, update
        console.log(
          `[DatabaseService] Updating cohort member status for user ${cohortMemberData.UserID} in cohort ${cohortMemberData.CohortID}`,
        );
        await this.cohortMemberRepo.update(
          {
            UserID: cohortMemberData.UserID,
            CohortID: cohortMemberData.CohortID,
          },
          {
            MemberStatus: cohortMemberData.MemberStatus,
            AcademicYearID: cohortMemberData.AcademicYearID,
          },
        );

        // Return the updated record
        const updatedMember = await this.cohortMemberRepo.findOne({
          where: {
            UserID: cohortMemberData.UserID,
            CohortID: cohortMemberData.CohortID,
          },
        });

        return { action: 'updated', data: updatedMember };
      } else {
        // If no existing record, insert new one
        console.log(
          `[DatabaseService] Creating new cohort member entry for user ${cohortMemberData.UserID} in cohort ${cohortMemberData.CohortID}`,
        );
        const newMember = await this.cohortMemberRepo.save(cohortMemberData);
        return { action: 'created', data: newMember };
      }
    } catch (error) {
      console.error('Error in upsertCohortMemberData:', error);
      throw error;
    }
  }

  async saveCohortData(data: any) {
    return this.cohortNewRepo.save(data);
  }

  async deleteCohortData(data: any) {
    return this.cohortNewRepo.delete(data);
  }

  async findCohort(cohortId: string) {
    return this.cohortNewRepo.findOne({
      where: { cohortId },
    });
  }

  async upsertAttendanceTracker(
    attendanceData: Partial<AttendanceTracker>,
    dayColumn: string,
    attendanceValue: string,
  ) {
    try {
      // Use database-level upsert with ON CONFLICT to avoid race conditions
      const baseRecord = {
        ...attendanceData,
        [dayColumn]: attendanceValue,
      };

      // Try to insert first, if conflict occurs, update
      const result = await this.attendanceTrackerRepo
        .createQueryBuilder()
        .insert()
        .into(AttendanceTracker)
        .values(baseRecord)
        .orUpdate(
          [dayColumn],
          ['tenantId', 'userId', 'year', 'month', 'contextId'],
        )
        .execute();

      return result;
    } catch (error) {
      // Fallback to the original method if the database doesn't support UPSERT
      const existingRecord = await this.attendanceTrackerRepo.findOne({
        where: {
          tenantId: attendanceData.tenantId,
          userId: attendanceData.userId,
          year: attendanceData.year,
          month: attendanceData.month,
          ...(attendanceData.contextId && {
            contextId: attendanceData.contextId,
          }),
        },
      });

      if (existingRecord) {
        const updateData = { [dayColumn]: attendanceValue };
        return this.attendanceTrackerRepo.update(
          existingRecord.atndId,
          updateData,
        );
      } else {
        const newRecord = { ...attendanceData, [dayColumn]: attendanceValue };
        return this.attendanceTrackerRepo.save(newRecord);
      }
    }
  }

  async findAttendanceTracker(
    tenantId: string,
    userId: string,
    year: number,
    month: number,
    contextId?: string,
  ) {
    const whereCondition: any = {
      tenantId,
      userId,
      year,
      month,
    };

    if (contextId) {
      whereCondition.contextId = contextId;
    }

    return this.attendanceTrackerRepo.findOne({
      where: whereCondition,
    });
  }

  async saveAttendanceTrackerData(data: any) {
    return this.attendanceTrackerRepo.save(data);
  }

  async deleteAttendanceTrackerData(data: any) {
    return this.attendanceTrackerRepo.delete(data);
  }

  async saveAssessmentTrackerData(data: any) {
    return this.assessmentTrackerRepo.save(data);
  }

  async deleteAssessmentTrackerData(data: any) {
    return this.assessmentTrackerRepo.delete(data);
  }

  async findAssessmentTracker(assessTrackingId: string) {
    return this.assessmentTrackerRepo.findOne({
      where: { assessTrackingId },
    });
  }

  async upsertAssessmentTracker(assessmentData: Partial<AssessmentTracker>) {
    try {
      // Use database-level upsert with ON CONFLICT to avoid race conditions
      const result = await this.assessmentTrackerRepo
        .createQueryBuilder()
        .insert()
        .into(AssessmentTracker)
        .values(assessmentData)
        .orUpdate(
          [
            'totalMaxScore',
            'totalScore',
            'timeSpent',
            'assessmentSummary',
            'assessmentType',
            'evaluatedBy',
          ],
          ['assessTrackingId'],
        )
        .execute();

      return result;
    } catch (error) {
      // Fallback to the original method if the database doesn't support UPSERT
      const existingAssessment = await this.assessmentTrackerRepo.findOne({
        where: { assessTrackingId: assessmentData.assessTrackingId },
      });

      if (existingAssessment) {
        return this.assessmentTrackerRepo.update(
          { assessTrackingId: assessmentData.assessTrackingId },
          assessmentData,
        );
      } else {
        return this.assessmentTrackerRepo.save(assessmentData);
      }
    }
  }

  async saveCourseTrackerData(data: any) {
    return this.courseTrackerRepo.save(data);
  }

  async deleteCourseTrackerData(data: any) {
    return this.courseTrackerRepo.delete(data);
  }

  async findCourseTracker(
    userId: string,
    courseId: string,
    tenantId: string,
    certificateId: string,
  ) {
    return this.courseTrackerRepo.findOne({
      where: {
        userId,
        courseId,
        tenantId,
        certificateId,
      },
    });
  }

  async upsertCourseTracker(courseTrackerData: Partial<CourseTracker>) {
    try {
      // Use database-level upsert with ON CONFLICT to avoid race conditions
      const result = await this.courseTrackerRepo
        .createQueryBuilder()
        .insert()
        .into(CourseTracker)
        .values(courseTrackerData)
        .orUpdate(
          [
            'courseName',
            'courseTrackingStatus',
            'courseTrackingStartDate',
            'courseTrackingEndDate',
          ],
          ['userId', 'courseId', 'tenantId', 'certificateId'],
        )
        .execute();

      return result;
    } catch (error) {
      // Fallback to the original method if the database doesn't support UPSERT
      const existingTracker = await this.courseTrackerRepo.findOne({
        where: {
          userId: courseTrackerData.userId,
          courseId: courseTrackerData.courseId,
          tenantId: courseTrackerData.tenantId,
          certificateId: courseTrackerData.certificateId,
        },
      });

      if (existingTracker) {
        return this.courseTrackerRepo.update(
          {
            userId: courseTrackerData.userId,
            courseId: courseTrackerData.courseId,
            tenantId: courseTrackerData.tenantId,
            certificateId: courseTrackerData.certificateId,
          },
          courseTrackerData,
        );
      } else {
        return this.courseTrackerRepo.save(courseTrackerData);
      }
    }
  }

  async saveContentTrackerData(data: any) {
    return this.contentTrackerRepo.save(data);
  }

  async deleteContentTrackerData(data: any) {
    return this.contentTrackerRepo.delete(data);
  }

  async findContentTracker(
    userId: string,
    contentId: string,
    tenantId: string,
  ) {
    return this.contentTrackerRepo.findOne({
      where: {
        userId,
        contentId,
        tenantId,
      },
    });
  }

  async upsertContentTracker(contentTrackerData: Partial<ContentTracker>) {
    try {
      // Set updatedAt timestamp
      contentTrackerData.updatedAt = new Date();

      // Use database-level upsert with ON CONFLICT to avoid race conditions
      const result = await this.contentTrackerRepo
        .createQueryBuilder()
        .insert()
        .into(ContentTracker)
        .values(contentTrackerData)
        .orUpdate(
          [
            'contentName',
            'contentType',
            'contentTrackingStatus',
            'timeSpent',
            'updatedAt',
          ],
          ['userId', 'contentId', 'tenantId'],
        )
        .execute();

      return result;
    } catch (error) {
      // Fallback to the original method if the database doesn't support UPSERT
      try {
        const existingTracker = await this.contentTrackerRepo.findOne({
          where: {
            userId: contentTrackerData.userId,
            contentId: contentTrackerData.contentId,
            tenantId: contentTrackerData.tenantId,
          },
        });

        if (existingTracker) {
          // Only update if status is different or time spent has changed
          if (
            existingTracker.contentTrackingStatus !==
              contentTrackerData.contentTrackingStatus ||
            existingTracker.timeSpent !== contentTrackerData.timeSpent
          ) {
            const updateResult = await this.contentTrackerRepo.update(
              {
                userId: contentTrackerData.userId,
                contentId: contentTrackerData.contentId,
                tenantId: contentTrackerData.tenantId,
              },
              contentTrackerData,
            );
            return updateResult;
          } else {
            return { affected: 0 };
          }
        } else {
          const saveResult =
            await this.contentTrackerRepo.save(contentTrackerData);
          return saveResult;
        }
      } catch (fallbackError) {
        throw fallbackError;
      }
    }
  }

  // Registration Tracker methods
  async saveRegistrationTrackerData(data: Partial<RegistrationTracker>) {
    return this.registrationTrackerRepo.save(data);
  }

  async findRegistrationTracker(userId: string, tenantId: string) {
    return this.registrationTrackerRepo.findOne({
      where: { userId, tenantId }
    });
  }

  async upsertRegistrationTracker(registrationData: Partial<RegistrationTracker>) {
    try {
      // If roleId is provided, use it in the conflict key
      if (registrationData.roleId) {
        // Use database-level upsert with ON CONFLICT to avoid race conditions
        const result = await this.registrationTrackerRepo
          .createQueryBuilder()
          .insert()
          .into(RegistrationTracker)
          .values(registrationData)
          .orUpdate(['platformRegnDate', 'tenantRegnDate', 'isActive', 'Reason'], ['userId', 'tenantId', 'roleId'])
          .execute();

        return result;
      } else {
        // If roleId is not provided, update all records matching userId and tenantId
        // First, find all existing records
        const existingRecords = await this.registrationTrackerRepo.find({
          where: { 
            userId: registrationData.userId,
            tenantId: registrationData.tenantId
          }
        });

        if (existingRecords && existingRecords.length > 0) {
          // Update all matching records
          const updateData: Partial<RegistrationTracker> = {
            isActive: registrationData.isActive,
            tenantRegnDate: registrationData.tenantRegnDate,
            reason: registrationData.reason,
          };
          
          // Only update platformRegnDate if provided
          if (registrationData.platformRegnDate) {
            updateData.platformRegnDate = registrationData.platformRegnDate;
          }

          // Update all matching records
          await this.registrationTrackerRepo.update(
            { 
              userId: registrationData.userId,
              tenantId: registrationData.tenantId
            },
            updateData
          );

          return { affected: existingRecords.length };
        } else {
          // No existing records found, cannot insert without roleId
          throw new Error('Cannot create registration tracker without roleId. No existing records found to update.');
        }
      }
    } catch (error) {
      // Fallback to the original method if the database doesn't support UPSERT
      if (registrationData.roleId) {
        const existingRecord = await this.registrationTrackerRepo.findOne({
          where: { 
            userId: registrationData.userId,
            tenantId: registrationData.tenantId,
            roleId: registrationData.roleId
          }
        });

        if (existingRecord) {
          return this.registrationTrackerRepo.update(
            { 
              userId: registrationData.userId,
              tenantId: registrationData.tenantId,
              roleId: registrationData.roleId
            },
            registrationData
          );
        } else {
          return this.registrationTrackerRepo.save(registrationData);
        }
      } else {
        // Fallback for updates without roleId
        const existingRecords = await this.registrationTrackerRepo.find({
          where: { 
            userId: registrationData.userId,
            tenantId: registrationData.tenantId
          }
        });

        if (existingRecords && existingRecords.length > 0) {
          const updateData: Partial<RegistrationTracker> = {
            isActive: registrationData.isActive,
            tenantRegnDate: registrationData.tenantRegnDate,
            reason: registrationData.reason,
          };
          
          if (registrationData.platformRegnDate) {
            updateData.platformRegnDate = registrationData.platformRegnDate;
          }

          return this.registrationTrackerRepo.update(
            { 
              userId: registrationData.userId,
              tenantId: registrationData.tenantId
            },
            updateData
          );
        } else {
          throw new Error('Cannot create registration tracker without roleId. No existing records found to update.');
        }
      }
    }
  }


  async updateCourseTrackerStatus(
    params: {
      tenantId: string;
      userId: string;
      courseId: string;
    },
    update: {
      status?: string;
      completedOn?: Date | string | null;
      createdOn?: Date | string | null;
      certificateId?: string | null;
    },
  ) {
    // WHERE condition uses only tenantId, userId, and courseId
    const whereCondition = {
      tenantId: params.tenantId,
      userId: params.userId,
      courseId: params.courseId,
    };

    const existing = await this.courseTrackerRepo.findOne({ where: whereCondition });

    if (!existing) {
      return { affected: 0 };
    }

    // Build update payload with all fields
    const updatePayload: Partial<CourseTracker> = {};
    
    if (update.status !== undefined) {
      updatePayload.courseTrackingStatus = update.status;
    }
    
    if (update.createdOn !== undefined && update.createdOn !== null) {
      updatePayload.courseTrackingStartDate = new Date(update.createdOn);
    }
    
    if (update.completedOn !== undefined) {
      updatePayload.courseTrackingEndDate = update.completedOn
        ? new Date(update.completedOn)
        : null as any;
    }
    
    if (update.certificateId !== undefined) {
      updatePayload.certificateId = update.certificateId || null;
    }

    return this.courseTrackerRepo.update(existing.courseTrackerId, updatePayload);
  }

  async updateUserLastLogin(data: { userId: string; lastLogin?: string | Date }) {
    try {
      const { userId, lastLogin } = data;
      
      // Convert lastLogin to Date if it's a string
      const lastLoginDate = lastLogin 
        ? (typeof lastLogin === 'string' ? new Date(lastLogin) : lastLogin)
        : new Date(); // Default to current timestamp if not provided
      
      // Update the user's last login timestamp
      return this.userRepo.update(
        { userId },
        { userLastLogin: lastLoginDate }
      );
    } catch (error) {
      console.error('Error updating user last login:', error);
      throw error;
    }
  }

  // Project methods
  async saveProjectData(data: Partial<Project>) {
    return this.projectRepo.save(data);
  }

  async findProject(projectId: string) {
    return this.projectRepo.findOne({
      where: { ProjectId: projectId },
    });
  }

  async upsertProject(projectData: Partial<Project>) {
    try {
      // Use database-level upsert with ON CONFLICT
      const result = await this.projectRepo
        .createQueryBuilder()
        .insert()
        .into(Project)
        .values(projectData)
        .orUpdate(
          [
            'ProjectName',
            'Board',
            'Medium',
            'Subject',
            'Grade',
            'Type',
            'StartDate',
            'EndDate',
            'CreatedBy',
          ],
          ['ProjectId'],
        )
        .execute();

      this.logger.log(
        `[DatabaseService] Project upserted: ProjectId=${projectData.ProjectId}`,
      );

      return result;
    } catch (error) {
      // Fallback to find and update if database doesn't support UPSERT
      const existingProject = await this.projectRepo.findOne({
        where: { ProjectId: projectData.ProjectId },
      });

      if (existingProject) {
        this.logger.log(
          `[DatabaseService] Updating existing project: ProjectId=${projectData.ProjectId}`,
        );
        return this.projectRepo.update(
          { ProjectId: projectData.ProjectId },
          projectData,
        );
      } else {
        this.logger.log(
          `[DatabaseService] Creating new project: ProjectId=${projectData.ProjectId}`,
        );
        return this.projectRepo.save(projectData);
      }
    }
  }

  // ProjectTask methods
  async saveProjectTaskData(data: Partial<ProjectTask>) {
    return this.projectTaskRepo.save(data);
  }

  async findProjectTask(projectTaskId: string) {
    return this.projectTaskRepo.findOne({
      where: { ProjectTaskId: projectTaskId },
    });
  }

  async getProjectTasksByProjectId(projectId: string): Promise<ProjectTask[]> {
    return this.projectTaskRepo.find({
      where: { ProjectId: projectId },
    });
  }

  async deleteProjectTasks(taskIds: string[]) {
    if (!taskIds || taskIds.length === 0) {
      return { affected: 0 };
    }
    this.logger.log(
      `[DatabaseService] Deleting ${taskIds.length} project tasks`,
    );
    return this.projectTaskRepo.delete(taskIds);
  }

  async upsertProjectTask(taskData: Partial<ProjectTask>) {
    try {
      // Use database-level upsert with ON CONFLICT
      const result = await this.projectTaskRepo
        .createQueryBuilder()
        .insert()
        .into(ProjectTask)
        .values(taskData)
        .orUpdate(
          [
            'ProjectId',
            'TaskName',
            'ParentId',
            'StartDate',
            'EndDate',
            'LearningResource',
            'CreatedBy',
            'UpdatedBy',
          ],
          ['ProjectTaskId'],
        )
        .execute();

      return result;
    } catch (error) {
      // Fallback to find and update if database doesn't support UPSERT
      const existingTask = await this.projectTaskRepo.findOne({
        where: { ProjectTaskId: taskData.ProjectTaskId },
      });

      if (existingTask) {
        return this.projectTaskRepo.update(
          { ProjectTaskId: taskData.ProjectTaskId },
          taskData,
        );
      } else {
        return this.projectTaskRepo.save(taskData);
      }
    }
  }

  async upsertProjectTasks(tasksData: Partial<ProjectTask>[]) {
    try {
      if (!tasksData || tasksData.length === 0) {
        this.logger.warn('[DatabaseService] No project tasks to upsert');
        return { success: true, count: 0 };
      }

      this.logger.log(
        `[DatabaseService] Upserting ${tasksData.length} project tasks`,
      );

      // Process tasks in bulk using save (which handles upsert for existing entities)
      const results = await this.projectTaskRepo.save(tasksData);

      this.logger.log(
        `[DatabaseService] Successfully upserted ${results.length} project tasks`,
      );

      return { success: true, count: results.length, results };
    } catch (error) {
      this.logger.error(
        `[DatabaseService] Error upserting project tasks: ${error.message}`,
        error.stack,
      );

      // Fallback: try upserting tasks one by one
      this.logger.warn(
        '[DatabaseService] Falling back to individual task upserts',
      );
      const results = [];
      for (const taskData of tasksData) {
        try {
          const result = await this.upsertProjectTask(taskData);
          results.push(result);
        } catch (taskError) {
          this.logger.error(
            `[DatabaseService] Failed to upsert task ${taskData.ProjectTaskId}: ${taskError.message}`,
          );
        }
      }

      return { success: true, count: results.length, results };
    }
  }

  // ProjectTaskTracking methods
  async findProjectTaskTracking(projectId: string, projectTaskId: string) {
    return this.projectTaskTrackingRepo.findOne({
      where: {
        ProjectId: projectId,
        ProjectTaskId: projectTaskId,
      },
    });
  }

  async saveProjectTaskTracking(data: Partial<ProjectTaskTracking>) {
    return this.projectTaskTrackingRepo.save(data);
  }

  async upsertProjectTaskTrackings(trackingData: Partial<ProjectTaskTracking>[]) {
    try {
      if (!trackingData || trackingData.length === 0) {
        this.logger.warn('[DatabaseService] No project task tracking data to upsert');
        return { success: true, count: 0, inserted: 0, skipped: 0 };
      }

      this.logger.log(
        `[DatabaseService] Processing ${trackingData.length} project task tracking records`,
      );

      let inserted = 0;
      let skipped = 0;

      for (const tracking of trackingData) {
        try {
          // Check if this referenceId (ProjectTaskId) already exists for this ProjectId
          const existing = await this.findProjectTaskTracking(
            tracking.ProjectId,
            tracking.ProjectTaskId,
          );

          if (existing) {
            this.logger.debug(
              `[DatabaseService] Skipping duplicate: ProjectId=${tracking.ProjectId}, ProjectTaskId=${tracking.ProjectTaskId}`,
            );
            skipped++;
            continue;
          }

          // Insert new record
          await this.projectTaskTrackingRepo.save(tracking);
          inserted++;

          this.logger.debug(
            `[DatabaseService] Inserted tracking: ProjectTaskTrackingId=${tracking.ProjectTaskTrackingId}`,
          );
        } catch (error) {
          this.logger.error(
            `[DatabaseService] Error processing tracking record: ${error.message}`,
            error.stack,
          );
          skipped++;
        }
      }

      this.logger.log(
        `[DatabaseService] Project task tracking complete: ${inserted} inserted, ${skipped} skipped`,
      );

      return {
        success: true,
        count: trackingData.length,
        inserted,
        skipped,
      };
    } catch (error) {
      this.logger.error(
        `[DatabaseService] Error in upsertProjectTaskTrackings: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
