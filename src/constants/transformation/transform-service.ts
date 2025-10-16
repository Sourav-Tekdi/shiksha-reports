import { Injectable } from '@nestjs/common';
import { User } from '../../entities/user.entity';
import { DailyAttendanceReport } from '../../entities/daily-attendance-report.entity';

import {
  UserEventData,
  AttendanceEventData,
  AssessmentTrackingData,
  AssessmentScoreData,
  CourseEnrollmentData,
} from '../../types';

import { Cohort } from 'src/entities/cohort.entity';
import { DatabaseService } from 'src/services/database.service';

import { AttendanceTracker } from 'src/entities/attendance-tracker.entity';
import { AssessmentTracker } from 'src/entities/assessment-tracker.entity';
import { CourseTracker } from 'src/entities/course-tracker.entity';
import { ContentTracker } from 'src/entities/content-tracker.entity';
import { RegistrationTracker } from 'src/entities/registration-tracker.entity';
import { Course } from 'src/entities/course.entity';
import { QuestionSet } from 'src/entities/question-set.entity';
import { ExternalCourseData, ExternalQuestionSetData } from 'src/types/cron.types';

@Injectable()
export class TransformService {
  constructor(private readonly dbService: DatabaseService) {}

  async transformUserData(data: UserEventData) {
    try {
      // const tenant = data.tenantData?.[0] ?? {}; // Commented out as it's not used

      // Extract custom field values from the new Kafka message structure
      const extractCustomField = (label: string) => {
        if (!data.customFields || !Array.isArray(data.customFields)) {
          return null;
        }

        const field = data.customFields.find((f: any) => f.label === label);

        if (
          !field ||
          !field.selectedValues ||
          !Array.isArray(field.selectedValues) ||
          field.selectedValues.length === 0
        ) {
          return null;
        }

        const selectedValue = field.selectedValues[0];

        // Handle different types of selectedValues
        if (typeof selectedValue === 'string') {
          return selectedValue;
        } else if (
          typeof selectedValue === 'object' &&
          selectedValue !== null
        ) {
          // Return the 'value' property if it exists, otherwise 'id'
          return selectedValue.id || null;
        }

        return null;
      };

      // Helper function to convert yes/no to boolean
      const convertToBoolean = (value: string | null) => {
        if (value === null) return null;
        return value.toLowerCase() === 'yes';
      };

      // Convert status string (active/inactive) to boolean
      const convertStatusToBoolean = (status: string | null | undefined) => {
        if (!status) return null;
        return status.toLowerCase() === 'active';
      };

      const transformedData: Partial<User> & Record<string, any> = {
        // Basic user fields - mapping to entity property names (not column names)
        userId: data.userId,
        username: data.username,
        fullName:
          `${data.firstName || ''} ${data.middleName ? data.middleName + ' ' : ''}${data.lastName || ''}`.trim(),
        email: data.email,
        mobile: data.mobile?.toString(),
        dob: data.dob,
        gender: data.gender,
        status: convertStatusToBoolean(data.status),
        createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,

        // Add enrollmentId from main data
        userEnrollmentNumber: data.enrollmentId,

        // Location fields from custom fields
        stateId: extractCustomField('STATE'),
        districtId: extractCustomField('DISTRICT'),
        blockId: extractCustomField('BLOCK'),
        villageId: extractCustomField('VILLAGE'),

        // Additional custom fields mapped to entity properties
        userFatherName: extractCustomField('FATHER_NAME'),
        userGuardianName: extractCustomField('NAME_OF_GUARDIAN'),
        userGuardianRelation: extractCustomField('RELATION_WITH_GUARDIAN'),
        userParentPhone: extractCustomField('PARENT_GUARDIAN_PHONE_NO'),
        userClass: extractCustomField(
          'HIGHEST_EDCATIONAL_QUALIFICATION_OR_LAST_PASSED_GRADE',
        ),
        userMaritalStatus: extractCustomField('MARITAL_STATUS'),
        userWhatDoYouWantToBecome: extractCustomField(
          'WHAT_DO_YOU_WANT_TO_BECOME',
        ),
        userDropOutReason: extractCustomField(
          'REASON_FOR_DROP_OUT_FROM_SCHOOL',
        ),
        userWorkDomain: extractCustomField('WHAT_IS_YOUR_PRIMARY_WORK'),
        preferredModeOfLearning: extractCustomField(
          'WHAT_IS_YOUR_PREFERRED_MODE_OF_LEARNING',
        ),

        // Additional fields from new structure
        centerId: extractCustomField('CENTER'),
        phoneTypeAccessible: extractCustomField('TYPE_OF_PHONE_ACCESSIBLE'),
        familyMemberDetails: extractCustomField('FAMILY_MEMBER_DETAILS'),

        // Boolean fields
        userOwnPhoneCheck: convertToBoolean(
          extractCustomField('DOES_THIS_PHONE_BELONG_TO_YOU'),
        ),
      };

      return transformedData;
    } catch (error) {
      console.error('Error transforming user data:', error);
      throw error;
    }
  }

