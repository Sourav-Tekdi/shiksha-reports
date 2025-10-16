import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

import { DailyAttendanceReport } from 'src/entities/daily-attendance-report.entity';
import { Event } from 'src/entities/event.entity';
import { EventDetails } from 'src/entities/event-details.entity';
import { EventRepetition } from 'src/entities/event-repetition.entity';
import { CohortMember } from 'src/entities/cohort-member.entity';
import { Cohort } from 'src/entities/cohort.entity';
import { AttendanceTracker } from 'src/entities/attendance-tracker.entity';
import { AssessmentTracker } from 'src/entities/assessment-tracker.entity';
import { CourseTracker } from 'src/entities/course-tracker.entity';
import { ContentTracker } from 'src/entities/content-tracker.entity';
import { RegistrationTracker } from 'src/entities/registration-tracker.entity';

@Injectable()
export class DatabaseService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(DailyAttendanceReport)
    private dailyAttendanceRepo: Repository<DailyAttendanceReport>,
    @InjectRepository(Event)
    private eventRepo: Repository<Event>,
    @InjectRepository(EventDetails)
    private eventDetailsRepo: Repository<EventDetails>,
    @InjectRepository(EventRepetition)
    private eventRepetitionRepo: Repository<EventRepetition>,
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
  ) {}

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



  async saveEventDetailsData(data: any) {
    return this.eventDetailsRepo.save(data);
  }

  async saveEventData(data: any) {
    return this.eventRepo.save(data);
  }

  async saveEventRepetitionData(data: any) {
    return this.eventRepetitionRepo.save(data);
  }

  async deleteEventData(data: { eventDetailId: string }) {
    const { eventDetailId } = data;
    await this.eventRepetitionRepo.delete({ eventDetailId });
    return this.eventDetailsRepo.delete({ eventDetailId });
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

  async upsertCohortData(cohortData: Partial<Cohort>) {
    try {
      // Check if cohort exists
      const existingCohort = await this.cohortNewRepo.findOne({
        where: { cohortId: cohortData.cohortId },
      });

      if (existingCohort) {
        // Update existing cohort - explicitly update all fields
        await this.cohortNewRepo.update(
          { cohortId: cohortData.cohortId },
          {
            tenantId: cohortData.tenantId,
            cohortName: cohortData.cohortName,
            parentId: cohortData.parentId,
            type: cohortData.type,
            status: cohortData.status, // Ensure status is updated
            coStateId: cohortData.coStateId,
            coDistrictId: cohortData.coDistrictId,
            coBlockId: cohortData.coBlockId,
            coVillageId: cohortData.coVillageId,
            coBoard: cohortData.coBoard,
            coGrade: cohortData.coGrade,
            coMedium: cohortData.coMedium,
            coSubject: cohortData.coSubject,
            coGoogleMapLink: cohortData.coGoogleMapLink,
            coIndustry: cohortData.coIndustry,
          },
        );
        console.log(`[DatabaseService] Updated cohort ${cohortData.cohortId} with status: ${cohortData.status}`);
        return { action: 'updated', cohortId: cohortData.cohortId };
      } else {
        // Insert new cohort
        const newCohort = await this.cohortNewRepo.save(cohortData);
        console.log(`[DatabaseService] Created new cohort ${cohortData.cohortId} with status: ${cohortData.status}`);
        return { action: 'created', cohortId: newCohort.cohortId };
      }
    } catch (error) {
      console.error('Error in upsertCohortData:', error);
      throw error;
    }
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
      // Use database-level upsert with ON CONFLICT to avoid race conditions
      const result = await this.registrationTrackerRepo
        .createQueryBuilder()
        .insert()
        .into(RegistrationTracker)
        .values(registrationData)
        .orUpdate(['platformRegnDate', 'tenantRegnDate', 'isActive'], ['userId', 'tenantId', 'roleId'])
        .execute();

      return result;
    } catch (error) {
      // Fallback to the original method if the database doesn't support UPSERT
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
}
