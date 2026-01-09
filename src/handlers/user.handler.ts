import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../services/database.service';
import { TransformService } from 'src/constants/transformation/transform-service';
import {
  UserEventData,
  LastLoginEventData,
  validateRequired,
  validateString,
  ValidationError,
} from '../types';

@Injectable()
export class UserHandler {
  constructor(
    private readonly dbService: DatabaseService,
    private transformService: TransformService,
  ) {}

  async handleUserUpsert(data: UserEventData) {
    try {
      // Validate required fields
      validateString(data.userId, 'userId');
      // Transform and save user data
      const transformedUserData =
        await this.transformService.transformUserData(data);
      const savedUser =
        await this.dbService.saveUserProfileData(transformedUserData);

      // Transform and save cohort member data if cohorts exist
      if (
        data.cohorts &&
        Array.isArray(data.cohorts) &&
        data.cohorts.length > 0
      ) {
        const cohortMemberData =
          await this.transformService.transformCohortMemberData(data);
        
        // Save each cohort member relationship with upsert logic
        for (const cohortMember of cohortMemberData) {
          const result = await this.dbService.upsertCohortMemberData(cohortMember);
          console.log(`[UserHandler] Cohort member ${result.action}: userId=${cohortMember.UserID}, cohortId=${cohortMember.CohortID}`);
        }
      }

      return savedUser;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  async handleUserCreated(data: UserEventData) {
    try {
      // Validate required fields
      validateString(data.userId, 'userId');

      // First handle the regular user upsert
      const savedUser = await this.handleUserUpsert(data);

      // For USER_CREATED events, also save registration tracker data
      if (data.tenantData && Array.isArray(data.tenantData)) {
        const registrationTrackers = await this.transformService.transformRegistrationTrackerData(data);
        
        // Save each registration tracker entry
        for (const registrationTracker of registrationTrackers) {
          await this.dbService.upsertRegistrationTracker(registrationTracker);
        }
      }

      return savedUser;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  async handleUserDelete(data: { userId: string }) {
    try {
      validateString(data.userId, 'userId');
      return this.dbService.deleteUserProfileData(data);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  async handleCohortUpsert(data: any) {
    try {
      validateString(data.cohortId, 'cohortId');
      const transformedCohortData =
        await this.transformService.transformCohortData(data);
      return this.dbService.saveCohortData(transformedCohortData);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  async handleCohortDelete(data: { cohortId: string }) {
    try {
      validateString(data.cohortId, 'cohortId');
      return this.dbService.deleteCohortData(data);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  async handleUserTenantStatusUpdate(data: any) {
    try {
      // Validate required fields
      validateString(data.userId, 'userId');
      validateString(data.tenantId, 'tenantId');

      // Extract role information (optional)
      const roleId = data.role?.roleId;

      // Convert status to boolean (active = true, archived/inactive = false)
      const isActive = data.status?.toLowerCase() === 'active';

      // Prepare registration tracker update
      const registrationTrackerData: any = {
        userId: data.userId,
        tenantId: data.tenantId,
        isActive: isActive,
        tenantRegnDate: data.createdAt ? new Date(data.createdAt) : undefined,
        reason: data.reason || undefined,
      };

      // Include roleId only if provided
      if (roleId) {
        registrationTrackerData.roleId = roleId;
      }

      // Update registration tracker
      await this.dbService.upsertRegistrationTracker(registrationTrackerData);

      console.log(
        `[UserHandler] User tenant status updated: userId=${data.userId}, tenantId=${data.tenantId}, roleId=${roleId || 'N/A'}, status=${data.status}, isActive=${isActive}`
      );

      // Optionally update user information if provided
      if (data.user) {
        const userUpdateData = {
          userId: data.userId,
          username: data.user.username,
          fullName: `${data.user.firstName || ''} ${data.user.lastName || ''}`.trim(),
          email: data.user.email,
          mobile: data.user.mobile?.toString(),
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
        };

        await this.dbService.saveUserProfileData(userUpdateData);
        console.log(`[UserHandler] User profile also updated for userId=${data.userId}`);
      }

      return { success: true, isActive };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      console.error('[UserHandler] Error handling user tenant status update:', error);
      throw error;
    }
  }

  async handleUserTenantMapping(data: any) {
    try {
      // Validate required fields
      validateString(data.userId, 'userId');
      validateString(data.tenantId, 'tenantId');

      // Extract role information
      const roleId = data.role?.roleId;
      if (!roleId) {
        throw new Error('Role ID is required for tenant mapping');
      }

      // Convert status to boolean (active = true, archived/inactive = false)
      const isActive = data.status?.toLowerCase() === 'active';
      console.log("hiii")
      // Transform and update user data with custom fields if provided
      if (data.customFields && Array.isArray(data.customFields)) {
        console.log("hiii2")
        const transformedUserData = await this.transformService.transformUserData(data);
        console.log(transformedUserData);
        await this.dbService.saveUserProfileData(transformedUserData);
        console.log(`[UserHandler] User profile updated with custom fields for userId=${data.userId}`);
      } else if (data.user) {
        console.log("hiii3")
        // Fallback to basic user update if no custom fields
        const userUpdateData = {
          userId: data.userId,
          username: data.user.username,
          fullName: `${data.user.firstName || ''} ${data.user.lastName || ''}`.trim(),
          email: data.user.email,
          mobile: data.user.mobile?.toString(),
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
        };
        console.log(userUpdateData);

        await this.dbService.saveUserProfileData(userUpdateData);
        console.log(`[UserHandler] User profile updated for userId=${data.userId}`);
      }
      console.log("hiii4")

      // Prepare registration tracker data
      const registrationTrackerData = {
        userId: data.userId,
        tenantId: data.tenantId,
        roleId: roleId,
        isActive: isActive,
        tenantRegnDate: data.createdAt ? new Date(data.createdAt) : new Date(),
        platformRegnDate: data.createdAt ? new Date(data.createdAt) : new Date(),
      };

      // Update registration tracker
      await this.dbService.upsertRegistrationTracker(registrationTrackerData);

      console.log(
        `[UserHandler] User tenant mapping created/updated: userId=${data.userId}, tenantId=${data.tenantId}, status=${data.status}, isActive=${isActive}`
      );

      return { success: true, isActive };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  async handleUserLastLogin(data: LastLoginEventData) {
    try {
      // Validate required fields
      validateString(data.userId, 'userId');

      // Update last login timestamp
      return this.dbService.updateUserLastLogin(data);

    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }
}