  async transformCohortMemberData(data: UserEventData) {
    try {
      const userId = data.userId;
      const cohortMembers = [];

      if (data.cohorts && Array.isArray(data.cohorts)) {
        for (const cohort of data.cohorts) {
          const cohortMember = {
            UserID: userId,
            CohortID: cohort.batchId,
            MemberStatus: cohort.cohortMemberStatus || 'active',
            AcademicYearID: cohort.academicYearId,
            CohortMemberID: cohort.cohortMemberId,
          };
          cohortMembers.push(cohortMember);
        }
      }

      return cohortMembers;
    } catch (error) {
      console.error('Error transforming cohort member data:', error);
      throw error;
    }
  }

  async transformCohortData(data: any): Promise<Partial<Cohort>> {
    try {
      // Extract custom field values from the new Kafka message structure
      const extractCustomField = (label: string) => {
        if (!data.customFields || !Array.isArray(data.customFields)) {
          return null;
        }

        const field = data.customFields.find((f: any) => f.label === label);
        if (
          !field ||
          !field.selectedValues ||
          !Array.isArray(field.selectedValues) ||
          field.selectedValues.length === 0
        ) {
          return null;
        }

        const selectedValue = field.selectedValues[0];

        // Handle different types of selectedValues
        if (typeof selectedValue === 'string') {
          return selectedValue;
        } else if (
          typeof selectedValue === 'object' &&
          selectedValue !== null
        ) {
          // Return the 'id' property for cohort fields
          return selectedValue.id || null;
        }

        return null;
      };

      // Extract custom field by fieldId
      const extractCustomFieldById = (fieldId: string) => {
        if (!data.customFields || !Array.isArray(data.customFields)) {
          return null;
        }

        const field = data.customFields.find((f: any) => f.fieldId === fieldId);
        if (
          !field ||
          !field.selectedValues ||
          !Array.isArray(field.selectedValues) ||
          field.selectedValues.length === 0
        ) {
          return null;
        }

        const selectedValue = field.selectedValues[0];

        // Return the value property for the type determination
        if (typeof selectedValue === 'object' && selectedValue !== null) {
          return selectedValue.value || selectedValue.id || null;
        } else if (typeof selectedValue === 'string') {
          return selectedValue;
        }

        return null;
      };

      // Determine the correct type based on event type and conditions
      let correctedType = data.type;

      if (data.type === 'COHORT') {
        // For COHORT_CREATED events, find the TYPE_OF_CENTER field
        const typeOfCenter = extractCustomFieldById(
          '000a7469-2721-4c7b-8180-52812a0f6fe7',
        );

        if (typeOfCenter === 'remote') {
          correctedType = 'RemoteCenter';
        } else if (typeOfCenter === 'regular') {
          correctedType = 'RegularCenter';
        } else {
          // Keep original type if no matching custom field found
          console.warn(
            `Unknown type of center: ${typeOfCenter}, keeping original type: ${data.type}`,
          );
        }
      } else if (data.type === 'BATCH' && data.parentId) {
        // For COHORT_UPDATED events with BATCH type, check parent cohort
        try {
          const parentCohort = await this.dbService.findCohort(data.parentId);

          if (parentCohort) {
            if (parentCohort.type === 'RemoteCenter') {
              correctedType = 'RemoteBatch';
            } else if (parentCohort.type === 'RegularCenter') {
              correctedType = 'RegularBatch';
            } else {
              console.warn(
                `Parent cohort has unknown type: ${parentCohort.type}, keeping original type: ${data.type}`,
              );
            }
          } else {
            console.warn(
              `Parent cohort with ID ${data.parentId} not found, keeping original type: ${data.type}`,
            );
          }
        } catch (error) {
          console.error(
            `Error fetching parent cohort ${data.parentId}:`,
            error,
          );
          // Keep original type if error occurs
        }
      }

      const transformedData: Partial<Cohort> = {
        cohortId: data.cohortId,
        tenantId: data.tenantId,
        cohortName: data.name,
        createdOn: data.createdAt ? new Date(data.createdAt) : undefined,
        parentId: data.parentId,
        type: correctedType,
        status: data.status,

        // Location fields from custom fields
        coStateId: extractCustomField('STATE'),
        coDistrictId: extractCustomField('DISTRICT'),
        coBlockId: extractCustomField('BLOCK'),
        coVillageId: extractCustomField('VILLAGE'),

        // Educational fields
        coBoard: extractCustomField('BOARD'),
        coGrade: extractCustomField('GRADE'),
        coMedium: extractCustomField('MEDIUM'),
        coSubject: extractCustomField('SUBJECT'),

        // Additional fields
        coGoogleMapLink: extractCustomField('GOOGLE_MAP_LINK'),
        coIndustry: extractCustomField('INDUSTRY'),
      };

      console.log(
        `[TransformService] Cohort ${data.cohortId}: Original type "${data.type}" -> Corrected type "${correctedType}"`,
      );

      return transformedData;
    } catch (error) {
      console.error('Error transforming cohort data:', error);
      throw error;
    }
  }

  async transformCourseData(data: CourseEnrollmentData) {
    return data;
  }

  async transformAttendanceData(data: AttendanceEventData): Promise<{
    attendanceData: Partial<AttendanceTracker>;
    dayColumn: string;
    attendanceValue: string;
  }> {
    try {
      // Parse the attendance date
      const attendanceDate = new Date(data.attendanceDate);
      const year = attendanceDate.getFullYear();
      const month = attendanceDate.getMonth() + 1; // getMonth() returns 0-11
      const day = attendanceDate.getDate();

      // Format day as two-digit string for column mapping
      const dayColumn = `day${day.toString().padStart(2, '0')}`;

      const transformedData: Partial<AttendanceTracker> = {
        tenantId: data.tenantId,
        context: data.context,
        contextId: data.contextId,
        userId: data.userId,
        year: year,
        month: month,
      };

      return {
        attendanceData: transformedData,
        dayColumn: dayColumn,
        attendanceValue: data.attendance,
      };
    } catch (error) {
      console.error('Error transforming attendance data:', error);
      throw error;
    }
  }

  // Keep the old method for backward compatibility if needed
  async transformDailyAttendanceData(data: AttendanceEventData) {
    try {
      const transformedData: Partial<DailyAttendanceReport> = {
        attendanceId: data.attendanceId,
        userId: data.userId,
        cohortId: data.contextId || data.cohortId,
        context: data.context,
        date: data.attendanceDate ? new Date(data.attendanceDate) : new Date(),
        status: data.attendance || data.status,
        metadata: data.metaData || data.metadata,
        createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
      };
      return transformedData;
    } catch (error) {
      console.error('Error transforming daily attendance data:', error);
      throw error;
    }
  }

  async transformAssessmentTrackerData(data: AssessmentTrackingData): Promise<{
    assessmentData: Partial<AssessmentTracker>;
    scoreDetails: AssessmentScoreData[];
  }> {
    try {
      // Debug the incoming data to identify which field has the problematic value

      const transformedData: Partial<AssessmentTracker> = {
        assessTrackingId: data.assessmentTrackingId,
        assessmentId: data.contentId || data.courseId,
        courseId: data.courseId,
        assessmentName: data.assessmentName,
        userId: data.userId,
        tenantId: data.tenantId,
        totalMaxScore: data.totalMaxScore || 0,
        totalScore: data.totalScore || 0,
        timeSpent: parseInt(String(data.timeSpent)) || 0,
        assessmentSummary: JSON.stringify(data.assessmentSummary),
        attemptId: data.attemptId, // Use attemptId from source data
        assessmentType: data.assessmentType,
      };

      const scoreDetails = data.scores || [];

      return {
        assessmentData: transformedData,
        scoreDetails: scoreDetails,
      };
    } catch (error) {
      console.error('Error transforming assessment tracker data:', error);
      throw error;
    }
  }

  async transformCourseTrackerData(
    data: any,
    courseName: string,
  ): Promise<Partial<CourseTracker>> {
    try {
      const transformedData: Partial<CourseTracker> = {
        userId: data.userId,
        tenantId: data.tenantId,
        courseId: data.courseId,
        courseName: courseName,
        courseTrackingStatus: data.status,
        certificateId: data.certificateId || null,
        courseTrackingStartDate: data.createdOn
          ? new Date(data.createdOn)
          : undefined,
        courseTrackingEndDate: data.completedOn
          ? new Date(data.completedOn)
          : undefined,
      };

      return transformedData;
    } catch (error) {
      console.error('Error transforming course tracker data:', error);
      throw error;
    }
  }

  async transformContentTrackerData(
    data: any,
    contentName: string,
  ): Promise<Partial<ContentTracker>> {
    try {
      // Determine content tracking status based on details array
      let contentTrackingStatus = 'inprogress'; // default
      let totalTimeSpent = 0;

      if (data.details && Array.isArray(data.details)) {
        // Calculate total time spent
        totalTimeSpent = data.details.reduce((total, detail) => {
          return total + (detail.duration || 0);
        }, 0);

        // Determine status based on eid values
        const hasStart = data.details.some((detail) => detail.eid === 'START');
        const hasEnd = data.details.some((detail) => detail.eid === 'END');

        if (hasEnd) {
          contentTrackingStatus = 'completed';
        } else if (hasStart) {
          contentTrackingStatus = 'started';
        }
      }

      const transformedData: Partial<ContentTracker> = {
        contentTrackerId: data.contentTrackingId,
        userId: data.userId,
        tenantId: data.tenantId,
        contentId: data.contentId,
        courseId: data.courseId,
        contentName: contentName,
        contentType: data.contentType,
        contentTrackingStatus: contentTrackingStatus,
        timeSpent: Math.round(totalTimeSpent), // Round to nearest integer
        createdAt: data.createdOn ? new Date(data.createdOn) : new Date(),
        updatedAt: data.updatedOn ? new Date(data.updatedOn) : new Date(),
      };

      return transformedData;
    } catch (error) {
      throw error;
    }
  }

  async transformRegistrationTrackerData(
    data: UserEventData,
  ): Promise<Partial<RegistrationTracker>[]> {
    try {
      const registrationTrackers: Partial<RegistrationTracker>[] = [];

      // Extract platform registration date from user creation
      const platformRegnDate = data.createdAt
        ? new Date(data.createdAt)
        : new Date();

      // Process each tenant data to create registration tracker entries
      if (data.tenantData && Array.isArray(data.tenantData)) {
        for (const tenant of data.tenantData) {
          // Check if roles array exists and is an array
          if (tenant.roles && Array.isArray(tenant.roles)) {
            for (const role of tenant.roles) {
              const registrationTracker: Partial<RegistrationTracker> = {
                userId: data.userId,
                roleId: role.roleId,
                tenantId: tenant.tenantId,
                platformRegnDate: platformRegnDate,
                tenantRegnDate: platformRegnDate, // Same as platform date for new registrations
                isActive: true,
              };
              registrationTrackers.push(registrationTracker);
            }
          }
        }
      }

      return registrationTrackers;
    } catch (error) {
      console.error('Error transforming registration tracker data:', error);
      throw error;
    }
  }

  /**
   * Transform external course data to Course entity format
   */
  async transformExternalCourseData(data: ExternalCourseData): Promise<Partial<Course>> {
    try {
      // Validate required fields
      if (!data.identifier) {
        throw new Error('Course identifier is required');
      }

      // Transform date fields
      const transformDate = (dateValue: string | Date | null | undefined): Date | null => {
        if (!dateValue) return null;
        
        if (typeof dateValue === 'string') {
          const parsed = new Date(dateValue);
          return isNaN(parsed.getTime()) ? null : parsed;
        }
        
        if (dateValue instanceof Date) {
          return isNaN(dateValue.getTime()) ? null : dateValue;
        }
        
        return null;
      };

      // Transform text fields to handle arrays and objects
      const transformText = (value: any): string | null => {
        if (!value) return null;
        
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return value.toString();
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') return JSON.stringify(value);
        
        return null;
      };

      const transformedData: Partial<Course> = {
        identifier: data.identifier,
        name: data.name || null,
        author: data.author || null,
        primaryuser: data.primaryuser || null,
        se_domains: transformText(data.se_domains),
        contentlanguage: data.contentlanguage || null,
        status: data.status || null,
        targetagegroup: data.targetagegroup || null,
        se_subdomains: transformText(data.se_subdomains),
        childnodes: transformText(data.childnodes),
        keywords: transformText(data.keywords),
        channel: data.channel || null,
        lastpublishedon: transformDate(data.lastpublishedon),
        createdby: data.createdby || null,
        program: data.program || null,
        audience: data.audience || null,
        se_subjects: transformText(data.se_subjects),
        description: data.description || null,
      };
      return transformedData;
    } catch (error) {
      console.error('Error transforming course data:', error, {
        identifier: data.identifier,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Transform external question set data to QuestionSet entity format
   */
  async transformQuestionSetData(data: ExternalQuestionSetData): Promise<Partial<QuestionSet>> {
    try {
      // Validate required fields
      if (!data.identifier) {
        throw new Error('QuestionSet identifier is required');
      }

      // Transform date fields
      const transformDate = (dateValue: string | Date | null | undefined): Date | null => {
        if (!dateValue) return null;
        
        if (typeof dateValue === 'string') {
          const parsed = new Date(dateValue);
          return isNaN(parsed.getTime()) ? null : parsed;
        }
        
        if (dateValue instanceof Date) {
          return isNaN(dateValue.getTime()) ? null : dateValue;
        }
        
        return null;
      };

      // Transform text fields to handle arrays and objects
      const transformText = (value: any): string | null => {
        if (!value) return null;
        
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return value.toString();
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') return JSON.stringify(value);
        
        return null;
      };

      // Handle different field name variations from API
      const getFieldValue = (primaryField: any, alternativeField?: any): any => {
        return primaryField || alternativeField || null;
      };

      const transformedData: Partial<QuestionSet> = {
        identifier: data.identifier,
        name: data.name || null,
        childNodes: transformText(getFieldValue(data.childNodes)),
        createdOn: transformDate(getFieldValue(data.createdOn)),
        program: transformText(getFieldValue(data.program)),
        assessmentType: data.assessmentType || null,
        contentLanguage: transformText(getFieldValue(data.contentLanguage, data.language)),
        domain: transformText(getFieldValue(data.se_domains, data.domain)),
        subDomain: transformText(getFieldValue(data.se_subdomains, data.subDomain)),
        subject: transformText(getFieldValue(data.se_subjects, data.subject)),
      };

      return transformedData;
    } catch (error) {
      console.error('Error transforming question set data:', error, {
        identifier: data.identifier,
        error: error.message,
      });
      throw error;
    }
  }

}
